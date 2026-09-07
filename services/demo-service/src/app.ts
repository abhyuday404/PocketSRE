import Fastify from 'fastify';
import type { EvidenceEvent, ServiceHealth } from '@pocketsre/contracts';

const HEALTHY_RELEASE = 'rel-2026.09.1';
const BROKEN_RELEASE = 'rel-2026.09.2';

type DemoState = {
  broken: boolean;
  changedAt: string;
};

function now(): string {
  return new Date().toISOString();
}

function timestampBefore(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

export function createDemoApp() {
  const app = Fastify({ logger: false });
  const state: DemoState = { broken: false, changedAt: now() };

  function health(): ServiceHealth {
    return {
      serviceId: 'checkout-api',
      serviceName: 'Checkout API',
      status: state.broken ? 'degraded' : 'healthy',
      version: state.broken ? BROKEN_RELEASE : HEALTHY_RELEASE,
      checkedAt: now(),
      checks: state.broken
        ? { api: 'degraded', database: 'failed', cache: 'healthy' }
        : { api: 'healthy', database: 'healthy', cache: 'healthy' },
    };
  }

  function healthyEvents(): EvidenceEvent[] {
    return [
      {
        id: 'evt-health-green',
        source: 'health',
        type: 'health_check_passed',
        timestamp: now(),
        title: 'All service checks are healthy',
        excerpt: `Checkout API is serving ${HEALTHY_RELEASE}.`,
        externalUrl: null,
        metadata: { release: HEALTHY_RELEASE },
      },
    ];
  }

  function brokenEvents(): EvidenceEvent[] {
    return [
      {
        id: 'evt-commit-config',
        source: 'github',
        type: 'configuration_changed',
        timestamp: timestampBefore(300),
        title: 'Environment contract renamed',
        excerpt:
          'Commit a13fd92 replaced process.env.DATABASE_URL with process.env.DB_URL in src/database.ts.',
        externalUrl: 'https://github.com/example/pocketsre-demo/commit/a13fd92',
        metadata: { commitSha: 'a13fd92', file: 'src/database.ts' },
      },
      {
        id: 'evt-deploy-bad',
        source: 'deployment',
        type: 'deployment_completed',
        timestamp: timestampBefore(240),
        title: 'Checkout API deployment completed',
        excerpt: `${BROKEN_RELEASE} was promoted to production from commit a13fd92.`,
        externalUrl: null,
        metadata: {
          release: BROKEN_RELEASE,
          previousRelease: HEALTHY_RELEASE,
          commitSha: 'a13fd92',
        },
      },
      {
        id: 'evt-error-spike',
        source: 'sentry',
        type: 'error_rate_increased',
        timestamp: timestampBefore(190),
        title: 'Checkout error rate increased to 82%',
        excerpt: `HTTP 500 responses began shortly after ${BROKEN_RELEASE} was promoted.`,
        externalUrl: null,
        metadata: { release: BROKEN_RELEASE, route: '/checkout', errorRate: '82%' },
      },
      {
        id: 'evt-db-exception',
        source: 'sentry',
        type: 'exception',
        timestamp: timestampBefore(180),
        title: 'Database connection initialization failed',
        excerpt: 'ConfigurationError: DB_URL is undefined at src/database.ts:14.',
        externalUrl: null,
        metadata: { release: BROKEN_RELEASE, fingerprint: 'configuration-db-url' },
      },
      {
        id: 'evt-db-health',
        source: 'database',
        type: 'database_check_failed',
        timestamp: timestampBefore(170),
        title: 'Database readiness check failed',
        excerpt: 'The application did not create a database connection pool.',
        externalUrl: null,
        metadata: { release: BROKEN_RELEASE },
      },
      {
        id: 'evt-health-red',
        source: 'health',
        type: 'health_check_failed',
        timestamp: now(),
        title: 'Checkout API is degraded',
        excerpt: 'The API process is running, but the database check is failing.',
        externalUrl: null,
        metadata: { release: BROKEN_RELEASE },
      },
    ];
  }

  app.get('/health', async () => health());

  app.get('/events', async () => ({
    events: state.broken ? brokenEvents() : healthyEvents(),
  }));

  app.post('/demo/break', async (_request, reply) => {
    state.broken = true;
    state.changedAt = now();
    return reply.code(202).send({
      status: 'accepted',
      message: `${BROKEN_RELEASE} is now active and intentionally degraded.`,
      health: health(),
    });
  });

  app.post('/demo/reset', async (_request, reply) => {
    state.broken = false;
    state.changedAt = now();
    return reply.code(200).send({
      status: 'succeeded',
      message: `${HEALTHY_RELEASE} restored.`,
      health: health(),
    });
  });

  app.post<{ Body: { targetRelease?: string } }>('/actions/rollback', async (request, reply) => {
    const targetRelease = request.body?.targetRelease;
    if (targetRelease !== HEALTHY_RELEASE) {
      return reply.code(400).send({
        error: 'unsupported_target',
        message: `Demo rollback only supports ${HEALTHY_RELEASE}.`,
      });
    }

    state.broken = false;
    state.changedAt = now();
    return reply.code(202).send({
      actionId: `action-${Date.now()}`,
      status: 'succeeded',
      message: `${HEALTHY_RELEASE} restored and health checks are green.`,
      startedAt: state.changedAt,
      completedAt: now(),
    });
  });

  return app;
}
