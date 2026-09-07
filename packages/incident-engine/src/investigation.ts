import { InvestigationResultSchema, type IncidentBundle } from '@pocketsre/contracts';
import { sanitizeBundle } from './redact.js';

export function mergeInvestigation(bundle: IncidentBundle, input: unknown): IncidentBundle {
  const result = InvestigationResultSchema.parse(input);
  if (result.incidentId !== bundle.incident.id)
    throw new Error('Investigation belongs to another incident.');
  const ids = new Set(bundle.evidence.map((event) => event.id));
  if (result.checks.some((check) => check.evidenceIds.some((id) => !ids.has(id)))) {
    throw new Error('Investigation references evidence missing from this incident.');
  }
  const additions = result.checks.map((check, index) => ({
    id: `investigation:${result.generatedAt}:${index}`,
    source: 'investigator' as const,
    type: 'investigation_result' as const,
    timestamp: result.generatedAt,
    title: `${check.name}: ${check.status}`,
    excerpt: check.summary,
    externalUrl: null,
    metadata: { status: check.status, evidenceIds: check.evidenceIds.join(',') },
  }));
  return sanitizeBundle({
    ...bundle,
    evidence: [...bundle.evidence, ...additions.filter((event) => !ids.has(event.id))],
  });
}
