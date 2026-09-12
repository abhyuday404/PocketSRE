import type { Diagnosis, EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(?:set-cookie|cookie|authorization)\s*:\s*[^\r\n]+/gi, '[REDACTED_HEADER]'],
  [
    /(["']?(?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
    '$1[REDACTED]',
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\b(?:ghp|github_pat)_[A-Za-z0-9_]+\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]'],
  [/(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]'],
];

export function redactText(input: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    input,
  );
}

export function redactEvidence(event: EvidenceEvent): EvidenceEvent {
  return {
    ...event,
    title: redactText(event.title),
    excerpt: redactText(event.excerpt),
    // Only public navigation URLs; query strings/fragments can carry credentials.
    externalUrl:
      event.externalUrl && /^https:\/\/[^/@\s]+(?:\/|$)/i.test(event.externalUrl)
        ? event.externalUrl.split(/[?#]/)[0]
        : null,
    metadata: Object.fromEntries(
      Object.entries(event.metadata).map(([key, value]) => [
        key,
        /token|password|secret|authorization|cookie|api[_-]?key|connectionstring/i.test(key)
          ? '[REDACTED]'
          : redactText(value),
      ]),
    ),
  };
}

export function sanitizeBundle(bundle: IncidentBundle): IncidentBundle {
  return {
    ...bundle,
    incident: { ...bundle.incident, title: redactText(bundle.incident.title) },
    serviceHealth: {
      ...bundle.serviceHealth,
      serviceName: redactText(bundle.serviceHealth.serviceName),
    },
    evidence: bundle.evidence.map(redactEvidence),
    ...(bundle.collection
      ? {
          collection: bundle.collection.map((entry) => ({
            ...entry,
            source: redactText(entry.source),
            message: redactText(entry.message),
          })),
        }
      : {}),
  };
}

/** Persist only after validation against the same sanitized incident bundle. */
export function sanitizeDiagnosis(diagnosis: Diagnosis): Diagnosis {
  return {
    ...diagnosis,
    summary: redactText(diagnosis.summary),
    likelyCause: diagnosis.likelyCause === null ? null : redactText(diagnosis.likelyCause),
    nextDiagnosticStep:
      diagnosis.nextDiagnosticStep === null ? null : redactText(diagnosis.nextDiagnosticStep),
    evidenceIds: [...diagnosis.evidenceIds],
    alternativeCauses: diagnosis.alternativeCauses.map((cause) => ({
      ...cause,
      statement: redactText(cause.statement),
      evidenceIds: [...cause.evidenceIds],
    })),
    proposedAction: diagnosis.proposedAction
      ? {
          ...diagnosis.proposedAction,
          reason: redactText(diagnosis.proposedAction.reason),
          risk: redactText(diagnosis.proposedAction.risk),
          evidenceIds: [...diagnosis.proposedAction.evidenceIds],
          parameters: Object.fromEntries(
            Object.entries(diagnosis.proposedAction.parameters).map(([key, value]) => [
              key,
              redactText(value),
            ]),
          ),
        }
      : null,
  };
}
