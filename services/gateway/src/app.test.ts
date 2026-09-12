import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentBundleSchema } from '@pocketsre/contracts';
import { createDemoApp } from '@pocketsre/demo-service/app';
import { createDeterministicDiagnosis, validateDiagnosis } from '@pocketsre/incident-engine';
import { createGatewayApp } from './app.js';
import { createLiveBundleLoader } from './connectors.js';

const closeables: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(closeables.splice(0).map((app) => app.close()));
});

describe('gateway', () => {
  it('serves live failure evidence and permits read-only retries without claiming unknown health succeeded', async () => {
    let reachable = false;
    const loadBundle = createLiveBundleLoader({
      healthUrl: 'https://example.com/health',
      serviceId: 'api',
      serviceName: 'API',
      connectors: [],
      fetcher: vi.fn<typeof fetch>().mockImplementation(async () => {
        if (!reachable) throw new TypeError('private connection details');
        return Response.json({
          serviceId: 'api',
          serviceName: 'API',
          status: 'healthy',
          version: 'v2',
          checkedAt: new Date().toISOString(),
          checks: { api: 'healthy' },
        });
      }),
    });
    const gateway = createGatewayApp({ loadBundle });
    closeables.push(gateway);
    const response = await gateway.inject({ method: 'GET', url: '/v1/incidents/current' });
    expect(response.statusCode).toBe(200);
    const initial = IncidentBundleSchema.parse(response.json());
    expect(initial.serviceHealth).toMatchObject({ status: 'unknown', version: null });
    expect(
      (await gateway.inject({ method: 'GET', url: '/v1/services' })).json().services[0].status,
    ).toBe('unknown');
    const payload = {
      requestId: randomUUID(),
      incidentId: initial.incident.id,
      serviceId: 'api',
      target: 'api',
      action: 'RUN_HEALTH_CHECK',
      expectedVersion: null,
      approvedAt: new Date().toISOString(),
      parameters: {},
    };
    const unavailable = await gateway.inject({
      method: 'POST',
      url: '/v1/actions/execute',
      payload,
    });
    expect(unavailable.statusCode).toBe(202);
    expect(unavailable.json()).toMatchObject({ status: 'failed' });
    expect(unavailable.json().message).not.toMatch(/Release null|Recovery verified/);
    expect(
      (
        await gateway.inject({
          method: 'POST',
          url: '/v1/actions/execute',
          payload: { ...payload, requestId: randomUUID(), action: 'TRIGGER_ROLLBACK_WORKFLOW' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await gateway.inject({
          method: 'POST',
          url: '/v1/actions/execute',
          payload: {
            ...payload,
            requestId: randomUUID(),
            action: 'TRIGGER_ROLLBACK_WORKFLOW',
            expectedVersion: 'old',
          },
        })
      ).statusCode,
    ).toBe(403);
    reachable = true;
    const verified = await gateway.inject({
      method: 'POST',
      url: '/v1/actions/execute',
      payload: { ...payload, requestId: randomUUID() },
    });
    expect(verified.statusCode).toBe(202);
    expect(verified.json()).toMatchObject({
      status: 'succeeded',
      message: 'Health check: healthy. Release v2.',
    });
    const recovered = (
      await gateway.inject({ method: 'GET', url: '/v1/incidents/current' })
    ).json();
    expect(recovered.incident).toMatchObject({
      id: initial.incident.id,
      startedAt: initial.incident.startedAt,
      status: 'resolved',
    });
    expect(recovered.evidence.length).toBeGreaterThan(initial.evidence.length);
  });

  it.each(['unknown', 'stale', 'unavailable'])(
    'rejects rollback with %s health even when old deployment evidence remains',
    async (condition) => {
      const demo = createDemoApp();
      closeables.push(demo);
      demo.addHook('preSerialization', async (request, _reply, payload) => {
        if (request.url !== '/snapshot') return payload;
        const snapshot = IncidentBundleSchema.parse(payload);
        if (condition === 'unknown') snapshot.serviceHealth.status = 'unknown';
        if (condition === 'stale')
          snapshot.serviceHealth.checkedAt = new Date(Date.now() - 120_000).toISOString();
        if (condition === 'unavailable')
          snapshot.collection = [
            { source: 'Health', status: 'unavailable', message: 'Health unavailable' },
          ];
        return snapshot;
      });
      await demo.listen({ host: '127.0.0.1', port: 0 });
      const address = demo.server.address() as AddressInfo;
      const gateway = createGatewayApp({ demoServiceUrl: `http://127.0.0.1:${address.port}` });
      closeables.push(gateway);
      await gateway.inject({ method: 'POST', url: '/v1/demo/break' });
      const snapshot = (
        await gateway.inject({ method: 'GET', url: '/v1/incidents/current' })
      ).json();
      const rejected = await gateway.inject({
        method: 'POST',
        url: '/v1/actions/execute',
        payload: {
          requestId: randomUUID(),
          incidentId: snapshot.incident.id,
          expectedVersion: snapshot.serviceHealth.version,
          serviceId: 'checkout-api',
          target: 'checkout-api',
          action: 'TRIGGER_ROLLBACK_WORKFLOW',
          parameters: { targetRelease: 'rel-2026.09.1' },
          approvedAt: new Date().toISOString(),
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error).toBe('health_not_verified');
      expect((await demo.inject({ method: 'POST', url: '/checkout' })).statusCode).toBe(500);
      expect(
        (await gateway.inject({ method: 'GET', url: '/v1/actions/audit' })).json().entries,
      ).toEqual([]);
    },
  );

  it('does not claim recovery when rollback responds but the verification probe is inconclusive', async () => {
    const demo = createDemoApp();
    closeables.push(demo);
    let obscureHealth = false;
    demo.addHook('onRequest', async (request) => {
      if (request.url === '/actions/rollback') obscureHealth = true;
    });
    demo.addHook('preSerialization', async (request, _reply, payload) => {
      if (request.url !== '/snapshot' || !obscureHealth) return payload;
      const snapshot = IncidentBundleSchema.parse(payload);
      snapshot.serviceHealth.status = 'unknown';
      snapshot.serviceHealth.version = null;
      snapshot.serviceHealth.checks = {};
      return snapshot;
    });
    await demo.listen({ host: '127.0.0.1', port: 0 });
    const address = demo.server.address() as AddressInfo;
    const gateway = createGatewayApp({ demoServiceUrl: `http://127.0.0.1:${address.port}` });
    closeables.push(gateway);
    await gateway.inject({ method: 'POST', url: '/v1/demo/break' });
    const snapshot = (await gateway.inject({ method: 'GET', url: '/v1/incidents/current' })).json();
    const result = await gateway.inject({
      method: 'POST',
      url: '/v1/actions/execute',
      payload: {
        requestId: randomUUID(),
        incidentId: snapshot.incident.id,
        expectedVersion: snapshot.serviceHealth.version,
        serviceId: 'checkout-api',
        target: 'checkout-api',
        action: 'TRIGGER_ROLLBACK_WORKFLOW',
        parameters: { targetRelease: 'rel-2026.09.1' },
        approvedAt: new Date().toISOString(),
      },
    });
    expect(result.statusCode).toBe(202);
    expect(result.json().status).toBe('failed');
    expect(result.json().message).not.toContain('Recovery verified');
  });

  it('normalizes an incident and executes an approved rollback', async () => {
    const demo = createDemoApp();
    closeables.push(demo);
    await demo.listen({ host: '127.0.0.1', port: 0 });
    const address = demo.server.address() as AddressInfo;
    const gateway = createGatewayApp({ demoServiceUrl: `http://127.0.0.1:${address.port}` });
    closeables.push(gateway);

    expect((await demo.inject({ method: 'POST', url: '/checkout' })).statusCode).toBe(200);
    await gateway.inject({ method: 'POST', url: '/v1/demo/break' });
    expect((await demo.inject({ method: 'POST', url: '/checkout' })).statusCode).toBe(500);
    const incidentResponse = await gateway.inject({ method: 'GET', url: '/v1/incidents/current' });
    const incident = incidentResponse.json();

    expect(incident.serviceHealth.status).toBe('degraded');
    expect(incident.evidence).toHaveLength(6);
    const diagnosis = createDeterministicDiagnosis(incident);
    expect(validateDiagnosis(diagnosis, incident).success).toBe(true);
    expect(diagnosis.proposedAction?.type).toBe('TRIGGER_ROLLBACK_WORKFLOW');

    const actionResponse = await gateway.inject({
      method: 'POST',
      url: '/v1/actions/execute',
      payload: {
        requestId: randomUUID(),
        expectedVersion: incident.serviceHealth.version,
        incidentId: incident.incident.id,
        serviceId: 'checkout-api',
        action: 'TRIGGER_ROLLBACK_WORKFLOW',
        target: 'checkout-api',
        parameters: diagnosis.proposedAction!.parameters,
        approvedAt: new Date().toISOString(),
      },
    });
    expect(actionResponse.statusCode).toBe(202);
    const after = (await gateway.inject({ method: 'GET', url: '/v1/incidents/current' })).json();
    expect(after.incident.id).toBe(incident.incident.id);
    expect(after.incident.startedAt).toBe(incident.incident.startedAt);
    expect(after.evidence.length).toBeGreaterThan(incident.evidence.length);

    const servicesResponse = await gateway.inject({ method: 'GET', url: '/v1/services' });
    expect(servicesResponse.json().services[0].status).toBe('healthy');
    expect((await demo.inject({ method: 'POST', url: '/checkout' })).statusCode).toBe(200);
    expect(createDeterministicDiagnosis(after).proposedAction).toBeNull();
  });

  it('rejects an unapproved action type', async () => {
    const demo = createDemoApp();
    closeables.push(demo);
    await demo.listen({ host: '127.0.0.1', port: 0 });
    const address = demo.server.address() as AddressInfo;
    const gateway = createGatewayApp({ demoServiceUrl: `http://127.0.0.1:${address.port}` });
    closeables.push(gateway);

    const response = await gateway.inject({
      method: 'POST',
      url: '/v1/actions/execute',
      payload: {
        incidentId: 'inc-1',
        serviceId: 'checkout-api',
        action: 'RUN_ARBITRARY_COMMAND',
        target: 'checkout-api',
        parameters: {},
        approvedAt: new Date().toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('guards approvals, verifies targets, and deduplicates rollback requests', async () => {
    const demo = createDemoApp();
    closeables.push(demo);
    await demo.listen({ host: '127.0.0.1', port: 0 });
    const address = demo.server.address() as AddressInfo;
    const gateway = createGatewayApp({
      demoServiceUrl: `http://127.0.0.1:${address.port}`,
      accessToken: 'test-only-token',
    });
    closeables.push(gateway);
    expect((await gateway.inject({ method: 'GET', url: '/v1/incidents/current' })).statusCode).toBe(
      401,
    );
    const headers = { authorization: 'Bearer test-only-token' };
    await gateway.inject({ method: 'POST', url: '/v1/demo/break', headers });
    const bundle = (
      await gateway.inject({ method: 'GET', url: '/v1/incidents/current', headers })
    ).json();
    const again = (
      await gateway.inject({ method: 'GET', url: '/v1/incidents/current', headers })
    ).json();
    expect(again.evidence).toEqual(bundle.evidence);
    const payload = {
      requestId: randomUUID(),
      incidentId: bundle.incident.id,
      expectedVersion: bundle.serviceHealth.version,
      serviceId: 'checkout-api',
      target: 'checkout-api',
      action: 'TRIGGER_ROLLBACK_WORKFLOW',
      approvedAt: new Date().toISOString(),
      parameters: { targetRelease: 'rel-2026.09.1' },
    };
    const execute = (body: unknown) =>
      gateway.inject({
        method: 'POST',
        url: '/v1/actions/execute',
        headers,
        payload: body as Record<string, unknown>,
      });
    expect((await execute({ ...payload, expectedVersion: 'stale' })).statusCode).toBe(409);
    expect((await execute({ ...payload, target: 'other' })).statusCode).toBe(403);
    expect((await execute({ ...payload, approvedAt: '2020-01-01T00:00:00.000Z' })).statusCode).toBe(
      409,
    );
    expect(
      (await execute({ ...payload, parameters: { targetRelease: 'invented' } })).statusCode,
    ).toBe(409);
    const action = await execute(payload);
    expect(action.json().status).toBe('succeeded');
    expect((await execute(payload)).json()).toEqual(action.json());
    expect((await execute({ ...payload, target: 'other' })).statusCode).toBe(409);
    const audit = (
      await gateway.inject({ method: 'GET', url: '/v1/actions/audit', headers })
    ).json();
    expect(audit.entries).toHaveLength(1);
  });
});
