import { afterEach, describe, expect, it } from 'vitest';
import { createDemoApp } from './app.js';

const apps: ReturnType<typeof createDemoApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('demo service', () => {
  it('moves through break and rollback states', async () => {
    const app = createDemoApp();
    apps.push(app);

    const initial = await app.inject({ method: 'GET', url: '/health' });
    expect(initial.json().status).toBe('healthy');

    await app.inject({ method: 'POST', url: '/demo/break' });
    const broken = await app.inject({ method: 'GET', url: '/health' });
    expect(broken.json().status).toBe('degraded');

    await app.inject({
      method: 'POST',
      url: '/actions/rollback',
      payload: { targetRelease: 'rel-2026.09.1' },
    });
    const recovered = await app.inject({ method: 'GET', url: '/health' });
    expect(recovered.json().status).toBe('healthy');
  });
});
