import type {
  ActionProposal,
  Diagnosis,
  EvidenceEvent,
  IncidentBundle,
} from '@pocketsre/contracts';
import { selectRelevantEvidence } from './correlate.js';
import {
  CHANGE_LOOKBACK_MS,
  failureTypes,
  hasConsistentActiveHealth,
  isCurrentObservation,
  isCurrentRelease,
  isFresh,
  isInIncidentWindow,
  isServiceEvidence,
  newestFirst,
  uniqueEvidence,
} from './evidence.js';
import { getRollbackEvidence } from './recovery.js';

export const ABSTENTION_SUMMARY = 'The supplied evidence does not establish a supported cause.';
export const COLLECT_STEP =
  'Collect a fresh health snapshot and current error evidence for this service.';

export interface EvidenceAssessment {
  diagnosis: Diagnosis;
  actions: ActionProposal[];
  state: 'insufficient' | 'observed-failure' | 'matched-configuration' | 'conflicting' | 'healthy';
}

const ids = (events: EvidenceEvent[]) => [...new Set(events.map((event) => event.id))];

// These are deliberately narrow, positive exception signatures, not keyword classification.
// Other database/auth/cache/application errors remain observations until a rule exists.
function missingDatabaseSetting(event: EvidenceEvent): string | undefined {
  if (event.type !== 'exception' || event.source === 'investigator') return undefined;
  const match =
    /^(?:ConfigurationError:\s*)?(?:process\.env\.)?(DB_URL|DATABASE_URL)\s+is\s+(?:undefined|missing|unset)(?:\s+at\s+[^\n]+)?\.?\s*$/.exec(
      event.excerpt.trim().split(/\r?\n/)[0] ?? '',
    );
  return match?.[1];
}

function changesSetting(event: EvidenceEvent, setting: string): boolean {
  if (event.type !== 'configuration_changed' || event.source === 'investigator') return false;
  const text = event.excerpt.trim();
  const variable = `(?:process\\.env\\.)?\\b${setting}\\b`;
  const prior = `(?:process\\.env\\.)?${setting === 'DB_URL' ? 'DATABASE_URL' : 'DB_URL'}`;
  const location = '(?: in [A-Za-z0-9_./-]+)?\\.?';
  const assignment =
    '\\s*(?:export\\s+)?(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*process\\.env\\.';
  // Only an explicit rename to the required variable, removal, or changed env access.
  return (
    new RegExp(
      `^(?:[Cc]ommit [a-fA-F0-9]{7,64} )?(?:[Rr]eplaced|[Rr]enamed)\\s+${prior}\\s+(?:with|to)\\s+${variable}${location}$`,
    ).test(text) ||
    new RegExp(
      `^${prior}\\s+was\\s+(?:replaced|renamed)\\s+(?:with|to)\\s+${variable}${location}$`,
    ).test(text) ||
    new RegExp(
      `^(?:${variable}\\s+was\\s+(?:removed|unset)|(?:Removed|Unset)\\s+${variable})[.\\s]*$`,
      'm',
    ).test(text.trim()) ||
    (new RegExp(`^\\+${assignment}${setting}\\s*!?;?\\s*$`, 'm').test(text) &&
      new RegExp(
        `^-${assignment}${setting === 'DB_URL' ? 'DATABASE_URL' : 'DB_URL'}\\s*!?;?\\s*$`,
        'm',
      ).test(text))
  );
}

function linksChangeToDeployment(change: EvidenceEvent, deployment: EvidenceEvent): boolean {
  const releaseMatches =
    Boolean(change.metadata.release) && change.metadata.release === deployment.metadata.release;
  const commitMatches =
    Boolean(change.metadata.commitSha) &&
    change.metadata.commitSha === deployment.metadata.commitSha;
  const commitConflicts =
    Boolean(change.metadata.commitSha && deployment.metadata.commitSha) &&
    change.metadata.commitSha !== deployment.metadata.commitSha;
  return (
    (releaseMatches || commitMatches) &&
    !commitConflicts &&
    Date.parse(change.timestamp) <= Date.parse(deployment.timestamp)
  );
}

