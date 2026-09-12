import { beforeEach, expect, it, vi } from 'vitest';
import { disk, resetDisk } from './testStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import {
  cacheIncident,
  cacheOfflineIncident,
  cacheDiagnosis,
  readIncidentHistory,
  clearIncidentCache,
  snapshotId,
  HISTORY_LIMITS,
} from './incidents';
import { createSampleIncident } from '../data/sampleIncident';
import { createDeterministicDiagnosis, mergeInvestigation } from '@pocketsre/incident-engine';
import type { IncidentBundle } from '@pocketsre/contracts';

const A = 'https://gateway-a.example';
const B = 'https://gateway-b.example';
const primary = '/private/pocketsre-incidents.json';
const backup = '/private/pocketsre-incidents.backup.json';
beforeEach(resetDisk);

async function rewriteLatest(change: (records: Array<Record<string, any>>) => void) {
  const [path, envelope] = [...disk.files]
    .map(([path, text]) => [path, JSON.parse(text)] as const)
    .sort((a, b) => b[1].revision - a[1].revision)[0]!;
  const records = JSON.parse(envelope.payload);
  change(records);
  envelope.payload = JSON.stringify(records);
  envelope.checksum = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `${envelope.revision}:${envelope.payload}`,
  );
  disk.files.set(path, JSON.stringify(envelope));
}

it('preserves every gateway across alternating and overlapping saves', async () => {
  const bundle = createSampleIncident();
  const first = await cacheIncident(A + '/', bundle);
  expect(await snapshotId('gateway', A + '/', bundle)).toBe(first.id);
  await Promise.all([cacheIncident(B, bundle), cacheIncident(A, bundle)]);
  expect((await readIncidentHistory(A)).records.map((record) => record.id)).toEqual([first.id]);
  const second = (await readIncidentHistory(B)).records;
  expect(second).toHaveLength(1);
  expect(second[0]!.id).not.toBe(first.id);
  expect((await readIncidentHistory(A)).total).toBe(2);
});

it('keeps exact snapshot/diagnosis associations across refreshes and a module restart', async () => {
  const firstBundle = createSampleIncident();
  const first = await cacheIncident(A, firstBundle);
  const diagnosis = createDeterministicDiagnosis(firstBundle);
  await cacheDiagnosis(first, diagnosis);
  const changed = structuredClone(firstBundle);
  // IDs and release are unchanged, but the content is different.
  changed.evidence[0]!.excerpt += ' Additional observation.';
  const second = await cacheIncident(A, changed);
  expect(second.id).not.toBe(first.id);
  expect(second.diagnosis).toBeNull();
  expect((await cacheIncident(B, firstBundle)).diagnosis).toBeNull();
  vi.resetModules();
  const restarted = await import('./incidents');
  const history = await restarted.readIncidentHistory(A);
  expect(history.records).toHaveLength(2);
  expect(history.records.find((record) => record.id === first.id)?.diagnosis?.value).toEqual(
    diagnosis,
  );
  expect(history.records.find((record) => record.id === second.id)?.diagnosis).toBeNull();
  expect((await restarted.cacheIncident(A, firstBundle)).diagnosis?.value).toEqual(diagnosis);
});

it('includes health, release, collection, incident and timestamp changes in snapshot identity', async () => {
  const bundle = createSampleIncident();
  const original = await snapshotId('gateway', A, bundle);
  const changes: Array<(value: IncidentBundle) => void> = [
    (value) => {
      value.generatedAt = '2027-01-01T00:00:00.000Z';
    },
    (value) => {
      value.serviceHealth.checkedAt = '2027-01-01T00:00:00.000Z';
    },
    (value) => {
      value.serviceHealth.version = 'another-release';
    },
    (value) => {
      value.serviceHealth.checks.database = 'healthy';
    },
    (value) => {
      value.collection = [{ source: 'github', status: 'unavailable', message: 'Offline' }];
    },
    (value) => {
      value.incident.status = 'resolved';
    },
  ];
  for (const change of changes) {
    const next = structuredClone(bundle);
    change(next);
    expect(await snapshotId('gateway', A, next)).not.toBe(original);
  }
  const reordered = structuredClone(bundle);
  reordered.evidence[1]!.metadata = Object.fromEntries(
    Object.entries(reordered.evidence[1]!.metadata).reverse(),
  );
  expect(await snapshotId('gateway', A, reordered)).toBe(original);
});

