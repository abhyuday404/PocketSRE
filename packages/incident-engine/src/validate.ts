import {
  AllowedActionSchema,
  DiagnosisSchema,
  type Diagnosis,
  type IncidentBundle,
} from '@pocketsre/contracts';

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
