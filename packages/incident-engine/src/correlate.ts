import type { EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';

const MAX_MODEL_EVIDENCE = 10;

const typePriority: Partial<Record<EvidenceEvent['type'], number>> = {
  health_check_failed: 10,
  database_check_failed: 10,
  exception: 9,
  error_rate_increased: 8,
  configuration_changed: 8,
  deployment_completed: 7,
  commit: 6,
  investigation_result: 6,
  health_check_passed: 3,
};

function scoreEvidence(event: EvidenceEvent, bundle: IncidentBundle): number {
  let score = typePriority[event.type] ?? 1;
  const currentVersion = bundle.serviceHealth.version.toLowerCase();
  const searchable =
    `${event.title} ${event.excerpt} ${Object.values(event.metadata).join(' ')}`.toLowerCase();

  if (searchable.includes(currentVersion)) score += 4;
  if (/database|db_url|database_url|connection|environment|config/.test(searchable)) score += 3;
  if (/checkout|critical|500|failed|exception/.test(searchable)) score += 2;

  return score;
}

export function selectRelevantEvidence(bundle: IncidentBundle): EvidenceEvent[] {
  return [...bundle.evidence]
    .map((event) => ({ event, score: scoreEvidence(event, bundle) }))
    .sort((a, b) => b.score - a.score || b.event.timestamp.localeCompare(a.event.timestamp))
    .slice(0, MAX_MODEL_EVIDENCE)
    .map(({ event }) => event);
}

export function chronologicalEvidence(bundle: IncidentBundle): EvidenceEvent[] {
  return [...bundle.evidence].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