it('sanitizes evidence, collection failures and every diagnosis prose field before persistence', async () => {
  const bundle = createSampleIncident();
  bundle.evidence[0]!.metadata.token = 'private-token-value';
  bundle.collection = [
    { source: 'github', status: 'unavailable', message: 'Authorization: Bearer collector-secret' },
  ];
  const snapshot = await cacheIncident(A, bundle);
  const diagnosis = createDeterministicDiagnosis(snapshot.bundle);
  diagnosis.summary += ' password=summary-secret';
  diagnosis.likelyCause += ' secret=cause-secret';
  diagnosis.nextDiagnosticStep += ' api_key=next-secret';
  diagnosis.alternativeCauses[0]!.statement += ' Bearer alternate-secret';
  diagnosis.proposedAction!.reason += ' token=reason-secret';
  diagnosis.proposedAction!.risk += ' secret=risk-secret';
  await cacheDiagnosis(snapshot, diagnosis);
  const persisted = [...disk.files.values()].join('');
  for (const secret of [
    'private-token-value',
    'collector-secret',
    'summary-secret',
    'cause-secret',
    'next-secret',
    'alternate-secret',
    'reason-secret',
    'risk-secret',
  ])
    expect(persisted).not.toContain(secret);
  expect((await readIncidentHistory(A)).records[0]!.diagnosis?.value.evidenceIds).toEqual(
    diagnosis.evidenceIds,
  );
});

it('rejects invalid analyses without replacing a previously valid analysis', async () => {
  const bundle = createSampleIncident();
  const snapshot = await cacheIncident(A, bundle);
  const valid = createDeterministicDiagnosis(bundle);
  await cacheDiagnosis(snapshot, valid);
  const variants: Array<unknown> = [
    null,
    { summary: 'Incomplete' },
    { ...valid, evidenceIds: ['invented'] },
    { ...valid, alternativeCauses: [{ statement: 'Guess', confidence: 'low', evidenceIds: [] }] },
    { ...valid, proposedAction: { ...valid.proposedAction, target: 'another-service' } },
    { ...valid, proposedAction: { ...valid.proposedAction, evidenceIds: ['invented'] } },
    {
      ...valid,
      proposedAction: { ...valid.proposedAction, parameters: { targetRelease: 'unverified' } },
    },
  ];
  for (const candidate of variants)
    await expect(cacheDiagnosis(snapshot, candidate)).rejects.toThrow('Analysis rejected');
  expect((await readIncidentHistory(A)).records[0]!.diagnosis?.value).toEqual(valid);
});

it('preserves opaque evidence identifiers during diagnosis sanitization', async () => {
  const bundle = createSampleIncident();
  bundle.evidence[0]!.id = 'evidence:someone@example.com';
  const snapshot = await cacheIncident(A, bundle);
  const diagnosis = createDeterministicDiagnosis(bundle);
  const saved = await cacheDiagnosis(snapshot, diagnosis);
  expect(saved.diagnosis!.value.evidenceIds).toEqual(diagnosis.evidenceIds);
  expect((await readIncidentHistory(A)).records[0]!.diagnosis).not.toBeNull();
});

it('discards mismatched and invalid persisted diagnoses while recovering valid evidence', async () => {
  const bundle = createSampleIncident();
  const first = await cacheIncident(A, bundle);
  const saved = await cacheDiagnosis(first, createDeterministicDiagnosis(bundle));
  const changed = structuredClone(bundle);
  changed.evidence[0]!.excerpt += ' Changed.';
  const second = await cacheIncident(A, changed);
  await rewriteLatest((records) => {
    records.find((record) => record.id === second.id)!.diagnosis = saved.diagnosis;
  });
  let history = await readIncidentHistory(A);
  expect(history.records[0]!.diagnosis).toBeNull();
  expect(history.notice).toContain('invalid analyses');
  await rewriteLatest((records) => {
    records[0]!.diagnosis = {
      ...saved.diagnosis,
      snapshotId: second.id,
      value: { ...saved.diagnosis!.value, evidenceIds: ['missing'] },
    };
    records.push(null as any, { bundle: {} });
  });
  history = await readIncidentHistory(A);
  expect(history.records).toHaveLength(2);
  expect(history.records[0]!.diagnosis).toBeNull();
});

