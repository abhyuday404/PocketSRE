import type { EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';

// All time decisions use the bundle clock, so archived incidents remain reproducible.
export const CHANGE_LOOKBACK_MS = 60 * 60_000;
export const OBSERVATION_MAX_AGE_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const ONSET_TOLERANCE_MS = 5 * 60_000;

export const failureTypes: ReadonlySet<EvidenceEvent['type']> = new Set([
  'exception',
  'error_rate_increased',
  'health_check_failed',
  'database_check_failed',
]);

export function isServiceEvidence(event: EvidenceEvent, bundle: IncidentBundle): boolean {
  return !event.metadata.serviceId || event.metadata.serviceId === bundle.incident.serviceId;
}

export function isCurrentRelease(event: EvidenceEvent, bundle: IncidentBundle): boolean {
  return !event.metadata.release || event.metadata.release === bundle.serviceHealth.version;
}

export function isInIncidentWindow(event: EvidenceEvent, bundle: IncidentBundle): boolean {
  const time = Date.parse(event.timestamp);
  return (
    time >= Date.parse(bundle.incident.startedAt) - CHANGE_LOOKBACK_MS &&
    time <= Date.parse(bundle.generatedAt) + CLOCK_SKEW_MS
  );
}

export function isFresh(timestamp: string, bundle: IncidentBundle): boolean {
  const age = Date.parse(bundle.generatedAt) - Date.parse(timestamp);
  return age >= -CLOCK_SKEW_MS && age <= OBSERVATION_MAX_AGE_MS;
}

export function isCurrentObservation(event: EvidenceEvent, bundle: IncidentBundle): boolean {
  return (
    isServiceEvidence(event, bundle) &&
    isCurrentRelease(event, bundle) &&
    isInIncidentWindow(event, bundle) &&
    isFresh(event.timestamp, bundle) &&
    Date.parse(event.timestamp) >= Date.parse(bundle.incident.startedAt) - ONSET_TOLERANCE_MS
  );
}

/** Ambiguous IDs cannot identify supporting evidence; never select either duplicate. */
export function uniqueEvidence(bundle: IncidentBundle): EvidenceEvent[] {
  const counts = new Map<string, number>();
  for (const event of bundle.evidence) counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  return bundle.evidence.filter((event) => counts.get(event.id) === 1);
}

export function newestFirst(a: EvidenceEvent, b: EvidenceEvent): number {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id);
}

export function hasConsistentActiveHealth(bundle: IncidentBundle): boolean {
  return (
    bundle.serviceHealth.serviceId === bundle.incident.serviceId &&
    isFresh(bundle.serviceHealth.checkedAt, bundle) &&
    ['degraded', 'down'].includes(bundle.serviceHealth.status) &&
    typeof bundle.serviceHealth.version === 'string' &&
    bundle.serviceHealth.version.trim().length > 0 &&
    !bundle.collection?.some(
      (entry) => entry.source.toLowerCase() === 'health' && entry.status === 'unavailable',
    ) &&
    bundle.incident.status !== 'resolved' &&
    Object.values(bundle.serviceHealth.checks).some((status) => status !== 'healthy')
  );
}
