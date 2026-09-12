import { timingSafeEqual, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  ApprovedActionRequestSchema,
  ActionResultSchema,
  IncidentBundleSchema,
  type IncidentBundle,
  type AuditEntry,
} from '@pocketsre/contracts';
import { getRollbackTarget, sanitizeBundle } from '@pocketsre/incident-engine';
import { AuditStore } from './audit.js';
import { registerFixRoutes } from './fixes.js';
import type { FixRepository } from './github-fixes.js';

export type GatewayOptions = {
  demoServiceUrl?: string;
  accessToken?: string;
  auditPath?: string;
  loadBundle?: () => Promise<IncidentBundle>;
  fixRepository?: FixRepository;
};

export function createGatewayApp(options: GatewayOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 32_768 });
  const demoServiceUrl = options.demoServiceUrl ?? 'http://127.0.0.1:4200';
  const audit = new AuditStore(options.auditPath);
  let executing = false;
  app.addHook('onReady', async () => audit.load());
  app.addHook('onRequest', async (request, reply) => {
    if (!options.accessToken || request.url === '/health') return;
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${options.accessToken}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Configure the gateway access token in Connections.',
      });
    }
  });

  async function requestDemo(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${demoServiceUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    if (!response.ok) throw new Error(`Evidence service HTTP ${response.status}`);
    return response.json();
  }
  async function loadIncidentBundle(): Promise<IncidentBundle> {
    const raw = options.loadBundle ? await options.loadBundle() : await requestDemo('/snapshot');
    return sanitizeBundle(IncidentBundleSchema.parse(raw));
  }
  app.get('/health', async () => ({ service: 'pocketsre-gateway', status: 'healthy' }));
  app.get('/v1/config', async () => ({
    mode: options.loadBundle ? 'live' : 'demo',
    actions: options.loadBundle
      ? ['RUN_HEALTH_CHECK']
      : ['RUN_HEALTH_CHECK', 'TRIGGER_ROLLBACK_WORKFLOW'],
  }));
  app.get('/v1/services', async () => ({ services: [(await loadIncidentBundle()).serviceHealth] }));
  app.get('/v1/incidents/current', async () => loadIncidentBundle());
  app.get('/v1/actions/audit', async () => ({ entries: audit.list() }));
  registerFixRoutes(app, {
    repository: options.loadBundle ? options.fixRepository : undefined,
    loadBundle: loadIncidentBundle,
    audit,
    claim: () => {
      if (executing) return false;
      executing = true;
      return true;
    },
    release: () => {
      executing = false;
    },
  });

  for (const operation of ['break', 'reset']) {
    app.post(`/v1/demo/${operation}`, async (_request, reply) => {
      if (options.loadBundle) return reply.code(403).send({ error: 'demo_disabled' });
      if (executing) return reply.code(409).send({ error: 'action_in_progress' });
      executing = true;
      try {
        return await requestDemo(`/demo/${operation}`, { method: 'POST', body: '{}' });
      } finally {
        executing = false;
      }
    });
  }

  app.post('/v1/actions/execute', async (request, reply) => {
    const parsed = ApprovedActionRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_action', message: 'Malformed approval request.' });
    const input = parsed.data;
    const fingerprint = JSON.stringify({
      ...input,
      parameters: Object.fromEntries(Object.entries(input.parameters).sort()),
    });
    const existing = audit.get(input.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return reply.code(409).send({ error: 'idempotency_conflict' });
      return reply.code(202).send(existing.entry.result);
    }
    if (executing) return reply.code(409).send({ error: 'action_in_progress' });
    if (
      input.action === 'CREATE_GITHUB_ISSUE' ||
      input.action === 'CREATE_GITHUB_PULL_REQUEST' ||
      (options.loadBundle && input.action !== 'RUN_HEALTH_CHECK')
    ) {
      return reply.code(403).send({ error: 'action_not_enabled' });
    }
    const age = Date.now() - Date.parse(input.approvedAt);
    if (age > 120_000 || age < -5_000)
      return reply
        .code(409)
        .send({ error: 'approval_expired', message: 'Refresh and approve the action again.' });
    executing = true;
    try {
      const bundle = await loadIncidentBundle();
      if (
        input.serviceId !== bundle.incident.serviceId ||
        input.target !== bundle.incident.serviceId
      ) {
        return reply.code(403).send({ error: 'target_not_allowed' });
      }
      if (
        input.incidentId !== bundle.incident.id ||
        (input.action !== 'RUN_HEALTH_CHECK' &&
          input.expectedVersion !== bundle.serviceHealth.version)
      ) {
        return reply.code(409).send({
          error: 'stale_incident',
          message: 'The incident changed. Refresh before approving.',
        });
      }
      const healthAge = Date.now() - Date.parse(bundle.serviceHealth.checkedAt);
      if (
        input.action !== 'RUN_HEALTH_CHECK' &&
        (!bundle.serviceHealth.version ||
          !['degraded', 'down'].includes(bundle.serviceHealth.status) ||
          healthAge > 60_000 ||
          healthAge < -5_000 ||
          bundle.collection?.some((item) => item.source === 'Health' && item.status !== 'ok'))
      )
        return reply.code(409).send({ error: 'health_not_verified' });
      const targetRelease = getRollbackTarget(bundle);
      if (
        input.action === 'TRIGGER_ROLLBACK_WORKFLOW' &&
        (!targetRelease ||
          input.parameters.targetRelease !== targetRelease ||
          Object.keys(input.parameters).some((key) => key !== 'targetRelease'))
      ) {
        return reply.code(409).send({ error: 'rollback_not_verified' });
      }
      if (input.action === 'RUN_HEALTH_CHECK' && Object.keys(input.parameters).length)
        return reply.code(400).send({ error: 'unexpected_parameters' });

      const entry: AuditEntry = {
        requestId: input.requestId,
        incidentId: input.incidentId,
        serviceId: input.serviceId,
        action: input.action,
        targetRelease: input.action === 'TRIGGER_ROLLBACK_WORKFLOW' ? targetRelease : null,
        result: {
          actionId: randomUUID(),
          status: 'running',
          message: 'Approved action started.',
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
      };
      await audit.save(entry, fingerprint);
      try {
        if (input.action === 'TRIGGER_ROLLBACK_WORKFLOW') {
          ActionResultSchema.parse(
            await requestDemo('/actions/rollback', {
              method: 'POST',
              body: JSON.stringify({ targetRelease }),
            }),
          );
        }
        const verified = await loadIncidentBundle();
        const verifiedHealthAge = Date.now() - Date.parse(verified.serviceHealth.checkedAt);
        const healthKnown =
          verified.serviceHealth.status !== 'unknown' &&
          verifiedHealthAge <= 60_000 &&
          verifiedHealthAge >= -5_000 &&
          !verified.collection?.some((item) => item.source === 'Health' && item.status !== 'ok');
        const recovered = healthKnown && verified.serviceHealth.status === 'healthy';
        entry.result.status = (input.action === 'RUN_HEALTH_CHECK' ? healthKnown : recovered)
          ? 'succeeded'
          : 'failed';
        entry.result.message =
          input.action === 'RUN_HEALTH_CHECK'
            ? healthKnown
              ? `Health check: ${verified.serviceHealth.status}. ${verified.serviceHealth.version ? `Release ${verified.serviceHealth.version}.` : 'Current release is unknown.'}`
              : 'Health probe could not establish current service health. Review collection evidence; the release is unverified.'
            : recovered
              ? `Recovery verified: the service reports healthy${verified.serviceHealth.version ? ` on release ${verified.serviceHealth.version}` : ''}.`
              : 'Rollback responded, but service health has not recovered.';
      } catch {
        entry.result.status = 'failed';
        entry.result.message =
          'Action outcome could not be verified. Refresh health before attempting another action.';
      }
      entry.result.completedAt = new Date().toISOString();
      await audit.save(entry, fingerprint);
      return reply.code(202).send(entry.result);
    } finally {
      executing = false;
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const status =
      error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 502;
    reply.code(status >= 400 && status < 500 ? status : 502).send({
      error: 'request_failed',
      message:
        'Could not complete the request. Check gateway connectivity and source configuration.',
    });
  });
  return app;
}
