import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentBundleSchema, type EvidenceEvent } from '@pocketsre/contracts';
import {
  GitHubConnector,
  SentryConnector,
  createLiveBundleLoader,
  type LiveBundleOptions,
} from './connectors.js';

const BASE_TIME = Date.parse('2026-09-12T10:00:00.000Z');
const health = (status = 'degraded', checkedAt = new Date(BASE_TIME).toISOString()) => ({
  serviceId: 'api',
  serviceName: 'API',
  status,
  version: 'v1',
  checkedAt,
  checks: { api: status === 'healthy' ? 'healthy' : 'degraded' },
});
const providerEvent: EvidenceEvent = {
  id: 'github:commit',
  source: 'github',
  type: 'commit',
  timestamp: new Date(BASE_TIME).toISOString(),
  title: 'Recent change',
  excerpt: 'password=private-value',
  metadata: { commitSha: 'a'.repeat(40) },
};
function loader(options: Partial<LiveBundleOptions> = {}) {
  return createLiveBundleLoader({
    healthUrl: 'https://example.com/health',
    serviceId: 'api',
    serviceName: 'API',
    connectors: [{ name: 'GitHub', collect: async () => [providerEvent] }],
    fetcher: vi.fn<typeof fetch>().mockImplementation(async () => Response.json(health())),
    now: () => BASE_TIME,
    ...options,
  });
}
const directories: string[] = [];
async function incidentPath() {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-collection-'));
  directories.push(directory);
  return join(directory, 'incidents.json');
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

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
      serviceId: 'api',
      serviceName: 'API',
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
    expect(first.evidence).toHaveLength(2);
    expect(second.evidence).toHaveLength(4);
    expect(first.collection?.find((item) => item.source === 'unavailable')?.status).toBe(
      'unavailable',
    );
    expect(JSON.stringify(first)).not.toContain('private provider payload');
  });
});

