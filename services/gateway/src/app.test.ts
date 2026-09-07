import type { AddressInfo } from 'node:net';
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
        incidentId: incident.incident.id,
        serviceId: 'checkout-api',
        action: 'TRIGGER_ROLLBACK_WORKFLOW',
        target: 'checkout-api',
        parameters: { targetRelease: 'rel-2026.09.1' },
        approvedAt: new Date().toISOString(),
      },
    });
    expect(actionResponse.statusCode).toBe(202);

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
});
