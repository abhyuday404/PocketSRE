import { File, Paths } from 'expo-file-system';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { IncidentBundleSchema, type Diagnosis, type IncidentBundle } from '@pocketsre/contracts';
import { redactText, sanitizeBundle, validateDiagnosis } from '@pocketsre/incident-engine';

export const HISTORY_LIMITS = { perIncident: 5, perScope: 30 } as const;
export type SnapshotSource = 'gateway' | 'imported-incident' | 'imported-investigation' | 'sample';
export type SavedDiagnosis = { snapshotId: string; analyzedAt: string; value: Diagnosis };
export type SavedIncident = {
  id: string;
  source: SnapshotSource;
  gateway: string | null;
  // Legacy caches did not record a local capture time.
  capturedAt: string | null;
  bundle: IncidentBundle;
  diagnosis: SavedDiagnosis | null;
};
export type IncidentHistory = { records: SavedIncident[]; total: number; notice: string | null };
type Store = {
  records: SavedIncident[];
  revision: number;
  slot: number | null;
  notice: string | null;
  legacy: boolean;
  unsupported: boolean;
};

const filenames = ['pocketsre-incidents.json', 'pocketsre-incidents.backup.json'];
const fileAt = (slot: number) => new File(Paths.document, filenames[slot]!);
const digest = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

// Serialize reads, migrations, writes and deletion to prevent lost updates and
// resurrection by an earlier in-flight save. Never share a mutable store with callers.
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}

function gatewayKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function storedBundle(input: IncidentBundle): IncidentBundle {
  const bundle = sanitizeBundle(IncidentBundleSchema.parse(input));
  // Preserve optional collection extensions while sanitizing collector messages.
  if (bundle.collection)
    bundle.collection = bundle.collection.map((item) => ({
      ...item,
      source: redactText(item.source),
      message: redactText(item.message),
    }));
  return bundle;
}

/** All evidence content, health, collection status and timestamps are included, not just IDs. */
export function snapshotId(source: SnapshotSource, gateway: string | null, bundle: IncidentBundle) {
  return digest(
    canonical({
      source,
      gateway: source === 'gateway' ? gatewayKey(gateway) : null,
      bundle: storedBundle(bundle),
    }),
  );
}

export function validatedDiagnosis(input: unknown, bundle: IncidentBundle): Diagnosis {
  const parsed = validateDiagnosis(input, bundle);
  if (!parsed.success)
    throw new Error('Analysis rejected: it does not match this incident evidence.');
  // This cache adapter can use the shared sanitizeDiagnosis helper on integration.
  // Preserve opaque citation/service IDs while redacting generated prose and parameters.
  const clean = JSON.parse(
    JSON.stringify(parsed.diagnosis, (_key, value: unknown) =>
      typeof value === 'string' ? redactText(value) : value,
    ),
  ) as Diagnosis;
  clean.evidenceIds = parsed.diagnosis.evidenceIds;
  clean.alternativeCauses.forEach((cause, index) => {
    cause.evidenceIds = parsed.diagnosis.alternativeCauses[index]!.evidenceIds;
  });
  if (clean.proposedAction && parsed.diagnosis.proposedAction) {
    clean.proposedAction.evidenceIds = parsed.diagnosis.proposedAction.evidenceIds;
    clean.proposedAction.target = parsed.diagnosis.proposedAction.target;
  }
  // A redacted release parameter must not turn into a different executable proposal.
  const sanitized = validateDiagnosis(clean, bundle);
  if (!sanitized.success) throw new Error('Analysis rejected after sanitization.');
  return sanitized.diagnosis;
}

