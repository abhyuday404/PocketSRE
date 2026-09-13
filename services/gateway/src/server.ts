import { LocalDeployments } from './local-deployments.js';
import { createGatewayApp } from './app.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadPrivateGatewayEnvironment } from './environment.js';
import { VercelProvider } from './providers.js';
import { ExpoPushTransport } from './project-monitor.js';
import { GitHubAccount } from './github-account.js';
import { ProjectStore } from './projects.js';
import { GitHubFixRepository } from './github-fixes.js';
import { createGitHubCliFetch } from './github-cli.js';
import {
  createLiveBundleLoader,
  GitHubConnector,
  SentryConnector,
  type EvidenceConnector,
} from './connectors.js';

loadPrivateGatewayEnvironment();

const port = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 4100);
const host = process.env.GATEWAY_HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.GATEWAY_ACCESS_TOKEN) {
  throw new Error('GATEWAY_ACCESS_TOKEN is required when binding to the LAN.');
}
const mode = process.env.POCKETSRE_MODE ?? 'demo';
if (!['demo', 'live'].includes(mode)) throw new Error('POCKETSRE_MODE must be demo or live');
const connectors: EvidenceConnector[] = [];
const githubFetcher =
  process.env.GITHUB_USE_CLI === '1'
    ? createGitHubCliFetch(process.env.GITHUB_REPOSITORY ?? '')
    : undefined;
if (mode === 'live') {
  if (!process.env.HEALTH_URL) throw new Error('HEALTH_URL is required in live mode');
  if (!process.env.HEALTH_SERVICE_ID || !process.env.HEALTH_SERVICE_NAME)
    throw new Error('HEALTH_SERVICE_ID and HEALTH_SERVICE_NAME are required in live mode');
  if (process.env.GITHUB_REPOSITORY)
    connectors.push(
      new GitHubConnector(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN, githubFetcher),
    );
  if (
    process.env.SENTRY_ORGANIZATION ||
    process.env.SENTRY_PROJECT ||
    process.env.SENTRY_AUTH_TOKEN
  ) {
    if (
      !process.env.SENTRY_ORGANIZATION ||
      !process.env.SENTRY_PROJECT ||
      !process.env.SENTRY_AUTH_TOKEN
    )
      throw new Error('Set all three Sentry settings');
    connectors.push(
      new SentryConnector(
        process.env.SENTRY_ORGANIZATION,
        process.env.SENTRY_PROJECT,
        process.env.SENTRY_AUTH_TOKEN,
      ),
    );
  }
}
const loadBundle =
  mode === 'live'
    ? createLiveBundleLoader({
        healthUrl: process.env.HEALTH_URL!,
        serviceId: process.env.HEALTH_SERVICE_ID!,
        serviceName: process.env.HEALTH_SERVICE_NAME!,
        healthToken: process.env.HEALTH_TOKEN,
        healthMaxAgeMs: Number(process.env.HEALTH_MAX_AGE_MS ?? 60_000),
        incidentPath: resolve(process.env.INCIDENT_PATH ?? '.pocketsre-data/incidents.json'),
        connectors,
      })
    : undefined;
// Keep the synthetic demo private while serving the mobile API from one cloud process.
const demo =
  mode === 'demo' && process.env.POCKETSRE_EMBED_DEMO === '1'
    ? (await import('@pocketsre/demo-service/app')).createDemoApp()
    : undefined;
const demoServiceUrl = demo
  ? await demo.listen({ host: '127.0.0.1', port: 0 })
  : process.env.DEMO_SERVICE_URL;
const app = createGatewayApp({
  projects:
    process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_PROJECTS_TOKEN
      ? {
          github: new GitHubAccount({
            clientId: process.env.GITHUB_APP_CLIENT_ID,
            appSlug: process.env.GITHUB_APP_SLUG,
            token: process.env.GITHUB_PROJECTS_TOKEN,
          }),
          store: new ProjectStore(resolve(process.env.PROJECTS_PATH ?? '.pocketsre-data/projects')),
          vercel: new VercelProvider(process.env.VERCEL_TOKEN, process.env.VERCEL_TEAM_ID),
          monitor: {
            path: resolve(
              process.env.MONITOR_PATH ?? resolve(homedir(), '.pocketsre', `monitor-${port}.json`),
            ),
            push: new ExpoPushTransport(process.env.EXPO_PUSH_ACCESS_TOKEN),
          },
          fixToken: process.env.GITHUB_PROJECT_FIX_TOKEN,
          fixRepositories: process.env.GITHUB_PROJECT_FIX_REPOSITORIES?.split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          localDeployments: process.env.POCKET_SRE_LAB_DIR
            ? new LocalDeployments(process.env.POCKET_SRE_LAB_DIR)
            : undefined,
          allowedHealthOrigins: (process.env.PROJECT_HEALTH_ORIGINS ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : undefined,
  fixRepository:
    mode === 'live' &&
    (process.env.GITHUB_FIX_TOKEN || (githubFetcher && process.env.GITHUB_FIX_PATHS))
      ? new GitHubFixRepository(
          process.env.GITHUB_REPOSITORY ?? '',
          (process.env.GITHUB_FIX_PATHS ?? '')
            .split(',')
            .map((path) => path.trim())
            .filter(Boolean),
          process.env.GITHUB_FIX_TOKEN ?? '',
          githubFetcher,
        )
      : undefined,
  loadBundle,
  demoServiceUrl,
  accessToken: process.env.GATEWAY_ACCESS_TOKEN,
  auditPath: resolve(process.env.AUDIT_PATH ?? '.pocketsre-data/actions.json'),
});

app.addHook('onClose', async () => {
  await demo?.close();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await loadBundle?.initialize();
  await app.listen({ port, host });
  console.info(`PocketSRE gateway (${mode}) listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
