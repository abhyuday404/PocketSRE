import { describe, expect, it, vi } from 'vitest';
import type { FixContext, FixDraft } from '@pocketsre/contracts';
import { GitHubFixRepository } from './github-fixes.js';

const head = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  blob = 'c'.repeat(40);
function fixture(mode = '100755', content = 'const port = 3001;') {
  const requests: { url: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url).replace('https://api.github.com/repos/owner/service', '');
    requests.push({
      url: path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (init?.method === 'POST')
      return Response.json(path === '/pulls' ? { number: 7 } : { sha: 'd'.repeat(40) });
    if (!path) return Response.json({ default_branch: 'main' });
    if (path === '/git/ref/heads/main') return Response.json({ object: { sha: head } });
    if (path === `/git/commits/${head}`) return Response.json({ sha: head, tree: { sha: tree } });
    if (path.startsWith('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: [{ path: 'src/server.ts', mode, type: 'blob', sha: blob, size: content.length }],
      });
    if (path === `/git/blobs/${blob}`)
      return Response.json({
        sha: blob,
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      });
    return new Response('', { status: 404 });
  });
  const repo = new GitHubFixRepository(
    'owner/service',
    ['src/server.ts'],
    'test-only-token',
    fetcher,
  );
  return { repo, fetcher, requests };
}
describe('GitHub source and PR adapter', () => {
  it('reads allowed regular files from an immutable commit without writes', async () => {
    const { repo, requests } = fixture();
    expect(await repo.readSource(['src/server.ts'])).toMatchObject({
      baseCommit: head,
      baseTree: tree,
      files: [{ mode: '100755', content: 'const port = 3001;' }],
    });
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    await expect(repo.readSource(['another/file.ts'])).rejects.toThrow(/configured/);
  });
  it('rejects symlinks, credentials, and oversized provider responses', async () => {
    await expect(fixture('120000').repo.readSource(['src/server.ts'])).rejects.toThrow(/regular/);
    await expect(
      fixture('100644', 'ghp_examplecredential').repo.readSource(['src/server.ts']),
    ).rejects.toThrow(/credential/);
    const { repo, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(2_000_001)));
    await expect(repo.readSource(['src/server.ts'])).rejects.toThrow(/too large/);
  });
  it('preserves a UTF-8 byte-order mark in the source snapshot', async () => {
    const result = await fixture('100644', '\uFEFFconst port = 3001;').repo.readSource([
      'src/server.ts',
    ]);
    expect(result.files[0]!.content).toBe('\uFEFFconst port = 3001;');
  });
  it('preserves the base tree and parent, creates a new branch, and opens a draft PR', async () => {
    const { repo, requests } = fixture();
    const context = {
      repository: 'owner/service',
      baseBranch: 'main',
      baseCommit: head,
      baseTree: tree,
      bundle: { incident: { id: 'incident' } },
    } as FixContext;
    const draft = {
      id: 'f18e6415-82fb-4939-a6b5-ec1d27a31409',
      proposal: { summary: 'Correct the port', evidenceIds: ['failure'], edits: [] },
      changes: [
        {
          path: 'src/server.ts',
          mode: '100755',
          before: 'const port = 3001;',
          after: 'const port = 3000;',
        },
      ],
    } as unknown as FixDraft;
    expect(await repo.publish(context, draft)).toBe('https://github.com/owner/service/pull/7');
    expect(requests.find((request) => request.url === '/git/trees')!.body).toMatchObject({
      base_tree: tree,
      tree: [{ path: 'src/server.ts', mode: '100755', content: 'const port = 3000;' }],
    });
    expect(requests.find((request) => request.url === '/git/commits')!.body).toMatchObject({
      parents: [head],
    });
    expect(requests.find((request) => request.url === '/git/refs')!.body).toMatchObject({
      ref: `refs/heads/pocketsre/fix-${draft.id}`,
    });
    expect(requests.find((request) => request.url === '/pulls')!.body).toMatchObject({
      base: 'main',
      draft: true,
    });
    expect(requests.some((request) => request.method === 'PATCH')).toBe(false);
  });
});