/** Conservative deterministic rules; this does not semantically validate model prose. */
export function assessEvidence(bundle: IncidentBundle): EvidenceAssessment {
  const evidence = uniqueEvidence(bundle).sort(newestFirst);
  const scoped = evidence.filter(
    (event) => isServiceEvidence(event, bundle) && isInIncidentWindow(event, bundle),
  );
  const observations = scoped.filter((event) => isCurrentObservation(event, bundle));
  const failures = observations.filter((event) => failureTypes.has(event.type));
  const healthy = observations.find(
    (event) =>
      ['health_check_passed', 'recovery_completed'].includes(event.type) &&
      event.source === 'health' &&
      event.metadata.release === bundle.serviceHealth.version,
  );
  const diagnosis: Diagnosis = {
    mode: 'deterministic',
    summary: ABSTENTION_SUMMARY,
    likelyCause: null,
    confidence: 'low',
    evidenceIds: [],
    alternativeCauses: [],
    nextDiagnosticStep: COLLECT_STEP,
    proposedAction: null,
  };
  const readOnlyEvidence = selectRelevantEvidence(bundle).filter((event) =>
    isCurrentRelease(event, bundle),
  );
  const healthCheck: ActionProposal | undefined = readOnlyEvidence[0]
    ? {
        type: 'RUN_HEALTH_CHECK',
        target: bundle.incident.serviceId,
        reason: 'Collect a fresh health snapshot to reassess the cited evidence.',
        risk: 'Read-only; no service change.',
        reversible: true,
        evidenceIds: [readOnlyEvidence[0].id],
        parameters: {},
      }
    : undefined;
  const finish = (
    summary: string,
    supporting: EvidenceEvent[],
    allowCheck = true,
    state: EvidenceAssessment['state'] = 'insufficient',
  ): EvidenceAssessment => {
    diagnosis.summary = supporting.length ? summary : ABSTENTION_SUMMARY;
    diagnosis.evidenceIds = ids(supporting);
    diagnosis.proposedAction = allowCheck ? (healthCheck ?? null) : null;
    return { diagnosis, actions: allowCheck && healthCheck ? [healthCheck] : [], state };
  };

  if (!evidence.length) return { diagnosis, actions: [], state: 'insufficient' };
  if (evidence.length !== bundle.evidence.length) return finish(ABSTENTION_SUMMARY, []);
  if (!scoped.length)
    return finish(
      'The available evidence is outside this service or incident time window; a current cause is not established.',
      evidence.slice(0, 3),
      false,
    );
  if (!isFresh(bundle.serviceHealth.checkedAt, bundle) || !observations.length)
    return finish(
      'Fresh observations are insufficient to establish current health or a cause.',
      scoped.slice(0, 3),
    );

  const latestFailure = failures[0];
  const allChecksHealthy =
    Object.keys(bundle.serviceHealth.checks).length > 0 &&
    Object.values(bundle.serviceHealth.checks).every((status) => status === 'healthy');
  if (bundle.serviceHealth.status === 'healthy') {
    if (
      bundle.serviceHealth.serviceId !== bundle.incident.serviceId ||
      !allChecksHealthy ||
      (latestFailure &&
        (!healthy || Date.parse(latestFailure.timestamp) >= Date.parse(healthy.timestamp)))
    ) {
      return finish(
        'Health and failure evidence conflict; reconcile current health before assigning a cause.',
        [healthy, latestFailure].filter((event): event is EvidenceEvent => Boolean(event)),
        true,
        'conflicting',
      );
    }
    if (!healthy)
      return finish(
        'No current health or recovery event corroborates the healthy snapshot; a cause is not assigned.',
        [],
      );
    diagnosis.nextDiagnosticStep = null;
    return finish(
      'A recent health or recovery event agrees with the healthy snapshot; no active cause is assigned.',
      [healthy],
      false,
      'healthy',
    );
  }
  if (!hasConsistentActiveHealth(bundle))
    return finish(
      'Current health is unavailable or inconsistent with the incident; a cause is not assigned.',
      observations.slice(0, 3),
    );
  if (
    healthy &&
    (!latestFailure || Date.parse(healthy.timestamp) >= Date.parse(latestFailure.timestamp))
  )
    return finish(
      'Health and failure evidence conflict; reconcile current health before assigning a cause.',
      [healthy, ...(latestFailure ? [latestFailure] : [])],
      true,
      'conflicting',
    );

  const deployments = scoped.filter(
    (event) => event.type === 'deployment_completed' && event.source === 'deployment',
  );
  const deployment = deployments[0];
  const preDeploymentFailure =
    deployment &&
    scoped.find(
      (event) =>
        failureTypes.has(event.type) &&
        Date.parse(event.timestamp) < Date.parse(deployment.timestamp),
    );
  const conflictingDeployment =
    deployment &&
    deployments.find(
      (event) =>
        (event.metadata.release === deployment.metadata.release ||
          event.timestamp === deployment.timestamp) &&
        (event.metadata.release !== deployment.metadata.release ||
          event.metadata.previousRelease !== deployment.metadata.previousRelease ||
          event.metadata.previousHealthy !== deployment.metadata.previousHealthy ||
          event.metadata.commitSha !== deployment.metadata.commitSha),
    );
  const timingConflict =
    deployment &&
    (!isCurrentRelease(deployment, bundle) ||
      Date.parse(deployment.timestamp) > Date.parse(bundle.incident.startedAt) ||
      preDeploymentFailure ||
      conflictingDeployment);
  if (timingConflict)
    return finish(
      'Release or timing evidence conflicts with a deployment-related cause; reconcile the timeline first.',
      [deployment, preDeploymentFailure, conflictingDeployment].filter(
        (event): event is EvidenceEvent => Boolean(event),
      ),
      true,
      'conflicting',
    );

  for (const exception of failures) {
    const setting = missingDatabaseSetting(exception);
    if (!setting) continue;
    const changes = scoped.filter((event) => changesSetting(event, setting));
    const change = changes[0];
    if (!change) continue;
    const delay = Date.parse(exception.timestamp) - Date.parse(change.timestamp);
    if (
      !isCurrentRelease(change, bundle) ||
      delay < 0 ||
      delay > CHANGE_LOOKBACK_MS ||
      (deployment &&
        change.metadata.commitSha &&
        deployment.metadata.commitSha &&
        change.metadata.commitSha !== deployment.metadata.commitSha) ||
      bundle.serviceHealth.checks.database === 'healthy'
    ) {
      return finish(
        'Configuration, release, timing, or health evidence conflicts; a configuration cause is not established.',
        [change, exception],
        true,
        'conflicting',
      );
    }
    diagnosis.summary = `A change to ${setting} matches an exception reporting that database setting missing; causality remains unconfirmed.`;
    diagnosis.likelyCause = `The ${setting} configuration change may explain the reported database initialization failure.`;
    // Sources and valid references do not prove causality. Even this matched rule is a hypothesis.
    diagnosis.confidence = 'medium';
    diagnosis.evidenceIds = [change.id, exception.id];
    diagnosis.nextDiagnosticStep = `Compare the required ${setting} setting with the deployed environment contract without exposing secret values.`;
    const rollback = getRollbackEvidence(bundle);
    if (
      rollback &&
      linksChangeToDeployment(change, rollback.deployment) &&
      exception.metadata.release === bundle.serviceHealth.version &&
      Date.parse(exception.timestamp) >= Date.parse(rollback.deployment.timestamp)
    ) {
      const action: ActionProposal = {
        type: 'TRIGGER_ROLLBACK_WORKFLOW',
        target: bundle.incident.serviceId,
        reason:
          'The matched configuration change is linked to the current deployment, failures follow that deployment, and its metadata identifies a previous healthy release.',
        risk: 'Requests in flight may fail while the previous release becomes active.',
        reversible: true,
        evidenceIds: ids([change, exception, rollback.deployment, rollback.failure]),
        parameters: { targetRelease: rollback.targetRelease },
      };
      diagnosis.proposedAction = action;
      return {
        diagnosis,
        actions: [...(healthCheck ? [healthCheck] : []), action],
        state: 'matched-configuration',
      };
    }
    return { diagnosis, actions: healthCheck ? [healthCheck] : [], state: 'matched-configuration' };
  }

  const databaseFailure = failures.find((event) => event.type === 'database_check_failed');
  if (databaseFailure)
    return finish(
      'A database check failed; this observation does not distinguish configuration failure from an independent database outage.',
      [databaseFailure],
      true,
      'observed-failure',
    );
  if (failures.length)
    return finish(
      'Recent failure observations are present, but they do not establish a supported cause.',
      failures.slice(0, 3),
      true,
      'observed-failure',
    );
  return finish(ABSTENTION_SUMMARY, []);
}
