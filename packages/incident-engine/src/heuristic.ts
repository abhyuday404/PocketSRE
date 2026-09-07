import type { Diagnosis, EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';
import { selectRelevantEvidence } from './correlate.js';
import { getRollbackTarget } from './recovery.js';

function findFirst(
  events: EvidenceEvent[],
  type: EvidenceEvent['type'],
): EvidenceEvent | undefined {
  return events.find((event) => event.type === type);
}

export function createDeterministicDiagnosis(bundle: IncidentBundle): Diagnosis {
  const relevant = selectRelevantEvidence(bundle);
  if (bundle.serviceHealth.status === 'healthy') {
    return {
      mode: 'deterministic',
      summary: 'The latest health snapshot reports a healthy service.',
      likelyCause: null,
      confidence: 'low',
      evidenceIds: relevant
        .filter((event) => ['health_check_passed', 'recovery_completed'].includes(event.type))
        .map((event) => event.id),
      alternativeCauses: [],
      nextDiagnosticStep: null,
      proposedAction: null,
    };
  }
  const rollbackTarget = getRollbackTarget(bundle);
  const exception = findFirst(relevant, 'exception');
  const configuration = findFirst(relevant, 'configuration_changed');
  const failedHealth =
    findFirst(relevant, 'database_check_failed') ?? findFirst(relevant, 'health_check_failed');
  const deployment = findFirst(relevant, 'deployment_completed');

  const strongConfigurationSignal = [exception, configuration]
    .filter((event): event is EvidenceEvent => Boolean(event))
    .some((event) =>
      /DB_URL|DATABASE_URL|environment|config/i.test(`${event.title} ${event.excerpt}`),
    );

  if (strongConfigurationSignal && exception && configuration) {
    const evidenceIds = [configuration.id, exception.id, failedHealth?.id, deployment?.id].filter(
      (id): id is string => Boolean(id),
    );
    return {
      mode: 'deterministic',
      summary: `Configuration and exception evidence suggest a database configuration issue in ${bundle.incident.serviceId}.`,
      likelyCause:
        'A deployment configuration mismatch is preventing the service from connecting to its database.',
      confidence: rollbackTarget && failedHealth ? 'high' : 'medium',
      evidenceIds,
      alternativeCauses: [
        {
          statement: 'The database may be unavailable independently of the deployment.',
          confidence: 'low',
          evidenceIds: failedHealth ? [failedHealth.id] : [exception.id],
        },
      ],
      nextDiagnosticStep:
        'Compare the current release environment contract with the last healthy release.',
      proposedAction: rollbackTarget
        ? {
            type: 'TRIGGER_ROLLBACK_WORKFLOW',
            target: bundle.incident.serviceId,
            reason:
              'The incident began after the current deployment and the previous release was healthy.',
            risk: 'Requests in flight may fail while the previous release becomes active.',
            reversible: true,
            evidenceIds,
            parameters: {
              targetRelease: rollbackTarget,
            },
          }
        : null,
    };
  }

  const evidenceIds = relevant.slice(0, 3).map((event) => event.id);
  return {
    mode: 'deterministic',
    summary: `PocketSRE found ${relevant.length} relevant signals for ${bundle.incident.title}.`,
    likelyCause: null,
    confidence: 'low',
    evidenceIds,
    alternativeCauses: [],
    nextDiagnosticStep:
      'Inspect the highest-ranked exception and compare it with the latest deployment.',
    proposedAction: {
      type: 'RUN_HEALTH_CHECK',
      target: bundle.incident.serviceId,
      reason: 'There is not enough evidence for a mutating recovery action.',
      risk: 'Read-only; no service change.',
      reversible: true,
      evidenceIds,
      parameters: {},
    },
  };
}
