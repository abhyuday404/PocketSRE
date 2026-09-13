import { expect, it, vi } from 'vitest';
import { GitHubAccount } from './github-account.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const code = {
  device_code: 'test-device-credential',
  user_code: 'TEST-CODE',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

it('keeps credentials server-side, obeys polling backoff, and expires a connected session', async () => {
  let now = Date.now();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(code))
    .mockResolvedValueOnce(json({ error: 'slow_down' }))
    .mockResolvedValueOnce(json({ access_token: 'test-access-credential', expires_in: 20 }))
    .mockResolvedValueOnce(json({ login: 'reviewer' }));
  const github = new GitHubAccount({ clientId: 'test-client', fetcher, now: () => now });
  const view = await github.start();
  expect(JSON.stringify(view)).not.toContain(code.device_code);
  expect((await github.poll(view.id)).status).toBe('pending');
  expect(fetcher).toHaveBeenCalledTimes(1);
  now += 5000;
  expect(await github.poll(view.id)).toEqual({ status: 'pending', interval: 10 });
  now += 5000;
  await github.poll(view.id);
  expect(fetcher).toHaveBeenCalledTimes(2);
  now += 5000;
  expect((await github.poll(view.id)).status).toBe('connected');
  const status = await github.status();
  expect(status).toMatchObject({ connected: true, account: 'reviewer' });
  expect(JSON.stringify(status)).not.toContain('test-access-credential');
  expect(fetcher.mock.calls[2]![0]).toBe('https://github.com/login/oauth/access_token');
  expect(new URLSearchParams(String(fetcher.mock.calls[2]![1]!.body)).get('device_code')).toBe(
    code.device_code,
  );
  now += 21000;
  expect((await github.status()).connected).toBe(false);
  await expect(github.repositories(1)).rejects.toThrow(/Connect GitHub/);
});

it('does not revive a disconnected session when token exchange is in flight', async () => {
  let now = Date.now();
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(code))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const github = new GitHubAccount({ clientId: 'test-client', fetcher, now: () => now });
  const view = await github.start();
  now += 5000;
  const poll = github.poll(view.id);
  github.disconnect();
  finish(json({ access_token: 'discard-this-test-token' }));
  expect((await poll).status).toBe('expired');
  expect((await github.status()).connected).toBe(false);
});

it('handles denial, expired codes, pagination, and revoked credentials', async () => {
  let now = Date.now();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(code))
    .mockResolvedValueOnce(json({ error: 'access_denied' }));
  const github = new GitHubAccount({ clientId: 'test-client', fetcher, now: () => now });
  const view = await github.start();
  now += 5000;
  expect((await github.poll(view.id)).status).toBe('denied');
  expect((await github.poll(view.id)).status).toBe('expired');
  const repos = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    full_name: `reviewer/repo-${index}`,
    private: true,
    default_branch: 'main',
  }));
  const read = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(repos))
    .mockResolvedValueOnce(json({ message: 'do not echo provider details' }, 401));
  const connected = new GitHubAccount({ token: 'test-fixture', fetcher: read });
  expect((await connected.repositories(2)).nextPage).toBe(3);
  expect(read.mock.calls[0]![0]).toContain('page=2');
  expect((await connected.status()).connected).toBe(false);
});

it('never opens a provider-controlled verification URL', async () => {
  const github = new GitHubAccount({
    clientId: 'test-client',
    fetcher: vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ...code, verification_uri: 'https://example.invalid/steal-code' })),
  });
  await expect(github.start()).rejects.toThrow();
});

it('lists attachable files from the selected branch without secrets, symlinks or oversized files', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      truncated: false,
      tree: [
        { path: 'src/app.ts', type: 'blob', mode: '100644', size: 80 },
        { path: '.env', type: 'blob', mode: '100644', size: 80 },
        { path: '.github/workflows/run.yml', type: 'blob', mode: '100644', size: 80 },
        { path: 'link.ts', type: 'blob', mode: '120000', size: 80 },
        { path: 'big.ts', type: 'blob', mode: '100644', size: 12001 },
        { path: 'src', type: 'tree', mode: '040000' },
        { path: '../escape.ts', type: 'blob', mode: '100644', size: 80 },
      ],
    }),
  );
  const github = new GitHubAccount({ token: 'test-fixture', fetcher });
  expect(await github.files('owner/private', 'feature/agent')).toEqual({
    paths: ['src/app.ts'],
    truncated: false,
  });
  expect(fetcher.mock.calls[0]![0]).toBe(
    'https://api.github.com/repos/owner/private/git/trees/feature%2Fagent?recursive=1',
  );
});