it('migrates all valid legacy gateways without inventing capture times or keeping secrets', async () => {
  const bundle = createSampleIncident();
  bundle.evidence[0]!.metadata.authorization = 'legacy-secret';
  disk.files.set(
    primary,
    JSON.stringify([
      { gateway: A, bundle },
      null,
      false,
      { gateway: B, bundle },
      { gateway: A, bundle: {} },
      { gateway: 'https://user:secret@example.com', bundle },
    ]),
  );
  const migrated = await readIncidentHistory(A);
  expect(migrated.records).toHaveLength(1);
  expect(migrated.records[0]!.capturedAt).toBeNull();
  expect(migrated.records[0]!.diagnosis).toBeNull();
  expect((await readIncidentHistory(B)).records).toHaveLength(1);
  expect([...disk.files.values()].join('')).not.toContain('legacy-secret');
  expect([...disk.files.values()].every((text) => JSON.parse(text).version === 2)).toBe(true);
  const changed = structuredClone(bundle);
  changed.incident.id = 'second-incident';
  await cacheIncident(B, changed);
  expect((await readIncidentHistory(A)).records).toHaveLength(1);
  expect((await readIncidentHistory(B)).records).toHaveLength(2);
});

it('leaves the legacy file readable if migration is interrupted', async () => {
  const legacy = JSON.stringify([{ gateway: A, bundle: createSampleIncident() }]);
  disk.files.set(primary, legacy);
  disk.failWrite = 'truncate';
  const history = await readIncidentHistory(A);
  expect(history.records).toHaveLength(1);
  expect(history.notice).toContain('migration could not be saved');
  expect(disk.files.get(primary)).toBe(legacy);
  expect((await readIncidentHistory(A)).records).toHaveLength(1);
});

it('retries legacy cleanup if the new format saved but removing the old copy failed', async () => {
  const bundle = createSampleIncident();
  bundle.evidence[0]!.metadata.token = 'old-private-value';
  disk.files.set(primary, JSON.stringify([{ gateway: A, bundle }]));
  disk.failDelete.add(primary);
  expect((await readIncidentHistory(A)).records).toHaveLength(1);
  disk.failDelete.clear();
  expect((await readIncidentHistory(A)).records).toHaveLength(1);
  expect([...disk.files.values()].join('')).not.toContain('old-private-value');
});

it('recovers from interrupted writes without dropping a different gateway', async () => {
  const bundle = createSampleIncident();
  await cacheIncident(A, bundle);
  disk.failWrite = 'truncate';
  await expect(cacheIncident(B, bundle)).rejects.toThrow('Disk full');
  const recovered = await readIncidentHistory(A);
  expect(recovered.records).toHaveLength(1);
  expect(recovered.notice).toContain('recovered');
  await cacheIncident(B, bundle);
  expect((await readIncidentHistory(A)).records).toHaveLength(1);
  expect((await readIncidentHistory(B)).records).toHaveLength(1);
});

it('handles corrupt, unreadable and parseable-but-incomplete storage without crashing', async () => {
  for (const raw of ['{broken', 'null', '{}', '42', '{"version":2,"revision":1,"payload":"[]"}']) {
    resetDisk();
    disk.files.set(primary, raw);
    expect((await readIncidentHistory(A)).records).toEqual([]);
    await cacheIncident(A, createSampleIncident());
    expect((await readIncidentHistory(A)).records).toHaveLength(1);
  }
  disk.failRead.add(primary);
  expect((await readIncidentHistory(A)).records).toEqual([]);
  expect((await readIncidentHistory(A)).notice).not.toBeNull();
});

it('uses the last intact generation when a checksum is invalid', async () => {
  const bundle = createSampleIncident();
  await cacheIncident(A, bundle);
  await cacheIncident(B, bundle);
  const raw = JSON.parse(disk.files.get(backup)!);
  raw.payload = '[]';
  disk.files.set(backup, JSON.stringify(raw));
  expect((await readIncidentHistory(A)).records).toHaveLength(1);
  expect((await readIncidentHistory(B)).records).toHaveLength(0);
});

