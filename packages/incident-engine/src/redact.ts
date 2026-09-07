import type { EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\b(?:ghp|github_pat)_[A-Za-z0-9_]+\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]'],
  [/(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[REDACTED_SECRET]'],
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
    excerpt: redactText(event.excerpt),
    metadata: Object.fromEntries(
      Object.entries(event.metadata).map(([key, value]) => [key, redactText(value)]),
    ),
  };
}

export function sanitizeBundle(bundle: IncidentBundle): IncidentBundle {
  return {
    ...bundle,
    evidence: bundle.evidence.map(redactEvidence),
  };
}