describe('live health collection', () => {
  it.each([500, 503])(
    'retains provider evidence and records HTTP %i as an endpoint failure',
    async (status) => {
      const bundle = await loader({
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('private server response', { status })),
      })();
      expect(bundle.serviceHealth).toMatchObject({ status: 'down', version: null, checks: {} });
      expect(bundle.incident.status).toBe('open');
      expect(bundle.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: providerEvent.id }),
          expect.objectContaining({
            type: 'health_check_failed',
            metadata: { reason: 'invalid_response', httpStatus: String(status) },
          }),
        ]),
      );
      expect(bundle.collection?.find((item) => item.source === 'Health')).toMatchObject({
        status: 'unavailable',
        checkedAt: new Date(BASE_TIME).toISOString(),
      });
      expect(JSON.stringify(bundle)).not.toMatch(/private server response|private-value/);
      expect(IncidentBundleSchema.safeParse(bundle).success).toBe(true);
    },
  );

  it.each([
    [
      'network error',
      () => {
        throw new TypeError('private network diagnostics');
      },
      'network_error',
    ],
    ['malformed JSON', () => new Response('private invalid body'), 'invalid_response'],
    [
      'invalid schema',
      () => Response.json({ password: 'private schema body' }),
      'invalid_response',
    ],
    [
      'stale data',
      () => Response.json(health('healthy', new Date(BASE_TIME - 60_001).toISOString())),
      'stale_response',
    ],
    [
      'future data',
      () => Response.json(health('healthy', new Date(BASE_TIME + 5_001).toISOString())),
      'future_response',
    ],
    [
      'other service',
      () => Response.json({ ...health(), serviceId: 'other-service' }),
      'service_mismatch',
    ],
    ['unauthorized', () => new Response('private auth response', { status: 401 }), 'http_error'],
    ['oversized body', () => new Response('x'.repeat(2_000_001)), 'invalid_response'],
  ] as const)(
    'records %s as unknown, with no inferred release or failed component',
    async (_name, response, reason) => {
      const bundle = await loader({
        fetcher: vi.fn<typeof fetch>().mockImplementation(async () => response()),
      })();
      expect(bundle.serviceHealth).toEqual({
        serviceId: 'api',
        serviceName: 'API',
        status: 'unknown',
        version: null,
        checkedAt: new Date(BASE_TIME).toISOString(),
        checks: {},
      });
      expect(bundle.incident).toMatchObject({ status: 'open', severity: 'warning' });
      const observation = bundle.evidence.find((event) => event.source === 'health');
      expect(observation).toMatchObject({ type: 'health_check_unavailable', metadata: { reason } });
      expect(observation?.metadata.release).toBeUndefined();
      expect(bundle.evidence.some((event) => event.id === providerEvent.id)).toBe(true);
      expect(JSON.stringify(bundle)).not.toContain('private');
    },
  );

  it('starts providers while health is waiting and records a bounded timeout', async () => {
    const collect = vi.fn(async () => [providerEvent]);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => {
              expect(collect).toHaveBeenCalledOnce();
              reject(init!.signal!.reason);
            },
            { once: true },
          );
        }),
    );
    const bundle = await loader({
      fetcher,
      healthTimeoutMs: 10,
      connectors: [{ name: 'GitHub', collect }],
    })();
    expect(bundle.serviceHealth.status).toBe('unknown');
    expect(bundle.evidence.find((event) => event.source === 'health')?.metadata.reason).toBe(
      'timeout',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it.each(['healthy', 'degraded', 'down'])(
    'accepts a fresh normalized %s response',
    async (status) => {
      const bundle = await loader({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(health(status))),
      })();
      expect(bundle.serviceHealth.status).toBe(status);
      expect(bundle.serviceHealth.version).toBe('v1');
      expect(bundle.collection?.[0]?.status).toBe('ok');
      expect(bundle.incident.status).toBe(status === 'healthy' ? 'resolved' : 'open');
    },
  );

  it('accepts normalized unhealthy details on 503 but never lets a contradictory healthy body resolve an incident', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(health('down'), { status: 503 }))
      .mockResolvedValueOnce(Response.json(health('healthy'), { status: 503 }));
    const load = loader({ fetcher });
    const first = await load();
    expect(first.serviceHealth.version).toBe('v1');
    expect(first.collection?.[0]?.status).toBe('ok');
    const second = await load();
    expect(second.serviceHealth).toMatchObject({ status: 'down', version: null, checks: {} });
    expect(second.incident).toMatchObject({ id: first.incident.id, status: 'open' });
  });

  it('retains the confirmed HTTP failure if the response body times out', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('private body', 'TimeoutError'));
      },
    });
    const bundle = await loader({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 503 })),
    })();
    expect(bundle.serviceHealth).toMatchObject({ status: 'down', version: null });
    expect(bundle.evidence.find((event) => event.source === 'health')?.metadata).toEqual({
      reason: 'timeout',
      httpStatus: '503',
    });
  });

  it('does not resolve from a health observation that expired while another provider was collecting', async () => {
    let time = BASE_TIME;
    const bundle = await loader({
      now: () => time,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(health('healthy'))),
      connectors: [
        {
          name: 'GitHub',
          collect: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            time += 60_001;
            return [providerEvent];
          },
        },
      ],
    })();
    expect(bundle.serviceHealth).toMatchObject({ status: 'unknown', version: null });
    expect(bundle.incident.status).toBe('open');
    expect(bundle.evidence.find((event) => event.source === 'health')?.metadata.reason).toBe(
      'stale_response',
    );
  });

  it('requires an explicit cold-start identity and rejects unsafe health URLs', () => {
    expect(() => loader({ serviceId: '' })).toThrow('HEALTH_SERVICE_ID');
    for (const healthUrl of [
      'file:///health',
      'https://user:pass@example.com/health',
      'https://example.com/health?token=x',
      'https://example.com/health#secret',
    ])
      expect(() => loader({ healthUrl })).toThrow('HEALTH_URL');
  });
});

