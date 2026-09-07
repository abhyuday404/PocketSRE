import { describe, expect, it } from 'vitest';
import type { IncidentBundle } from '@pocketsre/contracts';
import {
  createDeterministicDiagnosis,
  redactText,
  validateDiagnosis,
  sanitizeBundle,
  getRollbackTarget,
  mergeInvestigation,
  buildTriagePrompt,
} from './index.js';

const bundle: IncidentBundle = {
  schemaVersion: 1,
  generatedAt: '2026-09-03T10:05:00.000Z',
  incident: {
    id: 'inc-1',
    serviceId: 'checkout-api',
    title: 'Checkout requests are failing',
    severity: 'critical',
    status: 'open',
    startedAt: '2026-09-03T10:02:00.000Z',
    lastUpdatedAt: '2026-09-03T10:05:00.000Z',
  },
  serviceHealth: {
    serviceId: 'checkout-api',
    serviceName: 'Checkout API',
    status: 'degraded',
    version: 'bad-release',
    checkedAt: '2026-09-03T10:05:00.000Z',
    checks: { database: 'failed', api: 'degraded' },
  },
  evidence: [
    {
      id: 'config',
      source: 'github',
      type: 'configuration_changed',
      timestamp: '2026-09-03T10:00:00.000Z',
      title: 'Configuration contract changed',
      excerpt: 'DATABASE_URL was replaced with DB_URL',
      metadata: {},
    },
    {
      id: 'error',
      source: 'sentry',
      type: 'exception',
      timestamp: '2026-09-03T10:03:00.000Z',
      title: 'Database connection failed',
      excerpt: 'DB_URL is undefined',
      metadata: {},
    },
  ],
};

describe('incident engine', () => {
  it('redacts common secret formats', () => {
    expect(redactText('Authorization: Bearer abc.def.ghi token=supersecret')).not.toContain(
      'supersecret',
    );
  });

  it('creates an evidence-backed diagnosis', () => {
    const diagnosis = createDeterministicDiagnosis(bundle);
    expect(diagnosis.confidence).toBe('medium');
    expect(diagnosis.evidenceIds).toEqual(expect.arrayContaining(['config', 'error']));
    expect(validateDiagnosis(diagnosis, bundle).success).toBe(true);
  });

  it('rejects nonexistent evidence references', () => {
    const diagnosis = { ...createDeterministicDiagnosis(bundle), evidenceIds: ['invented'] };
    expect(validateDiagnosis(diagnosis, bundle).success).toBe(false);
  });

  it('does not invent a rollback target without deployment evidence', () => {
    expect(createDeterministicDiagnosis(bundle).proposedAction).toBeNull();
    expect(getRollbackTarget(bundle)).toBeNull();
  });

  it('rejects a plausible-looking but unevidenced rollback', () => {
    const diagnosis = createDeterministicDiagnosis(bundle);
    const candidate = {
      ...diagnosis,
      proposedAction: {
        type: 'TRIGGER_ROLLBACK_WORKFLOW',
        target: 'checkout-api',
        reason: 'Roll back',
        risk: 'In-flight requests',
        reversible: true,
        evidenceIds: ['config'],
        parameters: { targetRelease: 'invented' },
      },
    };
    expect(validateDiagnosis(candidate, bundle).success).toBe(false);
    expect(validateDiagnosis({ ...diagnosis, evidenceIds: [] }, bundle).success).toBe(false);
  });

  it('redacts structured secrets and titles while preserving commit SHAs', () => {
    const sanitized = sanitizeBundle({
      ...bundle,
      evidence: [
        {
          ...bundle.evidence[0]!,
          title: 'Failure for alice@example.com',
          excerpt: '"password": "sensitive value"',
          externalUrl: 'https://example.com/log?token=secret',
          metadata: { authorization: 'Basic abc123', commitSha: 'a'.repeat(40) },
        },
      ],
    });
    expect(JSON.stringify(sanitized)).not.toContain('sensitive value');
    expect(JSON.stringify(sanitized)).not.toContain('alice@example.com');
    expect(sanitized.evidence[0]?.externalUrl).toBe('https://example.com/log');
    expect(sanitized.evidence[0]?.metadata.authorization).toBe('[REDACTED]');
    expect(sanitized.evidence[0]?.metadata.commitSha).toHaveLength(40);
  });

  it('rejects mismatched investigations and imports valid results idempotently', () => {
    const result = {
      schemaVersion: 1,
      incidentId: 'other',
      generatedAt: bundle.generatedAt,
      checks: [
        {
          name: 'configuration',
          status: 'failed',
          summary: 'DB_URL is missing',
          evidenceIds: ['config'],
        },
      ],
    };
    expect(() => mergeInvestigation(bundle, result)).toThrow('another incident');
    result.incidentId = bundle.incident.id;
    const merged = mergeInvestigation(bundle, result);
    expect(merged.evidence).toHaveLength(3);
    expect(mergeInvestigation(merged, result).evidence).toHaveLength(3);
    expect(buildTriagePrompt(bundle)).toContain('DIAGNOSIS_SCHEMA=');
  });
});
