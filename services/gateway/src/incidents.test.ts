import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { IncidentBundle, EvidenceEvent } from '@pocketsre/contracts';
import { IncidentStore } from './incidents.js';

const BASE_TIME = Date.parse('2026-09-12T10:00:00.000Z');
const iso = (offset = 0) => new Date(BASE_TIME + offset).toISOString();
function event(id: string, offset = 0): EvidenceEvent {
  return {
    id,
    timestamp: iso(offset),
    source: 'health',
    type: 'health_check_failed',
    title: 'Endpoint failed',
    excerpt: '',
    metadata: {},
  };
}
function bundle(id = 'incident', offset = 0, evidence = [event('health', offset)]): IncidentBundle {
  return {
    schemaVersion: 1,
    generatedAt: iso(offset),
    incident: {
      id,
      serviceId: 'api',
      title: 'API incident',
      severity: 'critical',
      status: 'open',
      startedAt: iso(),
      lastUpdatedAt: iso(offset),
    },
    serviceHealth: {
      serviceId: 'api',
      serviceName: 'API',
      status: 'down',
      version: 'v1',
      checkedAt: iso(offset),
      checks: {},
    },
    evidence,
  };
}
const directories: string[] = [];
async function location() {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-incidents-'));
  directories.push(directory);
  return { directory, path: join(directory, 'incidents.json') };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('loads legacy v1 bundles and returns isolated snapshots', async () => {
  const { path } = await location();
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, serviceId: 'api', current: bundle(), history: [] }),
  );
  const store = new IncidentStore('api', path);
  await store.load();
  expect(store.current).toMatchObject(bundle());
  store.current!.incident.id = 'caller mutation';
  expect(store.current!.incident.id).toBe('incident');
});

it('deduplicates evidence, sanitizes it on disk and bounds retention by age and count', async () => {
  const { path } = await location();
  const store = new IncidentStore('api', path, { maxEvidence: 3, evidenceAgeMs: 10_000 });
  await store.save(
    bundle('incident', 0, [
      event('expired', -10_001),
      event('oldest', -5_000),
      event('stable', -2_000),
      event('recent', -1_000),
    ]),
  );
  const updated = {
    ...event('stable', 1_000),
    excerpt: 'password=private-test-value',
    metadata: { authorization: 'private-header' },
  };
  const saved = await store.save(bundle('incident', 1_000, [updated, event('new', 1_000)]));
  expect(saved.evidence.map((item) => item.id)).toEqual(['recent', 'new', 'stable']);
  expect(saved.evidence.find((item) => item.id === 'stable')?.excerpt).toContain('[REDACTED]');
  expect(await readFile(path, 'utf8')).not.toContain('private');
  expect((await readdir(join(path, '..'))).some((item) => item.endsWith('.tmp'))).toBe(false);
  const restarted = new IncidentStore('api', path, { maxEvidence: 3, evidenceAgeMs: 10_000 });
  await restarted.load();
  expect(restarted.current).toEqual(saved);
  const later = await restarted.save(bundle('incident', 20_000, [event('latest', 20_000)]));
  expect(later.evidence.map((item) => item.id)).toEqual(['latest']);
  expect(later.incident.startedAt).toBe(iso());
});

it('bounds completed history while keeping the current incident regardless of outage duration', async () => {
  const { path } = await location();
  const retention = { maxHistory: 2, historyAgeMs: 5_000 };
  let store = new IncidentStore('api', path, retention);
  for (let index = 0; index < 5; index++) {
    const snapshot = bundle(`incident-${index}`, index * 1_000);
    snapshot.incident.status = 'resolved';
    await store.save(snapshot);
  }
  expect(
    JSON.parse(await readFile(path, 'utf8')).history.map(
      (item: IncidentBundle) => item.incident.id,
    ),
  ).toEqual(['incident-2', 'incident-3']);
  store = new IncidentStore('api', path, retention);
  await store.load();
  const current = await store.save(
    bundle('incident-4', 40 * 86_400_000, [event('latest', 40 * 86_400_000)]),
  );
  expect(current.incident.id).toBe('incident-4');
  expect(current.incident.startedAt).toBe(iso());
  expect(JSON.parse(await readFile(path, 'utf8')).history).toEqual([]);
});

it('fails closed on another service or a future storage format without overwriting the file', async () => {
  const { path } = await location();
  await new IncidentStore('api', path).save(bundle());
  const before = await readFile(path, 'utf8');
  await expect(new IncidentStore('other', path).load()).rejects.toThrow('another service');
  expect(await readFile(path, 'utf8')).toBe(before);
  const future = JSON.stringify({ schemaVersion: 2, serviceId: 'api' });
  await writeFile(path, future);
  await expect(new IncidentStore('api', path).load()).rejects.toThrow('Unsupported');
  expect(await readFile(path, 'utf8')).toBe(future);
});

it('quarantines schema-invalid storage but propagates filesystem errors', async () => {
  const { directory, path } = await location();
  await writeFile(path, JSON.stringify({ schemaVersion: 1, current: { invalid: true } }));
  const store = new IncidentStore('api', path);
  await store.load();
  expect(store.current).toBeNull();
  expect(store.recoveredCorruptStorage).toBe(true);
  await expect(new IncidentStore('api', directory).load()).rejects.toThrow();
});

it('does not advance in-memory state when the atomic replacement fails', async () => {
  const { directory, path } = await location();
  const store = new IncidentStore('api', path);
  const original = await store.save(bundle());
  await rename(path, join(directory, 'saved.json'));
  await mkdir(path);
  await expect(store.save(bundle('other-incident', 1_000))).rejects.toThrow();
  expect(store.current).toEqual(original);
  expect((await readdir(directory)).some((item) => item.endsWith('.tmp'))).toBe(false);
  await rm(path, { recursive: true });
  const retried = await store.save(bundle('other-incident', 1_000));
  expect(retried.incident.id).toBe('other-incident');
});
