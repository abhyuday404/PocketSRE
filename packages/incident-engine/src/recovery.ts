import type { IncidentBundle } from '@pocketsre/contracts';

/** A rollback target must come from the current deployment, never from model parameters. */
export function getRollbackTarget(bundle: IncidentBundle): string | null {
  if (bundle.serviceHealth.status === 'healthy' || bundle.incident.status === 'resolved')
    return null;
  const deployment = [...bundle.evidence]
    .filter(
      (event) =>
        event.type === 'deployment_completed' &&
        event.metadata.release === bundle.serviceHealth.version,
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  if (!deployment || deployment.metadata.previousHealthy !== 'true') return null;
  const target = deployment.metadata.previousRelease;
  if (!target || target === bundle.serviceHealth.version) return null;
  const failure = bundle.evidence.some(
    (event) =>
      ['exception', 'health_check_failed', 'database_check_failed'].includes(event.type) &&
      event.timestamp >= deployment.timestamp &&
      event.metadata.release === bundle.serviceHealth.version,
  );
  return failure ? target : null;
}
