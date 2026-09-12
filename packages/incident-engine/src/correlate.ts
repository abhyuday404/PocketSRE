import type { EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';
import {
  isCurrentRelease,
  isFresh,
  isInIncidentWindow,
  isServiceEvidence,
  newestFirst,
  uniqueEvidence,
} from './evidence.js';

const MAX_MODEL_EVIDENCE = 10;

const typePriority: Partial<Record<EvidenceEvent['type'], number>> = {
  health_check_failed: 10,
  database_check_failed: 10,
  health_check_passed: 10,
  recovery_completed: 10,
  exception: 9,
  error_rate_increased: 9,
  configuration_changed: 8,
  deployment_completed: 8,
  investigation_result: 7,
  deployment_started: 6,
  commit: 5,
};

function scoreEvidence(event: EvidenceEvent, bundle: IncidentBundle): number {
  return (
    (typePriority[event.type] ?? 7) +
    (event.metadata.release === bundle.serviceHealth.version ? 4 : 0) +
    (isCurrentRelease(event, bundle) ? 2 : -4) +
    (isFresh(event.timestamp, bundle) ? 4 : 0)
  );
}

/** Domain-neutral ranking with room for changes, failures, and recovery/counterevidence. */
export function selectRelevantEvidence(bundle: IncidentBundle): EvidenceEvent[] {
  const ranked = uniqueEvidence(bundle)
    .filter((event) => isServiceEvidence(event, bundle) && isInIncidentWindow(event, bundle))
    .sort((a, b) => scoreEvidence(b, bundle) - scoreEvidence(a, bundle) || newestFirst(a, b));
  const selected = new Set<string>();
  const reserve = (predicate: (event: EvidenceEvent) => boolean) => {
    const event = ranked.find(predicate);
    if (event) selected.add(event.id);
  };
  reserve((event) => ['health_check_passed', 'recovery_completed'].includes(event.type));
  reserve((event) => ['health_check_failed', 'database_check_failed'].includes(event.type));
  reserve((event) => event.type === 'exception');
  reserve((event) => event.type === 'error_rate_increased');
  reserve((event) => event.type === 'configuration_changed');
  reserve((event) => event.type === 'deployment_completed');
  reserve((event) => event.type === 'investigation_result');
  reserve((event) => !isCurrentRelease(event, bundle));
  for (const event of ranked) {
    if (selected.size >= MAX_MODEL_EVIDENCE) break;
    selected.add(event.id);
  }
  return ranked.filter((event) => selected.has(event.id));
}

export function chronologicalEvidence(bundle: IncidentBundle): EvidenceEvent[] {
  return [...bundle.evidence].sort((a, b) => -newestFirst(a, b));
}
