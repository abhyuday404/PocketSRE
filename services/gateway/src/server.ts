import { createGatewayApp } from './app.js';
import { resolve } from 'node:path';
import { GitHubFixRepository } from './github-fixes.js';
import { createGitHubCliFetch } from './github-cli.js';
import {
  createLiveBundleLoader,
  GitHubConnector,
  SentryConnector,
  type EvidenceConnector,
} from './connectors.js';

const port = Number(process.env.GATEWAY_PORT ?? 4100);
const host = process.env.GATEWAY_HOST ?? '127.0.0.1';
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
const app = createGatewayApp({
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
  demoServiceUrl: process.env.DEMO_SERVICE_URL,
  accessToken: process.env.GATEWAY_ACCESS_TOKEN,
  auditPath: resolve(process.env.AUDIT_PATH ?? '.pocketsre-data/actions.json'),
});

try {
  await loadBundle?.initialize();
  await app.listen({ port, host });
  console.info(`PocketSRE gateway (${mode}) listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
