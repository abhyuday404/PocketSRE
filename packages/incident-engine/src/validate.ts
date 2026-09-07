import {
  AllowedActionSchema,
  DiagnosisSchema,
  type Diagnosis,
  type IncidentBundle,
} from '@pocketsre/contracts';
import { getRollbackTarget } from './recovery.js';

export type DiagnosisValidationResult =
  { success: true; diagnosis: Diagnosis } | { success: false; errors: string[] };

export function validateDiagnosis(
  input: unknown,
  bundle: IncidentBundle,
): DiagnosisValidationResult {
  const parsed = DiagnosisSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const evidenceIds = new Set(bundle.evidence.map((event) => event.id));
  const referencedIds = [
    ...parsed.data.evidenceIds,
    ...parsed.data.alternativeCauses.flatMap((item) => item.evidenceIds),
    ...(parsed.data.proposedAction?.evidenceIds ?? []),
  ];
  const unknownIds = referencedIds.filter((id) => !evidenceIds.has(id));
  const errors: string[] = [];
  const diagnosis = parsed.data;
  if (diagnosis.likelyCause && diagnosis.evidenceIds.length === 0) {
    errors.push('A likely cause requires supporting evidence.');
  }
  if (diagnosis.alternativeCauses.some((cause) => cause.evidenceIds.length === 0)) {
    errors.push('Each alternative cause requires evidence.');
  }
  const sources = new Set(
    bundle.evidence
      .filter((event) => diagnosis.evidenceIds.includes(event.id))
      .map((event) => event.source),
  );
  if (diagnosis.confidence === 'high' && sources.size < 2) {
    errors.push('High confidence requires at least two independent evidence sources.');
  }
  const action = diagnosis.proposedAction;
  if (action) {
    if (action.type !== 'RUN_HEALTH_CHECK' && action.evidenceIds.length === 0)
      errors.push('A write action requires evidence.');
    const keys = Object.keys(action.parameters);
    if (action.type === 'TRIGGER_ROLLBACK_WORKFLOW') {
      const target = getRollbackTarget(bundle);
      if (
        !target ||
        action.parameters.targetRelease !== target ||
        keys.some((key) => key !== 'targetRelease')
      ) {
        errors.push(
          'Rollback requires the verified previous healthy release of the current deployment.',
        );
      }
    } else if (keys.length > 0) errors.push('Unexpected action parameters.');
    if (action.type === 'CREATE_GITHUB_ISSUE') errors.push('Issue creation is not enabled.');
  }

  if (unknownIds.length > 0) {
    errors.push(`Diagnosis references unknown evidence: ${[...new Set(unknownIds)].join(', ')}`);
  }

  if (
    parsed.data.proposedAction &&
    !AllowedActionSchema.safeParse(parsed.data.proposedAction.type).success
  ) {
    errors.push('Diagnosis proposes an unsupported action.');
  }

  if (
    parsed.data.proposedAction &&
    parsed.data.proposedAction.target !== bundle.incident.serviceId
  ) {
    errors.push('Proposed action target does not match the incident service.');
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, diagnosis: parsed.data };
}
