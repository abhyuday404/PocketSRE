import { expect, it, vi } from 'vitest';
import { TrackedProjectSchema } from '@pocketsre/contracts';
import { VercelProvider } from './providers.js';
const project = TrackedProjectSchema.parse({
  id: '984a8c1f-82cd-4d35-82d0-98c9a08fd7d5',
  repository: { id: 1, fullName: 'owner/repo', private: true, defaultBranch: 'main' },
  healthUrl: null,
  createdAt: new Date().toISOString(),
  deployment: { provider: 'vercel', projectId: 'prj_test', name: 'test', target: 'production' },
});
it('suggests repository matches and collects bounded, redacted build and runtime evidence with GET only', async () => {
  const now = Date.now();
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.vercel.com');
    expect(url.searchParams.get('teamId')).toBe('team_test');
    if (url.pathname === '/v10/projects')
      return Response.json({
        projects: [
          { id: 'prj_test', name: 'test', link: { type: 'github', org: 'owner', repo: 'repo' } },
        ],
        pagination: { next: 123 },
      });
    if (url.pathname === '/v7/deployments') {
      expect(url.searchParams.get('projectId')).toBe('prj_test');
      expect(url.searchParams.get('target')).toBe('production');
      return Response.json({ deployments: [{ uid: 'dpl_test', state: 'READY', created: now }] });
    }
    if (url.pathname.endsWith('/runtime-logs'))
      return new Response(
        `${JSON.stringify({ timestampInMs: now, message: 'password=supersecret', level: 'error' })}\n${JSON.stringify({ timestampInMs: now + 1, message: 'runtime failure' })}\n`,
      );
    return Response.json([
      { created: now, payload: { text: 'Authorization: Bearer test-provider-credential' } },
    ]);
  });
  const provider = new VercelProvider('fixture-token', 'team_test', fetcher);
  expect((await provider.projects('owner/repo')).projects[0]?.suggested).toBe(true);
  const build = await provider.evidence(project, 'build');
  const runtime = await provider.evidence(project, 'runtime');
  expect(build).toHaveLength(1);
  expect(runtime).toHaveLength(2);
  expect(JSON.stringify([...build, ...runtime])).not.toMatch(
    /supersecret|test-provider-credential/,
  );
  expect(runtime[0]!.metadata.logKind).toBe('runtime');
  for (const [, init] of fetcher.mock.calls) {
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
  }
});
it('keeps a failed replacement connection from overwriting existing access and rejects foreign project IDs', async () => {
  const provider = new VercelProvider(
    'old-fixture',
    'team_old',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('raw private provider details', { status: 403 })),
  );
  await expect(provider.connect('new-fixture', 'team_new')).rejects.toThrow(/denied/);
  expect(provider.status()).toMatchObject({ connected: true, teamId: 'team_old' });
  await expect(provider.project('../foreign')).rejects.toThrow();
  provider.disconnect();
  expect(provider.status().connected).toBe(false);
});

it('does not restore credentials when a pending connection finishes after disconnect', async () => {
  let finish!: (response: Response) => void;
  const provider = new VercelProvider(
    '',
    '',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const connection = provider.connect('fixture-token', 'team_fixture');
  provider.disconnect();
  finish(Response.json({ projects: [] }));
  await expect(connection).rejects.toThrow(/changed/);
  expect(provider.status().connected).toBe(false);
});
