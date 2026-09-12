import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TrackedProjectSchema, type IncidentBundle } from '@pocketsre/contracts';
import {
  ProjectMonitor,
  PushDeliveryError,
  ExpoPushTransport,
  type PushTransport,
} from './project-monitor.js';
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-monitor-'));
  directories.push(directory);
  const path = join(directory, 'ledger.json');
  let now = Date.now();
  let status: 'healthy' | 'down' | 'unknown' = 'down';
  const project = TrackedProjectSchema.parse({
    id: '984a8c1f-82cd-4d35-82d0-98c9a08fd7d5',
    repository: { id: 1, fullName: 'owner/repo', private: true, defaultBranch: 'main' },
    healthUrl: 'https://example.test/health',
    createdAt: new Date(now).toISOString(),
    monitoring: true,
  });
  const push = {
    send: vi.fn<PushTransport['send']>().mockResolvedValue('receipt_test'),
    receipt: vi.fn<PushTransport['receipt']>().mockResolvedValue('sent'),
  };
  const options = {
    path,
    list: async () => [project],
    probe: async (): Promise<IncidentBundle> => ({
      schemaVersion: 1,
      generatedAt: new Date(now).toISOString(),
      incident: {
        id: 'incident_test',
        serviceId: 'service_test',
        title: 'Test incident',
        severity: 'critical',
        status: status === 'healthy' ? 'resolved' : 'open',
        startedAt: new Date(now).toISOString(),
        lastUpdatedAt: new Date(now).toISOString(),
      },
      serviceHealth: {
        serviceId: 'service_test',
        serviceName: 'Test',
        status,
        version: null,
        checkedAt: new Date(now).toISOString(),
        checks: {},
      },
      evidence: [],
    }),
    push,
    now: () => now,
  };
  const monitor = new ProjectMonitor(options);
  await monitor.subscribe(
    '90f85cd5-818c-4286-9714-9a890636765c',
    project.id,
    'ExpoPushToken[test_fixture]',
  );
  return {
    monitor,
    options,
    project,
    push,
    path,
    setStatus: (value: typeof status) => {
      status = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it('persists debouncing and delivery across restart, deduplicates sustained outages, and sends recovery', async () => {
  const f = await fixture();
  await f.monitor.tick();
  expect(f.push.send).not.toHaveBeenCalled();
  const restarted = new ProjectMonitor(f.options);
  await restarted.tick();
  expect(f.push.send).toHaveBeenCalledTimes(1);
  await restarted.tick();
  expect(f.push.send).toHaveBeenCalledTimes(1);
  f.setStatus('healthy');
  await restarted.tick();
  f.setStatus('unknown');
  await restarted.tick();
  expect((await restarted.status(f.project.id, true)).alertOpen).toBe(true);
  f.setStatus('healthy');
  await restarted.tick();
  await restarted.tick();
  expect(f.push.send).toHaveBeenCalledTimes(2);
  expect(f.push.send.mock.calls[1]![1].event).toBe('recovered');
  f.advance(15 * 60000);
  await restarted.tick();
  expect(f.push.receipt).toHaveBeenCalledTimes(2);
  const saved = JSON.parse(await readFile(f.path, 'utf8'));
  expect(saved.jobs.every((job: { status: string }) => job.status === 'sent')).toBe(true);
});
it('retries transient delivery and stops sending when monitoring is paused', async () => {
  const f = await fixture();
  f.push.send.mockRejectedValueOnce(new PushDeliveryError(false));
  await f.monitor.tick();
  await f.monitor.tick();
  expect(f.push.send).toHaveBeenCalledTimes(1);
  f.advance(60001);
  await f.monitor.tick();
  expect(f.push.send).toHaveBeenCalledTimes(2);
  f.project.monitoring = false;
  f.advance(15 * 60000);
  await f.monitor.tick();
  expect(f.push.receipt).not.toHaveBeenCalled();
});
it('removes dead-device subscriptions and resets pending alerts when the endpoint changes', async () => {
  const f = await fixture();
  f.push.send.mockRejectedValueOnce(new PushDeliveryError(true, true));
  await f.monitor.tick();
  await f.monitor.tick();
  expect(JSON.parse(await readFile(f.path, 'utf8')).subscriptions).toHaveLength(0);
  f.project.healthUrl = 'https://example.test/new-health';
  f.setStatus('healthy');
  await f.monitor.tick();
  expect((await f.monitor.status(f.project.id, true)).alertOpen).toBe(false);
});
it('distinguishes push service acceptance from receipts and uses fixed endpoints', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { status: 'ok', id: 'receipt' } }))
    .mockResolvedValueOnce(Response.json({ data: {} }))
    .mockResolvedValueOnce(
      Response.json({
        data: { receipt: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
      }),
    );
  const expo = new ExpoPushTransport(undefined, fetcher);
  const f = await fixture();
  await f.monitor.tick();
  await f.monitor.tick();
  expect(
    await expo.send('ExpoPushToken[test_fixture]', f.push.send.mock.calls[0]![1], 'gateway'),
  ).toBe('receipt');
  expect(await expo.receipt('receipt')).toBe('pending');
  await expect(expo.receipt('receipt')).rejects.toMatchObject({
    permanent: true,
    removeDevice: true,
  });
  expect(fetcher.mock.calls[0]![0]).toBe('https://exp.host/--/api/v2/push/send');
});

it('cancels a queued retry when the health endpoint changes and debounces the new target', async () => {
  const f = await fixture();
  f.push.send.mockRejectedValueOnce(new PushDeliveryError(false));
  await f.monitor.tick();
  await f.monitor.tick();
  f.project.healthUrl = 'https://example.test/new-target';
  f.advance(60001);
  await f.monitor.tick();
  expect(f.push.send).toHaveBeenCalledTimes(1);
  expect((await f.monitor.status(f.project.id, true)).alertOpen).toBe(false);
  await f.monitor.tick();
  expect(f.push.send).toHaveBeenCalledTimes(2);
});