describe('durable live incident continuity', () => {
  it('preserves an outage through unknown health, process restarts and recovery, then starts a later incident', async () => {
    const path = await incidentPath();
    let time = BASE_TIME;
    let status = 'healthy';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (status === 'unknown') throw new Error('private outage diagnostics');
      return Response.json(health(status, new Date(time).toISOString()));
    });
    const options = { incidentPath: path, now: () => time, fetcher };
    let load = loader(options);
    const baseline = await load();
    time += 1_000;
    status = 'down';
    const outage = await load();
    expect(outage.incident.id).not.toBe(baseline.incident.id);
    time += 1_000;
    status = 'unknown';
    load = loader({
      ...options,
      connectors: [
        {
          name: 'GitHub',
          collect: async () => {
            throw new Error('private credentials');
          },
        },
      ],
    });
    const unknown = await load();
    expect(unknown.incident).toMatchObject({
      id: outage.incident.id,
      startedAt: outage.incident.startedAt,
      severity: 'critical',
      status: 'open',
    });
    expect(unknown.serviceHealth).toMatchObject({ status: 'unknown', version: null });
    expect(unknown.evidence.map((event) => event.id)).toEqual(
      expect.arrayContaining(outage.evidence.map((event) => event.id)),
    );
    expect(unknown.evidence.filter((event) => event.id === providerEvent.id)).toHaveLength(1);
    time += 1_000;
    status = 'healthy';
    load = loader(options);
    const recovered = await load();
    expect(recovered.incident).toMatchObject({
      id: outage.incident.id,
      startedAt: outage.incident.startedAt,
      status: 'resolved',
    });
    expect(recovered.evidence.map((event) => event.id)).toEqual(
      expect.arrayContaining(unknown.evidence.map((event) => event.id)),
    );
    const restartedHealthy = await loader(options)();
    expect(restartedHealthy.incident.id).toBe(outage.incident.id);
    time += 1_000;
    status = 'down';
    const later = await loader(options)();
    expect(later.incident.id).not.toBe(outage.incident.id);
    expect(later.incident.startedAt).toBe(new Date(time).toISOString());
    const saved = await readFile(path, 'utf8');
    expect(saved).not.toContain('private');
    expect(JSON.parse(saved).history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          incident: expect.objectContaining({ id: outage.incident.id, status: 'resolved' }),
        }),
      ]),
    );
  });

  it('persists unknown cold starts and serializes overlapping refreshes without losing samples', async () => {
    const path = await incidentPath();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const load = loader({ incidentPath: path, fetcher });
    const [first, second, third] = await Promise.all([load(), load(), load()]);
    expect(new Set([first, second, third].map((bundle) => bundle.incident.id)).size).toBe(1);
    expect(third.evidence.filter((event) => event.source === 'health')).toHaveLength(3);
    const restarted = await loader({ incidentPath: path, fetcher })();
    expect(restarted.incident.id).toBe(first.incident.id);
    expect(restarted.evidence.filter((event) => event.source === 'health')).toHaveLength(4);
  });

  it('quarantines corrupt storage and exposes the lost continuity without echoing its contents', async () => {
    const path = await incidentPath();
    await writeFile(path, '{"password":"private-corrupt-data"');
    const load = loader({ incidentPath: path });
    await load.initialize();
    const bundle = await load();
    expect(bundle.collection).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'Incident storage', status: 'unavailable' }),
      ]),
    );
    expect(bundle.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'collection_failed',
          metadata: { reason: 'storage_corrupt' },
        }),
      ]),
    );
    expect(JSON.stringify(bundle)).not.toContain('private-corrupt-data');
    expect(
      (await readdir(join(path, '..'))).filter((file) => file.includes('.corrupt-')),
    ).toHaveLength(1);
    expect(
      (await load()).evidence.filter((event) => event.metadata.reason === 'storage_corrupt'),
    ).toHaveLength(1);
    expect(
      IncidentBundleSchema.safeParse(JSON.parse(await readFile(path, 'utf8')).current).success,
    ).toBe(true);
  });
});
