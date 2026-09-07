import type { IncidentBundle, InvestigationResult } from '@pocketsre/contracts';
import { selectRelevantEvidence } from '@pocketsre/incident-engine';

export function investigate(bundle: IncidentBundle): InvestigationResult {
  const relevant = selectRelevantEvidence(bundle);
  const configSignals = relevant.filter((event) =>
    /DB_URL|DATABASE_URL|environment|configuration/i.test(`${event.title} ${event.excerpt}`),
  );
  const databaseSignals = relevant.filter((event) =>
    /database|connection pool|DB_URL/i.test(`${event.title} ${event.excerpt}`),
  );
  const releaseSignals = relevant.filter(
    (event) => event.metadata.release === bundle.serviceHealth.version,
  );

  return {
    schemaVersion: 1,
    incidentId: bundle.incident.id,
    generatedAt: new Date().toISOString(),
    checks: [
      {
        name: 'configuration-contract-check',
        status: configSignals.length >= 2 ? 'failed' : 'inconclusive',
        summary:
          configSignals.length >= 2
            ? 'Multiple sources indicate that DB_URL and DATABASE_URL no longer agree.'
            : 'No conclusive configuration contract mismatch was found.',
        evidenceIds: configSignals.map((event) => event.id),
      },
      {
        name: 'database-readiness-correlation',
        status: databaseSignals.length >= 2 ? 'failed' : 'inconclusive',
        summary:
          databaseSignals.length >= 2
            ? 'Database readiness failed in the same incident window as the application exception.'
            : 'Database readiness could not be correlated conclusively.',
        evidenceIds: databaseSignals.map((event) => event.id),
      },
      {
        name: 'release-correlation',
        status: releaseSignals.length >= 2 ? 'passed' : 'inconclusive',
        summary:
          releaseSignals.length >= 2
            ? `Evidence consistently points to ${bundle.serviceHealth.version}.`
            : 'Not enough evidence includes the current release identifier.',
        evidenceIds: releaseSignals.map((event) => event.id),
      },
    ],
  };
}