async function parseRecord(raw: unknown, legacy: boolean): Promise<SavedIncident | null> {
  if (!isObject(raw)) return null;
  const parsed = IncidentBundleSchema.safeParse(raw.bundle);
  if (!parsed.success) return null;
  const bundle = storedBundle(parsed.data);
  if (
    new Set(bundle.evidence.map((event) => event.id)).size !== bundle.evidence.length ||
    bundle.incident.serviceId !== bundle.serviceHealth.serviceId
  )
    return null;
  const source = legacy ? 'gateway' : raw.source;
  if (
    source !== 'gateway' &&
    source !== 'imported-incident' &&
    source !== 'imported-investigation' &&
    source !== 'sample'
  )
    return null;
  const gateway = source === 'gateway' ? gatewayKey(raw.gateway) : null;
  if (source === 'gateway' && !gateway) return null;
  if (!legacy && source !== 'gateway' && raw.gateway !== null) return null;
  const id = await snapshotId(source, gateway, bundle);
  if (!legacy && (raw.id !== id || (raw.capturedAt !== null && !isDate(raw.capturedAt))))
    return null;
  let diagnosis: SavedDiagnosis | null = null;
  if (
    !legacy &&
    isObject(raw.diagnosis) &&
    raw.diagnosis.snapshotId === id &&
    isDate(raw.diagnosis.analyzedAt)
  ) {
    try {
      diagnosis = {
        snapshotId: id,
        analyzedAt: raw.diagnosis.analyzedAt,
        value: validatedDiagnosis(raw.diagnosis.value, bundle),
      };
    } catch {
      /* Keep valid evidence even if its analysis is invalid. */
    }
  }
  return {
    id,
    source,
    gateway,
    capturedAt: legacy ? null : (raw.capturedAt as string | null),
    bundle,
    diagnosis,
  };
}

function retain(records: SavedIncident[]): SavedIncident[] {
  const scopes = new Map<string, number>();
  const incidents = new Map<string, number>();
  const ids = new Set<string>();
  // New captures are prepended. Preserve capture order even if the device clock
  // moves backwards or a migrated gateway supplied a future timestamp.
  return records.filter((record) => {
    const scope = record.gateway ?? (record.source === 'sample' ? 'sample' : 'imports');
    const incident = JSON.stringify([
      scope,
      record.bundle.incident.serviceId,
      record.bundle.incident.id,
    ]);
    if (
      ids.has(record.id) ||
      (scopes.get(scope) ?? 0) >= HISTORY_LIMITS.perScope ||
      (incidents.get(incident) ?? 0) >= HISTORY_LIMITS.perIncident
    )
      return false;
    ids.add(record.id);
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    incidents.set(incident, (incidents.get(incident) ?? 0) + 1);
    return true;
  });
}

async function loadStore(): Promise<Store> {
  let chosen: { slot: number; revision: number; records: unknown[]; legacy: boolean } | null = null;
  let damaged = false;
  let unsupported = false;
  let legacyCopy = false;
  for (let slot = 0; slot < filenames.length; slot++) {
    try {
      const file = fileAt(slot);
      if (!file.exists) continue;
      const raw: unknown = JSON.parse(await file.text());
      if (Array.isArray(raw) && slot === 0) {
        legacyCopy = true;
        chosen ??= { slot, revision: 0, records: raw, legacy: true };
        continue;
      }
      if (isObject(raw) && typeof raw.version === 'number' && raw.version > 2) {
        unsupported = true;
        continue;
      }
      if (
        !isObject(raw) ||
        raw.version !== 2 ||
        !Number.isSafeInteger(raw.revision) ||
        (raw.revision as number) < 1 ||
        typeof raw.payload !== 'string' ||
        raw.checksum !== (await digest(`${raw.revision}:${raw.payload}`))
      ) {
        damaged = true;
        continue;
      }
      const records: unknown = JSON.parse(raw.payload);
      if (!Array.isArray(records)) {
        damaged = true;
        continue;
      }
      if (!chosen || (raw.revision as number) > chosen.revision)
        chosen = { slot, revision: raw.revision as number, records, legacy: false };
    } catch {
      damaged = true;
    }
  }
  const records: SavedIncident[] = [];
  if (chosen) {
    for (const raw of chosen.records) {
      const record = await parseRecord(raw, chosen.legacy);
      if (record) records.push(record);
      if (!record || (isObject(raw) && raw.diagnosis && !record.diagnosis)) damaged = true;
    }
  }
  return {
    records: retain(records),
    revision: chosen?.revision ?? 0,
    slot: chosen?.slot ?? null,
    // Retry cleanup if a previous migration committed but deleting the old file failed.
    legacy: legacyCopy,
    unsupported,
    notice: unsupported
      ? 'Saved history uses a newer app format. It will not be overwritten.'
      : damaged
        ? 'Some saved data was unreadable. Available evidence was recovered; invalid analyses were removed.'
        : null,
  };
}

