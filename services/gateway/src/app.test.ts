import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoApp } from '@pocketsre/demo-service/app';
import { createGatewayApp } from './app.js';

const closeables: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(closeables.splice(0).map((app) => app.close()));
});

describe('gateway', () => {
  it('normalizes an incident and executes an approved rollback', async () => {
    const demo = createDemoApp();
    closeables.push(demo);
    await demo.listen({ host: '127.0.0.1', port: 0 });
    const address = demo.server.address() as AddressInfo;
    const gateway = createGatewayApp({ demoServiceUrl: `http://127.0.0.1:${address.port}` });
    closeables.push(gateway);

    await gateway.inject({ method: 'POST', url: '/v1/demo/break' });
    const incidentResponse = await gateway.inject({ method: 'GET', url: '/v1/incidents/current' });
    const incident = incidentResponse.json();

    expect(incident.serviceHealth.status).toBe('degraded');
    expect(incident.evidence).toHaveLength(6);

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
        parameters: { targetRelease: 'rel-2026.09.1' },
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
