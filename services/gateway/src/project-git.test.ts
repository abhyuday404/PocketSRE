import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayApp } from './app.js';
import { ProjectStore } from './projects.js';
import { GitHubAccount } from './github-account.js';
import { gitDiffFiles } from './project-git.js';
const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});
const id = 'c87e49ea-6a58-4a48-bd25-1574b3bc4c13';
const file = {
  filename: 'src/main.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1 +1 @@\n-old\n+new',
};
async function setup(result: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'pocketsre-git-'));
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
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
  const app = createGatewayApp({
    accessToken: 'fixture-server',
    projects: {
      store,
      github: new GitHubAccount({ token: 'fixture-github', fetcher }),
      allowedHealthOrigins: [],
    },
  });
  clean.push(() => app.close());
  return {
    app,
    fetcher,
    get: (path: string) =>
      app.inject({
        url: `/v1/projects/${id}${path}`,
        headers: { authorization: 'Bearer fixture-server' },
      }),
  };
}
it('authenticates git reads and resolves repositories only from imported projects', async () => {
  const { app, fetcher, get } = await setup([]);
  expect((await app.inject(`/v1/projects/${id}/git/pulls`)).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: '/v1/projects/c87e49ea-6a58-4a48-bd25-1574b3bc4c14/git/pulls',
        headers: { authorization: 'Bearer fixture-server' },
      })
    ).statusCode,
  ).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await get('/git/pulls')).json()).toEqual({ items: [], nextPage: null });
  expect(fetcher.mock.calls[0]![0]).toBe(
    'https://api.github.com/repos/owner/private/pulls?state=open&sort=updated&direction=desc&per_page=20&page=1',
  );
  expect(fetcher.mock.calls[0]![1]?.method).toBeUndefined();
  expect((await get('/git/pulls?page=0')).statusCode).toBe(400);
});
it('encodes branch refs and returns truthful comparison limits and bounded diffs', async () => {
  const { get, fetcher } = await setup({
    status: 'ahead',
    ahead_by: 2,
    behind_by: 0,
    files: [file],
  });
  const response = await get('/git/compare?base=main&head=feature%2Flogin');
  expect(response.statusCode).toBe(200);
  expect(String(fetcher.mock.calls[0]![0])).toContain('/compare/main...feature%2Flogin?');
  expect(response.json()).toMatchObject({
    limited: false,
    nextPage: null,
    summary: 'ahead · 2 ahead · 0 behind',
    files: [{ patch: file.patch, patchTruncated: false }],
  });
  expect((await get('/git/compare?base=main&head=feature%0Aother')).statusCode).toBe(400);
});
it('paginates PR files and preserves renamed and binary files', async () => {
  const { get } = await setup(
    Array.from({ length: 20 }, (_, i) => ({
      ...file,
      filename: `file${i}`,
      previous_filename: 'old',
      patch: undefined,
    })),
  );
  const response = (await get('/git/pulls/12/files?page=2')).json();
  expect(response.nextPage).toBe(3);
  expect(response.files[0]).toMatchObject({
    previous_filename: 'old',
    patch: null,
    patchTruncated: false,
  });
  expect((await get('/git/pulls/-1/files')).statusCode).toBe(400);
});
it('bounds individual and total patch previews without pretending they are complete', () => {
  const files = gitDiffFiles(
    Array.from({ length: 20 }, () => ({ ...file, patch: 'x'.repeat(20000) })),
  );
  expect(files.reduce((sum, f) => sum + (f.patch?.length ?? 0), 0)).toBe(120000);
  expect(files.every((f) => f.patchTruncated)).toBe(true);
});
it('exposes a separate action ledger for each imported project', async () => {
  const { get } = await setup([]);
  const response = await get('/activity/actions');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ entries: [] });
});

it('protects code browsing and rejects untrusted paths before calling GitHub', async () => {
  const { app, get, fetcher } = await setup({ sha: 'a'.repeat(40), tree: [], truncated: false });
  expect((await app.inject(`/v1/projects/${id}/git/code`)).statusCode).toBe(401);
  expect((await get('/git/code?path=..%2Fsecret')).statusCode).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await get('/git/code')).json()).toMatchObject({ kind: 'directory', entries: [] });
});
