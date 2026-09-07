import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  ApprovedActionRequestSchema,
  EvidenceEventSchema,
  ServiceHealthSchema,
  type IncidentBundle,
} from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';

type GatewayOptions = {
  demoServiceUrl?: string;
};

function incidentFromHealth(health: ReturnType<typeof ServiceHealthSchema.parse>) {
  const current = new Date().toISOString();
  const isHealthy = health.status === 'healthy';
  return {
    id: isHealthy ? 'inc-checkout-resolved' : 'inc-checkout-500s',
    serviceId: health.serviceId,
    title: isHealthy ? 'Checkout API operating normally' : 'Checkout requests are failing',
    severity: isHealthy ? ('info' as const) : ('critical' as const),
    status: isHealthy ? ('resolved' as const) : ('open' as const),
    startedAt: isHealthy ? current : new Date(Date.now() - 180_000).toISOString(),
    lastUpdatedAt: current,
  };
}

export function createGatewayApp(options: GatewayOptions = {}) {
  const app = Fastify({ logger: false });
  const demoServiceUrl =
    options.demoServiceUrl ?? process.env.DEMO_SERVICE_URL ?? 'http://127.0.0.1:4200';

  app.register(cors, { origin: true });

  async function requestDemo(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${demoServiceUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`Demo service returned ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  async function loadIncidentBundle(): Promise<IncidentBundle> {
    const [rawHealth, rawEvents] = await Promise.all([
      requestDemo('/health'),
      requestDemo('/events'),
    ]);
    const health = ServiceHealthSchema.parse(rawHealth);
    const eventsPayload = rawEvents as { events?: unknown[] };
    const evidence = (eventsPayload.events ?? []).map((event) => EvidenceEventSchema.parse(event));

    return sanitizeBundle({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      incident: incidentFromHealth(health),
      serviceHealth: health,
      evidence,
    });
  }

  app.get('/health', async () => ({
    service: 'pocketsre-gateway',
    status: 'healthy',
    checkedAt: new Date().toISOString(),
  }));

  app.get('/v1/services', async () => {
    const bundle = await loadIncidentBundle();
    return { services: [bundle.serviceHealth] };
  });

  app.get('/v1/incidents/current', async () => loadIncidentBundle());

  app.post('/v1/demo/break', async (_request, reply) => {
    const payload = await requestDemo('/demo/break', { method: 'POST', body: '{}' });
    return reply.code(202).send(payload);
  });

  app.post('/v1/demo/reset', async (_request, reply) => {
    const payload = await requestDemo('/demo/reset', { method: 'POST', body: '{}' });
    return reply.code(200).send(payload);
  });

  app.post('/v1/actions/execute', async (request, reply) => {
    const parsed = ApprovedActionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_action', issues: parsed.error.issues });
    }

    if (parsed.data.serviceId !== 'checkout-api') {
      return reply.code(403).send({ error: 'service_not_allowed' });
    }

    if (parsed.data.action === 'RUN_HEALTH_CHECK') {
      const health = await requestDemo('/health');
      return reply.send({
        actionId: `health-${Date.now()}`,
        status: 'succeeded',
        message: JSON.stringify(health),
        startedAt: parsed.data.approvedAt,
        completedAt: new Date().toISOString(),
      });
    }

    if (parsed.data.action !== 'TRIGGER_ROLLBACK_WORKFLOW') {
      return reply.code(403).send({ error: 'action_not_enabled_for_demo' });
    }

    const payload = await requestDemo('/actions/rollback', {
      method: 'POST',
      body: JSON.stringify({ targetRelease: parsed.data.parameters.targetRelease }),
    });
    return reply.code(202).send(payload);
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(502).send({
      error: 'upstream_unavailable',
      message: 'PocketSRE could not load the operational evidence source.',
    });
  });

  return app;
}
