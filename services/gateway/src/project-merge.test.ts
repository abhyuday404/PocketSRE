import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createGatewayApp } from './app.js';
import { ProjectStore } from './projects.js';
import { GitHubAccount } from './github-account.js';
const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});
const id = 'c87e49ea-6a58-4a48-bd25-1574b3bc4c13';
const sha = 'a'.repeat(40),
  baseSha = 'b'.repeat(40);
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pocketsre-merges-'));
  clean.push(() => rm(dir, { recursive: true, force: true }));
  const store = new ProjectStore(dir);
  await store.update(() => [
    {
      id,
      repository: { id: 1, fullName: 'owner/private', private: true, defaultBranch: 'main' },
      createdAt: new Date().toISOString(),
      healthUrl: null,
      monitoring: false,
      deployment: null,
      sourcePaths: [],
    },
  ]);
  const pull = {
    number: 12,
    node_id: 'PR_fixture',
    title: 'Fix timeout',
    state: 'open',
    draft: false,
    merged: false,
    mergeable: true as boolean | null,
    mergeable_state: 'clean',
    head: { sha, ref: 'fix' },
    base: { sha: baseSha, ref: 'main' },
  };
  const repo = {
    permissions: { push: true },
    allow_merge_commit: true,
    allow_squash_merge: true,
    allow_rebase_merge: false,
  };
  const runs = {
    total_count: 1,
    check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }],
  };
  const statuses = { total_count: 0, statuses: [] };
  const write = vi.fn(async () =>
    Response.json({ merged: true, sha: 'c'.repeat(40), message: 'merged' }),
  );
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'PUT') return write();
    const path = new URL(String(url)).pathname;
    if (path === '/graphql')
      return Response.json({
        data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
      });
    if (path.endsWith('/pulls/12')) return Response.json(pull);
    if (path.endsWith('/check-runs')) return Response.json(runs);
    if (path.endsWith('/status')) return Response.json(statuses);
    if (path.endsWith('/files')) return Response.json([]);
    return Response.json(repo);
  });
  function create(projectStore = store) {
    const app = createGatewayApp({
      accessToken: 'fixture-server',
      projects: {
        store: projectStore,
        fixToken: 'fixture-publication',
        fixRepositories: ['owner/private'],
        github: new GitHubAccount({ token: 'fixture-github', fetcher }),
        allowedHealthOrigins: [],
      },
    });
    clean.push(() => app.close());
    return app;
  }
  const app = create();
  const headers = { authorization: 'Bearer fixture-server' };
  const body = () => ({
    requestId: randomUUID(),
    approvedAt: new Date().toISOString(),
    sha,
    baseSha,
    baseRef: 'main',
    method: 'squash',
  });
  const url = `/v1/projects/${id}/actions/pulls/12/merge`;
  return {
    app,
    create,
    dir,
    fetcher,
    write,
    pull,
    repo,
    runs,
    body,
    url,
    headers,
    preview: () => app.inject({ url: `/v1/projects/${id}/git/pulls/12/merge`, headers }),
    merge: (payload = body()) => app.inject({ method: 'POST', url, headers, payload }),
  };
}
it('requires authorization, valid confirmation and an imported project before any write', async () => {
  const s = await setup();
  expect((await s.app.inject({ method: 'POST', url: s.url, payload: s.body() })).statusCode).toBe(
    401,
  );
  expect((await s.merge({ ...s.body(), sha: 'main' })).statusCode).toBe(400);
  expect(
    (
      await s.app.inject({
        method: 'POST',
        url: s.url.replace(id, randomUUID()),
        headers: s.headers,
        payload: s.body(),
      })
    ).statusCode,
  ).toBe(404);
  expect(s.write).not.toHaveBeenCalled();
});
it('merges only the confirmed SHA and allowed method, audits it and replays without another write after restart', async () => {
  const s = await setup(),
    body = s.body();
  expect((await s.preview()).json()).toMatchObject({
    ready: true,
    methods: ['squash', 'merge'],
    checks: [{ name: 'CI', state: 'success' }],
  });
  expect((await s.merge(body)).json().status).toBe('succeeded');
  const writeCall = s.fetcher.mock.calls.find((c) => c[1]?.method === 'PUT')!;
  expect(writeCall[0]).toBe('https://api.github.com/repos/owner/private/pulls/12/merge');
  expect(JSON.parse(String(writeCall[1]?.body))).toEqual({ sha, merge_method: 'squash' });
  expect((await s.merge(body)).json().status).toBe('succeeded');
  const restarted = s.create(new ProjectStore(s.dir));
  expect(
    (
      await restarted.inject({ method: 'POST', url: s.url, headers: s.headers, payload: body })
    ).json().status,
  ).toBe('succeeded');
  expect(s.write).toHaveBeenCalledTimes(1);
  expect((await s.merge({ ...body, method: 'merge' })).statusCode).toBe(409);
  const audit = await s.app.inject({
    url: `/v1/projects/${id}/activity/actions`,
    headers: s.headers,
  });
  expect(audit.json().entries[0]).toMatchObject({
    action: 'MERGE_GITHUB_PULL_REQUEST',
    serviceId: 'github:1',
    targetRelease: sha,
  });
});
it.each(['blocked', 'behind', 'dirty', 'unstable', 'unknown'])(
  'does not bypass GitHub merge state %s',
  async (state) => {
    const s = await setup();
    s.pull.mergeable_state = state;
    expect((await s.preview()).json().ready).toBe(false);
    expect((await s.merge()).statusCode).toBe(409);
    expect(s.write).not.toHaveBeenCalled();
  },
);
it('rejects draft, missing write access, incomplete checks and running checks', async () => {
  const s = await setup();
  s.pull.draft = true;
  expect((await s.merge()).statusCode).toBe(409);
  s.pull.draft = false;
  s.repo.permissions.push = false;
  expect((await s.merge()).statusCode).toBe(409);
  s.repo.permissions.push = true;
  s.runs.total_count = 101;
  expect((await s.merge()).statusCode).toBe(409);
  s.runs.total_count = 1;
  s.runs.check_runs[0]!.status = 'in_progress';
  expect((await s.merge()).statusCode).toBe(409);
  expect(s.write).not.toHaveBeenCalled();
});
it('rechecks both branches and expires old confirmations', async () => {
  const s = await setup();
  await s.preview();
  s.pull.head.sha = 'd'.repeat(40);
  expect((await s.merge()).statusCode).toBe(409);
  s.pull.head.sha = sha;
  s.pull.base.sha = 'e'.repeat(40);
  expect((await s.merge()).statusCode).toBe(409);
  s.pull.base.sha = baseSha;
  expect((await s.merge({ ...s.body(), approvedAt: '2020-01-01T00:00:00.000Z' })).statusCode).toBe(
    409,
  );
  expect((await s.merge({ ...s.body(), method: 'rebase' })).statusCode).toBe(409);
  expect(s.write).not.toHaveBeenCalled();
});
it('preserves an ambiguous outcome and blocks new requests instead of retrying a write', async () => {
  const s = await setup(),
    body = s.body();
  s.write.mockRejectedValue(new Error('network timeout'));
  expect((await s.merge(body)).statusCode).toBe(202);
  expect((await s.merge(body)).json().status).toBe('running');
  expect((await s.merge()).statusCode).toBe(409);
  const restarted = s.create(new ProjectStore(s.dir));
  expect(
    (await restarted.inject({ method: 'POST', url: s.url, headers: s.headers, payload: body }))
      .statusCode,
  ).toBe(202);
  expect(s.write).toHaveBeenCalledTimes(1);
});
it('records explicit GitHub rejection as failed', async () => {
  const s = await setup();
  s.write.mockResolvedValue(new Response('', { status: 405 }));
  expect((await s.merge()).json().status).toBe('failed');
});
it('rejects a diff whose reviewed head no longer matches GitHub', async () => {
  const s = await setup();
  s.pull.head.sha = 'c'.repeat(40);
  const response = await s.app.inject({
    url: `/v1/projects/${id}/git/pulls/12/files?sha=${sha}`,
    headers: s.headers,
  });
  expect(response.statusCode).toBe(409);
  expect(s.fetcher.mock.calls.some((c) => String(c[0]).includes('/files'))).toBe(false);
});

