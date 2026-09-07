import { beforeEach, expect, it, vi } from 'vitest';
const files = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-file-system', () => ({
  Paths: { document: '/private' },
  File: class {
    path: string;
    constructor(...parts: string[]) {
      this.path = parts.join('/');
    }
    get exists() {
      return files.has(this.path);
    }
    async text() {
      return files.get(this.path) ?? '';
    }
    create() {
      files.set(this.path, '');
    }
    write(value: string) {
      files.set(this.path, value);
    }
    delete() {
      files.delete(this.path);
    }
  },
}));
import { cacheIncident, readIncidentHistory, clearIncidentCache } from './incidents';
import { createSampleIncident } from '../data/sampleIncident';
beforeEach(() => files.clear());
it('persists sanitized evidence, deduplicates incidents and isolates gateway history', async () => {
  const incident = createSampleIncident();
  incident.evidence[0]!.metadata.token = 'private-token';
  await cacheIncident('gateway-a', incident);
  await cacheIncident('gateway-a', incident);
  expect(await readIncidentHistory('gateway-a')).toHaveLength(1);
  expect(await readIncidentHistory('gateway-b')).toHaveLength(0);
  expect([...files.values()].join('')).not.toContain('private-token');
  clearIncidentCache();
  expect(await readIncidentHistory('gateway-a')).toHaveLength(0);
});
it('treats corrupt persisted state as an empty cache', async () => {
  files.set('/private/pocketsre-incidents.json', '{broken');
  expect(await readIncidentHistory('gateway-a')).toEqual([]);
});
