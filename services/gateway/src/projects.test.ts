import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGatewayApp } from './app.js';
import { GitHubAccount } from './github-account.js';
import { ProjectStore } from './projects.js';
import { VercelProvider } from './providers.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(operations = false) {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-projects-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const provider = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/user') return Response.json({ login: 'reviewer' });
    const name = url.pathname.endsWith('/two') ? 'two' : 'one';
    const repo = {
      id: name === 'two' ? 2 : 1,
      full_name: `reviewer/${name}`,
      private: true,
      default_branch: 'main',
    };
    return Response.json(url.pathname === '/user/repos' ? [repo] : repo);
  });
  const statuses = { one: 200, two: 500 };
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/two' ? statuses.two : statuses.one);
    response.end('availability fixture');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const healthFetch = vi.fn<typeof fetch>((...args) => fetch(...args));
  const store = new ProjectStore(directory);
  const app = createGatewayApp({
    accessToken: 'test-gateway',
    projects: {
      github: new GitHubAccount({ token: 'test-github', fetcher: provider }),
      store,
      allowedHealthOrigins: [origin],
      fetcher: healthFetch,
      ...(operations
        ? {
            vercel: new VercelProvider('fixture-vercel', '', async (input) => {
              const path = new URL(String(input)).pathname;
              const project = {
                id: 'prj_test',
                name: 'checkout',
                link: { type: 'github', org: 'reviewer', repo: 'one' },
              };
              if (path === '/v10/projects') return Response.json({ projects: [project] });
              if (path === '/v9/projects/prj_test') return Response.json(project);
              if (path === '/v7/deployments')
                return Response.json({ deployments: [{ uid: 'dpl_test' }] });
              return Response.json([{ message: 'Checkout failed', timestampInMs: Date.now() }]);
            }),
            monitor: {
              path: join(directory, 'monitor.json'),
              intervalMs: 1000000,
              push: {
                send: vi.fn().mockRejectedValue(new Error('No real pushes in tests')),
                receipt: vi.fn().mockResolvedValue('sent'),
              },
            },
          }
        : {}),
    },
  });
  cleanups.push(() => app.close());
  const get = (url: string) =>
    app.inject({ url, headers: { authorization: 'Bearer test-gateway' } });
  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: 'Bearer test-gateway' } });
  return { app, store, get, send, directory, origin, statuses, healthFetch, provider };
}

it('requires gateway authentication and reports projects disabled without configuration', async () => {
  const { app } = await setup();
  expect((await app.inject('/v1/github/connection')).statusCode).toBe(401);
  expect((await app.inject('/v1/projects')).statusCode).toBe(401);
  const legacy = createGatewayApp();
  cleanups.push(() => legacy.close());
  expect((await legacy.inject('/v1/github/connection')).json().enabled).toBe(false);
  expect(
    (
      await legacy.inject({
        method: 'POST',
        url: '/v1/projects',
        payload: { repository: 'reviewer/one' },
      })
    ).statusCode,
  ).toBe(409);
});

