import type { IncidentBundle } from '@pocketsre/contracts';
import { selectRelevantEvidence } from './correlate.js';
import { sanitizeBundle } from './redact.js';

export function buildTriagePrompt(rawBundle: IncidentBundle): string {
  const bundle = sanitizeBundle(rawBundle);
  const evidence = selectRelevantEvidence(bundle);

  return [
    'You are PocketSRE, an on-device incident triage assistant.',
    'Use only the supplied evidence. Never invent events, files, values, or commands.',
    'If evidence is insufficient, set likelyCause to null and confidence to low.',
    'Every conclusion and action must cite evidenceIds from the supplied evidence.',
    'Only propose RUN_HEALTH_CHECK, TRIGGER_ROLLBACK_WORKFLOW, or CREATE_GITHUB_ISSUE.',
    'Prefer read-only or reversible actions. Do not output shell commands.',
    'Return one JSON object matching the Diagnosis schema and no surrounding prose.',
    '',
    `INCIDENT_BUNDLE=${JSON.stringify({ ...bundle, evidence })}`,
  ].join('\n');
}
