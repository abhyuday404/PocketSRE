import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { EvidenceEvent, ServiceHealth, IncidentBundle } from '@pocketsre/contracts';

const HEALTHY_RELEASE = 'rel-2026.09.1';
const BROKEN_RELEASE = 'rel-2026.09.2';

type DemoState = {
  broken: boolean;
  changedAt: string;
  incidentId: string;
  startedAt: string;
  evidence: EvidenceEvent[];
};

function now(): string {
  return new Date().toISOString();
}

export function createDemoApp() {
  const app = Fastify({ logger: false });
  const state: DemoState = {
    broken: false,
    changedAt: now(),
    incidentId: randomUUID(),
    startedAt: now(),
    evidence: [],
  };
  function timestampBefore(seconds: number): string {
    return new Date(Date.parse(state.changedAt) - seconds * 1_000).toISOString();
  }

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
        externalUrl: null,
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
          previousHealthy: 'true',
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

  function snapshot(): IncidentBundle {
    return {
      schemaVersion: 1,
      generatedAt: now(),
      serviceHealth: health(),
      incident: {
        id: state.incidentId,
        serviceId: 'checkout-api',
        title: state.broken ? 'Checkout requests are failing' : 'Checkout API operating normally',
        severity: state.broken ? 'critical' : 'info',
        status: state.broken ? 'open' : 'resolved',
        startedAt: state.startedAt,
        lastUpdatedAt: state.changedAt,
      },
      evidence: state.evidence.length ? state.evidence : healthyEvents(),
    };
  }
  app.get('/snapshot', async () => snapshot());
  app.post('/checkout', async (_request, reply) =>
    state.broken
      ? reply.code(500).send({ error: 'database_configuration_missing', release: BROKEN_RELEASE })
      : { orderId: randomUUID(), status: 'accepted', release: HEALTHY_RELEASE },
  );

  app.get('/events', async () => ({
    events: snapshot().evidence,
  }));

  app.post('/demo/break', async (_request, reply) => {
    if (state.broken) return reply.code(202).send({ status: 'accepted', health: health() });
    state.broken = true;
    state.changedAt = now();
    state.incidentId = randomUUID();
    state.startedAt = timestampBefore(180);
    state.evidence = brokenEvents().map((event) => ({
      ...event,
      id: `${state.incidentId}:${event.id}`,
    }));
    return reply.code(202).send({
      status: 'accepted',
      message: `${BROKEN_RELEASE} is now active and intentionally degraded.`,
      health: health(),
    });
  });

  app.post('/demo/reset', async (_request, reply) => {
    state.broken = false;
    state.changedAt = now();
    state.incidentId = randomUUID();
    state.startedAt = state.changedAt;
    state.evidence = healthyEvents();
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
    state.evidence.push({
      id: `${state.incidentId}:recovered`,
      source: 'health',
      type: 'recovery_completed',
      timestamp: state.changedAt,
      title: 'Checkout recovered after rollback',
      excerpt: 'Database and API checks passed.',
      metadata: { release: HEALTHY_RELEASE },
    });
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
