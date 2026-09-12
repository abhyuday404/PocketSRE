import { DiagnosisSchema, type Diagnosis, type IncidentBundle } from '@pocketsre/contracts';
import { ABSTENTION_SUMMARY, assessEvidence } from './assessment.js';
import {
  failureTypes,
  isCurrentObservation,
  isCurrentRelease,
  isInIncidentWindow,
  isServiceEvidence,
  uniqueEvidence,
} from './evidence.js';
import { getRollbackEvidence } from './recovery.js';

export type DiagnosisValidationResult =
  | {
      success: true;
      diagnosis: Diagnosis;
      validation: {
        references: 'validated';
        causality: 'not-verified';
      };
    }
  | { success: false; errors: string[] };

const includesSupport = (cited: string[], required: string[]) =>
  required.every((id) => cited.includes(id));
const confidenceRank = { low: 0, medium: 1, high: 2 };

export function validateDiagnosis(
  input: unknown,
  bundle: IncidentBundle,
): DiagnosisValidationResult {
  const parsed = DiagnosisSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const evidence = uniqueEvidence(bundle);
  const evidenceIds = new Set(evidence.map((event) => event.id));
  const referencedIds = [
    ...parsed.data.evidenceIds,
    ...parsed.data.alternativeCauses.flatMap((item) => item.evidenceIds),
    ...(parsed.data.proposedAction?.evidenceIds ?? []),
  ];
  const unknownIds = referencedIds.filter((id) => !evidenceIds.has(id));
  const errors: string[] = [];
  const diagnosis = parsed.data;
  if (
    !diagnosis.summary.trim() ||
    diagnosis.likelyCause?.trim() === '' ||
    diagnosis.alternativeCauses.some((cause) => !cause.statement.trim())
  ) {
    errors.push('Assertions must contain text; use null for an unassigned cause.');
  }
  const assessment = assessEvidence(bundle);
  const supported = assessment.diagnosis;
  // This is structural validation, not semantic proof of model prose. New hypotheses
  // and paraphrases are allowed, at low confidence without a matched causal rule.
  const abstention =
    diagnosis.summary === ABSTENTION_SUMMARY &&
    diagnosis.likelyCause === null &&
    diagnosis.confidence === 'low' &&
    diagnosis.alternativeCauses.length === 0;
  if (!diagnosis.evidenceIds.length && !abstention)
    errors.push('A summary requires evidence or an explicit abstention.');
  const checkHypothesis = (cited: string[], confidence: Diagnosis['confidence']) => {
    const supporting = evidence.filter((event) => cited.includes(event.id));
    if (
      !['observed-failure', 'matched-configuration'].includes(assessment.state) ||
      !supporting.some(
        (event) =>
          failureTypes.has(event.type) &&
          event.source !== 'investigator' &&
          isCurrentObservation(event, bundle),
      ) ||
      supporting.some(
        (event) =>
          !isServiceEvidence(event, bundle) ||
          !isInIncidentWindow(event, bundle) ||
          !isCurrentRelease(event, bundle),
      )
    ) {
      errors.push(
        'A hypothesis requires current failure evidence without known health, release, or timing contradictions.',
      );
    }
    const maximum =
      supported.likelyCause && includesSupport(cited, supported.evidenceIds) ? 'medium' : 'low';
    if (confidenceRank[confidence] > confidenceRank[maximum])
      errors.push('Confidence exceeds the available evidence structure.');
  };
  if (diagnosis.likelyCause !== null) checkHypothesis(diagnosis.evidenceIds, diagnosis.confidence);
  else if (diagnosis.confidence !== 'low')
    errors.push('An unassigned cause requires low confidence.');
  for (const cause of diagnosis.alternativeCauses)
    checkHypothesis(cause.evidenceIds, cause.confidence);
  if (diagnosis.nextDiagnosticStep !== null && !diagnosis.evidenceIds.length && !abstention) {
    errors.push('A diagnostic step requires cited context or an explicit abstention.');
  }
  const action = diagnosis.proposedAction;
  if (action) {
    if (!action.reason.trim() || !action.risk.trim())
      errors.push('An action requires a reason and risk description.');
    if (
      action.evidenceIds.length === 0 ||
      !evidence.some(
        (event) =>
          action.evidenceIds.includes(event.id) &&
          isServiceEvidence(event, bundle) &&
          isInIncidentWindow(event, bundle),
      )
    ) {
      errors.push('Every action requires its own incident evidence.');
    }
    const keys = Object.keys(action.parameters);
    if (action.type === 'TRIGGER_ROLLBACK_WORKFLOW') {
      const rollback = getRollbackEvidence(bundle);
      const citesFailure =
        rollback &&
        evidence.some(
          (event) =>
            action.evidenceIds.includes(event.id) &&
            failureTypes.has(event.type) &&
            event.source !== 'investigator' &&
            isCurrentObservation(event, bundle) &&
            event.metadata.release === bundle.serviceHealth.version &&
            Date.parse(event.timestamp) >= Date.parse(rollback.deployment.timestamp),
        );
      if (
        !rollback ||
        assessment.state === 'conflicting' ||
        action.parameters.targetRelease !== rollback.targetRelease ||
        !action.evidenceIds.includes(rollback.deployment.id) ||
        !citesFailure ||
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
    errors.push(
      `Diagnosis references unknown or ambiguous evidence: ${[...new Set(unknownIds)].join(', ')}`,
    );
  }

  if (
    parsed.data.proposedAction &&
    parsed.data.proposedAction.target !== bundle.incident.serviceId
  ) {
    errors.push('Proposed action target does not match the incident service.');
  }

  if (errors.length > 0) return { success: false, errors };
  return {
    success: true,
    diagnosis: parsed.data,
    validation: {
      references: 'validated',
      causality: 'not-verified',
    },
  };
}