it('preserves imported investigations and their diagnoses in a separate offline collection', async () => {
  const bundle = createSampleIncident();
  const trusted = await cacheIncident(A, bundle);
  const merged = mergeInvestigation(bundle, {
    schemaVersion: 1,
    incidentId: bundle.incident.id,
    generatedAt: bundle.generatedAt,
    checks: [
      {
        name: 'Environment',
        status: 'failed',
        summary: 'DB_URL is absent.',
        evidenceIds: [bundle.evidence[0]!.id],
      },
    ],
  });
  const imported = await cacheOfflineIncident(merged, 'imported-investigation');
  await cacheDiagnosis(imported, createDeterministicDiagnosis(merged));
  expect(imported.gateway).toBeNull();
  expect(imported.id).not.toBe(trusted.id);
  const onOtherGateway = (await readIncidentHistory(B)).records;
  expect(onOtherGateway).toHaveLength(1);
  expect(onOtherGateway[0]!.source).toBe('imported-investigation');
  expect(onOtherGateway[0]!.bundle.evidence.at(-1)!.source).toBe('investigator');
  expect(onOtherGateway[0]!.diagnosis).not.toBeNull();
  expect((await cacheIncident(A, bundle)).diagnosis).toBeNull();
});

it('bounds snapshots by incident and gateway, expiring diagnoses with their evidence', async () => {
  const bundle = createSampleIncident();
  const first = await cacheIncident(A, bundle);
  await cacheDiagnosis(first, createDeterministicDiagnosis(bundle));
  await cacheIncident(B, bundle);
  for (let index = 0; index < HISTORY_LIMITS.perIncident; index++) {
    const next = structuredClone(bundle);
    next.evidence[0]!.excerpt = `Capture ${index}`;
    await cacheIncident(A, next);
  }
  expect((await readIncidentHistory(A)).records).toHaveLength(HISTORY_LIMITS.perIncident);
  expect((await readIncidentHistory(A)).records.some((record) => record.id === first.id)).toBe(
    false,
  );
  await expect(cacheDiagnosis(first, createDeterministicDiagnosis(bundle))).rejects.toThrow(
    'expired',
  );
  for (let index = 0; index < HISTORY_LIMITS.perScope + 2; index++) {
    const next = structuredClone(bundle);
    next.incident.id = `incident-${index}`;
    await cacheIncident(A, next);
  }
  expect((await readIncidentHistory(A)).records).toHaveLength(HISTORY_LIMITS.perScope);
  expect((await readIncidentHistory(B)).records).toHaveLength(1);
});

it('clears all gateways, imports, analyses and recovery copies after in-flight writes', async () => {
  const bundle = createSampleIncident();
  const snapshot = await cacheIncident(A, bundle);
  await cacheDiagnosis(snapshot, createDeterministicDiagnosis(bundle));
  await cacheOfflineIncident(bundle, 'imported-incident');
  const write = cacheIncident(B, bundle);
  const clear = clearIncidentCache();
  await Promise.all([write, clear]);
  expect(disk.files.size).toBe(0);
  expect((await readIncidentHistory(A)).total).toBe(0);
  await expect(cacheDiagnosis(snapshot, createDeterministicDiagnosis(bundle))).rejects.toThrow(
    'cleared',
  );
  expect(disk.files.size).toBe(0);
});

it('bounds the offline import collection independently of every gateway', async () => {
  const bundle = createSampleIncident();
  await cacheIncident(A, bundle);
  for (let index = 0; index < HISTORY_LIMITS.perScope + 2; index++) {
    const next = structuredClone(bundle);
    next.incident.id = `import-${index}`;
    await cacheOfflineIncident(next, index % 2 ? 'imported-investigation' : 'imported-incident');
  }
  const history = await readIncidentHistory(A);
  expect(history.records.filter((record) => record.gateway === null)).toHaveLength(
    HISTORY_LIMITS.perScope,
  );
  expect(history.records.filter((record) => record.gateway === A)).toHaveLength(1);
});

it('reports failed deletion and protects a newer cache format from an older app', async () => {
  disk.files.set(primary, JSON.stringify({ version: 99 }));
  expect((await readIncidentHistory(A)).notice).toContain('newer app format');
  await expect(cacheIncident(A, createSampleIncident())).rejects.toThrow('cache format');
  disk.failDelete.add(primary);
  await expect(clearIncidentCache()).rejects.toThrow('could not be deleted');
  disk.failDelete.clear();
  await clearIncidentCache();
  expect(disk.files.size).toBe(0);
});

it('rejects ambiguous evidence and credential-bearing gateway URLs', async () => {
  const bundle = createSampleIncident();
  await expect(cacheIncident('https://example.com?token=private', bundle)).rejects.toThrow(
    'valid gateway',
  );
  bundle.evidence.push(bundle.evidence[0]!);
  await expect(cacheIncident(A, bundle)).rejects.toThrow('inconsistent');
});
