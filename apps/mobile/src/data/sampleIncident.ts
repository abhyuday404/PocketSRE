import type { IncidentBundle } from '@pocketsre/contracts';

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

export function createSampleIncident(): IncidentBundle {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    incident: {
      id: 'inc-offline-sample',
      serviceId: 'checkout-api',
      title: 'Checkout requests are failing',
      severity: 'critical',
      status: 'open',
      startedAt: secondsAgo(180),
      lastUpdatedAt: new Date().toISOString(),
    },
    serviceHealth: {
      serviceId: 'checkout-api',
      serviceName: 'Checkout API',
      status: 'degraded',
      version: 'rel-2026.09.2',
      checkedAt: new Date().toISOString(),
      checks: { api: 'degraded', database: 'failed', cache: 'healthy' },
    },
    evidence: [
      {
        id: 'sample-config',
        source: 'github',
        type: 'configuration_changed',
        timestamp: secondsAgo(300),
        title: 'Environment contract renamed',
        excerpt: 'DATABASE_URL was replaced with DB_URL in src/database.ts.',
        externalUrl: null,
        metadata: { commitSha: 'a13fd92', file: 'src/database.ts' },
      },
      {
        id: 'sample-deploy',
        source: 'deployment',
        type: 'deployment_completed',
        timestamp: secondsAgo(240),
        title: 'Production deployment completed',
        excerpt: 'rel-2026.09.2 was promoted from commit a13fd92.',
        externalUrl: null,
        metadata: {
          release: 'rel-2026.09.2',
          previousRelease: 'rel-2026.09.1',
          previousHealthy: 'true',
          commitSha: 'a13fd92',
        },
      },
      {
        id: 'sample-exception',
        source: 'sentry',
        type: 'exception',
        timestamp: secondsAgo(180),
        title: 'Database connection initialization failed',
        excerpt: 'ConfigurationError: DB_URL is undefined at src/database.ts:14.',
        externalUrl: null,
        metadata: { release: 'rel-2026.09.2' },
      },
      {
        id: 'sample-health',
        source: 'health',
        type: 'health_check_failed',
        timestamp: new Date().toISOString(),
        title: 'Checkout API is degraded',
        excerpt: 'The API is running, but the database readiness check is failing.',
        externalUrl: null,
        metadata: { release: 'rel-2026.09.2' },
      },
    ],
  };
}