it('marks a reviewed draft ready through an audited idempotent action', async () => {
  const s = await setup();
  s.pull.draft = true;
  const body = { requestId: randomUUID(), approvedAt: new Date().toISOString(), sha };
  const call = () =>
    s.app.inject({
      method: 'POST',
      url: s.url.replace('/merge', '/ready'),
      headers: s.headers,
      payload: body,
    });
  expect((await s.preview()).json().canMarkReady).toBe(true);
  expect((await call()).json().status).toBe('succeeded');
  expect((await call()).json().status).toBe('succeeded');
  const writes = s.fetcher.mock.calls.filter((c) => String(c[0]).endsWith('/graphql'));
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0]![1]?.body)).variables).toEqual({
    id: 'PR_fixture',
    request: body.requestId,
  });
  expect(s.write).not.toHaveBeenCalled();
});
it('refuses to mark a draft ready if its head changed after review', async () => {
  const s = await setup();
  s.pull.head.sha = 'e'.repeat(40);
  const response = await s.app.inject({
    method: 'POST',
    url: s.url.replace('/merge', '/ready'),
    headers: s.headers,
    payload: { requestId: randomUUID(), approvedAt: new Date().toISOString(), sha },
  });
  expect(response.statusCode).toBe(409);
  expect(s.fetcher.mock.calls.some((c) => String(c[0]).endsWith('/graphql'))).toBe(false);
});