it('links provider evidence to a project and persists monitoring and phone subscriptions behind authentication', async () => {
  const { app, send, get, origin, directory } = await setup(true);
  expect((await app.inject('/v1/providers/vercel')).statusCode).toBe(401);
  const project = (await send('POST', '/v1/projects', { repository: 'reviewer/one' })).json();
  const base = `/v1/projects/${project.id}`;
  expect((await send('PUT', `${base}/monitor`, { enabled: true })).statusCode).toBe(400);
  await send('PUT', `${base}/health`, { healthUrl: `${origin}/one` });
  expect((await get(`${base}/deployments/available`)).json().projects[0].suggested).toBe(true);
  expect(
    (
      await send('PUT', `${base}/deployment`, { projectId: 'prj_test', target: 'production' })
    ).json().deployment.projectId,
  ).toBe('prj_test');
  const incident = (await get(`${base}/incident`)).json();
  expect(incident.evidence.some((event: { source: string }) => event.source === 'deployment')).toBe(
    true,
  );
  expect((await send('PUT', `${base}/monitor`, { enabled: true })).json().monitoring).toBe(true);
  expect((await get(`${base}/monitor`)).json().enabled).toBe(true);
  const deviceId = '90f85cd5-818c-4286-9714-9a890636765c';
  expect(
    (await send('PUT', `${base}/notifications`, { deviceId, token: 'invalid' })).statusCode,
  ).toBe(400);
  expect(
    (
      await send('PUT', `${base}/notifications`, { deviceId, token: 'ExpoPushToken[fixture]' })
    ).json().enabled,
  ).toBe(true);
  expect(
    JSON.parse(await readFile(join(directory, 'monitor.json'), 'utf8')).subscriptions,
  ).toHaveLength(1);
  await send('PUT', `${base}/notifications`, { deviceId, token: null });
  expect(
    JSON.parse(await readFile(join(directory, 'monitor.json'), 'utf8')).subscriptions,
  ).toHaveLength(0);
});

it('saves accessible repositories durably and does not lose concurrent selections or duplicate a repository', async () => {
  const { send, get, store, directory } = await setup();
  const [one, two] = await Promise.all(
    ['one', 'two'].map((name) => send('POST', '/v1/projects', { repository: `reviewer/${name}` })),
  );
  expect(one!.statusCode).toBe(200);
  expect(two!.statusCode).toBe(200);
  const again = await send('POST', '/v1/projects', { repository: 'reviewer/one' });
  expect(again.json().id).toBe(one!.json().id);
  expect((await get('/v1/projects')).json().projects).toHaveLength(2);
  expect(await new ProjectStore(directory).list()).toEqual(await store.list());
  expect(await readFile(join(directory, 'projects.json'), 'utf8')).not.toContain('test-github');
  expect(
    (await send('POST', '/v1/projects', { repository: 'reviewer/one', id: 'spoof' })).statusCode,
  ).not.toBe(200);
});

it('keeps project probes and incidents separate and verifies real HTTP recovery', async () => {
  const { send, get, origin, statuses, healthFetch } = await setup();
  const one = (await send('POST', '/v1/projects', { repository: 'reviewer/one' })).json();
  const two = (await send('POST', '/v1/projects', { repository: 'reviewer/two' })).json();
  expect((await get(`/v1/projects/${one.id}/incident`)).statusCode).toBe(409);
  for (const [project, path] of [
    [one, 'one'],
    [two, 'two'],
  ] as const)
    expect(
      (await send('PUT', `/v1/projects/${project.id}/health`, { healthUrl: `${origin}/${path}` }))
        .statusCode,
    ).toBe(200);
  const healthy = (await get(`/v1/projects/${one.id}/incident`)).json();
  const down = (await get(`/v1/projects/${two.id}/incident`)).json();
  expect(healthy.serviceHealth).toMatchObject({
    serviceId: 'github:1',
    status: 'healthy',
    version: null,
  });
  expect(down.serviceHealth).toMatchObject({ serviceId: 'github:2', status: 'down' });
  expect(down.incident.id).not.toBe(healthy.incident.id);
  statuses.two = 200;
  expect((await get(`/v1/projects/${two.id}/incident`)).json().incident.status).toBe('resolved');
  statuses.one = 401;
  expect((await get(`/v1/projects/${one.id}/incident`)).json().serviceHealth.status).toBe(
    'unknown',
  );
  for (const call of healthFetch.mock.calls) {
    expect(call[1]?.redirect).toBe('error');
    expect(call[1]?.headers).not.toHaveProperty('authorization');
  }
});

