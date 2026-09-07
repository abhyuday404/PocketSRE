import { describe, expect, it, vi } from 'vitest';
import { GitHubConnector, SentryConnector, createLiveBundleLoader } from './connectors.js';

describe('read-only provider adapters', () => {
  it('normalizes GitHub patches and redacts secrets before returning evidence', async () => {
    const sha = 'a'.repeat(40);
    const commit = {
      sha,
      html_url: `https://github.com/team/repo/commit/${sha}`,
      commit: { message: 'Fix configuration', committer: { date: '2026-09-01T10:00:00Z' } },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([commit]))
      .mockResolvedValueOnce(
        Response.json({
          ...commit,
          files: [{ filename: 'config.ts', patch: '+ password=private-value' }],
        }),
      );
    const events = await new GitHubConnector('team/repo', 'test-only', fetcher).collect(
      '2026-09-01T00:00:00.000Z',
    );
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain('private-value');
    expect(events[1]?.metadata.commitSha).toBe(sha);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('collects Sentry issue summaries without presenting inferred release data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          id: '42',
          title: 'Database failed',
          permalink: 'https://sentry.io/issues/42/',
          firstSeen: '2026-09-01T10:00:00Z',
          lastSeen: '2026-09-01T10:01:00Z',
          count: '3',
        },
      ]),
    );
    const events = await new SentryConnector('org', 'project', 'test-only', fetcher).collect(
      '2026-09-01T00:00:00.000Z',
    );
    expect(events[0]?.type).toBe('exception');
    expect(events[0]?.metadata.release).toBeUndefined();
  });
  it('keeps useful evidence when one provider fails and keeps the incident ID stable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        serviceId: 'api',
        serviceName: 'API',
        status: 'down',
        version: 'v1',
        checkedAt: new Date().toISOString(),
        checks: { api: 'failed' },
      }),
    );
    const loader = createLiveBundleLoader({
      healthUrl: 'https://example.com/health',
      fetcher,
      connectors: [
        {
          name: 'unavailable',
          collect: async () => {
            throw new Error('private provider payload');
          },
        },
      ],
    });
    const first = await loader();
    const second = await loader();
    expect(first.incident.id).toBe(second.incident.id);
    expect(first.evidence).toHaveLength(1);
    expect(first.collection?.[0]?.status).toBe('unavailable');
    expect(JSON.stringify(first)).not.toContain('private provider payload');
  });
});
