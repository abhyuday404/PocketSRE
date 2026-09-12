import type { EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';
import {
  failureTypes,
  hasConsistentActiveHealth,
  isCurrentObservation,
  isInIncidentWindow,
  isServiceEvidence,
  newestFirst,
  uniqueEvidence,
} from './evidence.js';

export interface RollbackEvidence {
  targetRelease: string;
  deployment: EvidenceEvent;
  failure: EvidenceEvent;
}

/** Release eligibility is an action boundary, not evidence that a deployment caused failure. */
export function getRollbackEvidence(bundle: IncidentBundle): RollbackEvidence | null {
  if (!hasConsistentActiveHealth(bundle)) return null;
  const unique = uniqueEvidence(bundle);
  if (unique.length !== bundle.evidence.length) return null;
  const evidence = unique.filter(
    (event) => isServiceEvidence(event, bundle) && isInIncidentWindow(event, bundle),
  );
  const deployments = evidence
    .filter((event) => event.type === 'deployment_completed' && event.source === 'deployment')
    .sort(newestFirst);
  const deployment = deployments[0];
  if (
    !deployment ||
    deployment.metadata.release !== bundle.serviceHealth.version ||
    deployment.metadata.previousHealthy !== 'true' ||
    Date.parse(deployment.timestamp) > Date.parse(bundle.incident.startedAt)
  )
    return null;

  const targetRelease = deployment.metadata.previousRelease;
  if (!targetRelease?.trim() || targetRelease === bundle.serviceHealth.version) return null;
  // Conflicting records for this promotion must be reconciled before offering a write.
  if (
    deployments.some(
      (event) =>
        (event.metadata.release === deployment.metadata.release ||
          event.timestamp === deployment.timestamp) &&
        (event.metadata.release !== deployment.metadata.release ||
          event.metadata.previousRelease !== targetRelease ||
          event.metadata.previousHealthy !== 'true' ||
          event.metadata.commitSha !== deployment.metadata.commitSha),
    )
  )
    return null;

  // An already failing service cannot establish the required post-deployment onset.
  if (
    evidence.some(
      (event) =>
        failureTypes.has(event.type) &&
        Date.parse(event.timestamp) < Date.parse(deployment.timestamp),
    )
  )
    return null;

  const failures = evidence
    .filter(
      (event) =>
        failureTypes.has(event.type) &&
        event.source !== 'investigator' &&
        isCurrentObservation(event, bundle) &&
        event.metadata.release === bundle.serviceHealth.version &&
        Date.parse(event.timestamp) >= Date.parse(deployment.timestamp),
    )
    .sort(newestFirst);
  const failure = failures[0];
  if (!failure) return null;
  if (
    evidence.some(
      (event) =>
        ['health_check_passed', 'recovery_completed'].includes(event.type) &&
        isCurrentObservation(event, bundle) &&
        Date.parse(event.timestamp) >= Date.parse(failure.timestamp),
    )
  )
    return null;

  return { targetRelease, deployment, failure };
}

/** A rollback target must come from the current deployment, never from model parameters. */
export function getRollbackTarget(bundle: IncidentBundle): string | null {
  return getRollbackEvidence(bundle)?.targetRelease ?? null;
}