async function commit(store: Store, records: SavedIncident[]): Promise<Store> {
  if (store.unsupported)
    throw new Error('Update the app or clear saved history before saving this cache format.');
  const revision = store.revision + 1;
  const payload = JSON.stringify(retain(records));
  const content = JSON.stringify({
    version: 2,
    revision,
    payload,
    checksum: await digest(`${revision}:${payload}`),
  });
  const slot = store.slot === 0 ? 1 : 0;
  const file = fileAt(slot);
  // Leave the last verified generation untouched until this generation is readable.
  file.create({ overwrite: true });
  file.write(content);
  if ((await file.text()) !== content) throw new Error('Saved history could not be verified.');
  if (store.legacy && store.slot !== null) fileAt(store.slot).delete();
  return { ...store, records: retain(records), revision, slot, legacy: false };
}

export function readIncidentHistory(gateway: string): Promise<IncidentHistory> {
  return serial(async () => {
    let store = await loadStore();
    if (store.legacy && !store.unsupported) {
      try {
        store = await commit(store, store.records);
      } catch {
        store.notice =
          'Saved evidence is readable, but migration could not be saved. Try again after freeing storage.';
      }
    }
    const key = gatewayKey(gateway);
    return {
      records: store.records.filter((record) => record.gateway === null || record.gateway === key),
      total: store.records.length,
      notice: store.notice,
    };
  });
}

async function saveSnapshot(
  source: SnapshotSource,
  gateway: string | null,
  input: IncidentBundle,
): Promise<SavedIncident> {
  const bundle = storedBundle(input);
  const id = await snapshotId(source, gateway, bundle);
  const candidate = await parseRecord(
    { id, source, gateway, bundle, capturedAt: new Date().toISOString(), diagnosis: null },
    false,
  );
  if (!candidate) throw new Error('Incident has inconsistent service or evidence identifiers.');
  const store = await loadStore();
  const existing = store.records.find((record) => record.id === id);
  if (existing) return existing;
  await commit(store, [candidate, ...store.records]);
  return candidate;
}

export function cacheIncident(gateway: string, bundle: IncidentBundle): Promise<SavedIncident> {
  return serial(async () => {
    const key = gatewayKey(gateway);
    if (!key) throw new Error('Cannot save an incident without a valid gateway URL.');
    return saveSnapshot('gateway', key, bundle);
  });
}

export function cacheOfflineIncident(
  bundle: IncidentBundle,
  source: Exclude<SnapshotSource, 'gateway'>,
): Promise<SavedIncident> {
  return serial(() => saveSnapshot(source, null, bundle));
}

export function cacheDiagnosis(snapshot: SavedIncident, input: unknown): Promise<SavedIncident> {
  return serial(async () => {
    const expected = await parseRecord(snapshot, false);
    if (!expected) throw new Error('The analysis snapshot is invalid.');
    const value = validatedDiagnosis(input, expected.bundle);
    const store = await loadStore();
    const existing = store.records.find((record) => record.id === expected.id);
    if (!existing)
      throw new Error(
        'This snapshot was cleared or expired. Refresh or import it again before saving analysis.',
      );
    const updated = {
      ...existing,
      diagnosis: { snapshotId: existing.id, analyzedAt: new Date().toISOString(), value },
    };
    await commit(
      store,
      store.records.map((record) => (record.id === updated.id ? updated : record)),
    );
    return updated;
  });
}

/** Clears every gateway, import, diagnosis and recovery generation on this phone. */
export function clearIncidentCache(): Promise<void> {
  return serial(async () => {
    const errors: unknown[] = [];
    for (let slot = 0; slot < filenames.length; slot++) {
      try {
        const file = fileAt(slot);
        if (file.exists) file.delete();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new Error('Some saved data could not be deleted. Retry clearing history.');
  });
}
