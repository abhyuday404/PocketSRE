import { describe, expect, it } from 'vitest';
import type { IncidentBundle } from '@pocketsre/contracts';
import { createDeterministicDiagnosis, redactText, validateDiagnosis } from './index.js';

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
});