it('rejects unapproved hosts and credential-bearing URLs without fetching them', async () => {
  const { send, get, origin, healthFetch } = await setup();
  const project = (await send('POST', '/v1/projects', { repository: 'reviewer/one' })).json();
  for (const healthUrl of [
    'http://169.254.169.254/metadata',
    `${origin}/health?token=secret`,
    origin.replace('http://', 'http://user:pass@'),
    'file:///etc/passwd',
  ]) {
    expect(
      (await send('PUT', `/v1/projects/${project.id}/health`, { healthUrl })).statusCode,
    ).not.toBe(200);
  }
  expect(healthFetch).not.toHaveBeenCalled();
  expect((await get('/v1/projects')).json().projects[0].healthUrl).toBeNull();
  await send('DELETE', `/v1/projects/${project.id}`);
  expect((await get(`/v1/projects/${project.id}/incident`)).statusCode).toBe(404);
});

it('reads only selected project source and isolates draft contexts between projects', async () => {
  const { send, get, provider } = await setup();
  const one = (await send('POST', '/v1/projects', { repository: 'reviewer/one' })).json();
  const two = (await send('POST', '/v1/projects', { repository: 'reviewer/two' })).json();
  for (const project of [one, two])
    expect(
      (await send('PUT', `/v1/projects/${project.id}/source`, { paths: ['src/app.ts'] }))
        .statusCode,
    ).toBe(200);
  expect((await send('PUT', `/v1/projects/${one.id}/source`, { paths: ['.env'] })).statusCode).toBe(
    400,
  );
  const commit = 'a'.repeat(40),
    tree = 'b'.repeat(40),
    blob = 'c'.repeat(40);
  const source = 'export const value = 1;';
  provider.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    expect(init?.method ?? 'GET').toBe('GET');
    if (path.includes('/git/ref/')) return Response.json({ object: { sha: commit } });
    if (path.includes('/git/commits/')) return Response.json({ sha: commit, tree: { sha: tree } });
    if (path.includes('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: [
          { path: 'src/app.ts', mode: '100644', type: 'blob', sha: blob, size: source.length },
        ],
      });
    if (path.includes('/git/blobs/'))
      return Response.json({
        sha: blob,
        encoding: 'base64',
        content: Buffer.from(source).toString('base64'),
      });
    return Response.json({ default_branch: 'main' });
  });
  expect((await get(`/v1/projects/${one.id}/fixes/config`)).json()).toMatchObject({
    enabled: true,
    canPublish: false,
    repository: 'reviewer/one',
  });
  const contextResponse = await send('POST', `/v1/projects/${one.id}/fixes/context`, {
    incidentId: 'any',
    paths: ['src/app.ts'],
    task: { request: 'Change value to two.', history: [] },
  });
  expect(contextResponse.statusCode).toBe(200);
  const context = contextResponse.json();
  expect(context.repository).toBe('reviewer/one');
  const evidenceIds = [context.bundle.evidence[0].id];
  const proposal = {
    summary: 'Change the requested value.',
    evidenceIds,
    edits: [
      {
        path: 'src/app.ts',
        before: 'value = 1',
        after: 'value = 2',
        reason: 'Requested change.',
        evidenceIds,
      },
    ],
  };
  expect(
    (
      await send('POST', `/v1/projects/${two.id}/fixes/prepare`, {
        contextId: context.id,
        proposal,
      })
    ).statusCode,
  ).not.toBe(200);
  const prepared = await send('POST', `/v1/projects/${one.id}/fixes/prepare`, {
    contextId: context.id,
    proposal,
  });
  expect(prepared.statusCode).toBe(200);
  const result = await send('POST', `/v1/projects/${one.id}/fixes/execute`, {
    draftId: prepared.json().id,
    requestId: '14653730-290e-48b2-8513-93d40ec28ec8',
    approvedAt: new Date().toISOString(),
  });
  expect(result.statusCode).toBe(403);
  await send('PUT', `/v1/projects/${one.id}/source`, { paths: ['src/app.ts'] });
  expect(
    (
      await send('POST', `/v1/projects/${one.id}/fixes/prepare`, {
        contextId: context.id,
        proposal,
      })
    ).statusCode,
  ).toBe(409);
  await send('DELETE', `/v1/projects/${one.id}`);
  expect((await get(`/v1/projects/${one.id}/fixes/config`)).statusCode).toBe(404);
});
