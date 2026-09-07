import { describe, expect, it } from 'vitest';
import type { IncidentBundle } from '@pocketsre/contracts';
import { investigate } from './investigate.js';

const bundle: IncidentBundle = {
  schemaVersion: 1,
  generatedAt: '2026-09-03T10:05:00.000Z',
  incident: {
    id: 'inc-1',
    serviceId: 'checkout-api',
    title: 'Checkout failed',
    severity: 'critical',
    status: 'open',
    startedAt: '2026-09-03T10:00:00.000Z',
    lastUpdatedAt: '2026-09-03T10:05:00.000Z',
  },
  serviceHealth: {
    serviceId: 'checkout-api',
    serviceName: 'Checkout API',
    status: 'degraded',
    version: 'rel-bad',
    checkedAt: '2026-09-03T10:05:00.000Z',
    checks: { database: 'failed' },
  },
  evidence: [
    {
      id: 'config',
      source: 'github',
      type: 'configuration_changed',
      timestamp: '2026-09-03T10:00:00.000Z',
      title: 'Environment configuration changed',
      excerpt: 'DATABASE_URL was renamed to DB_URL.',
      externalUrl: null,
      metadata: { release: 'rel-bad' },
    },
    {
      id: 'error',
      source: 'sentry',
      type: 'exception',
      timestamp: '2026-09-03T10:02:00.000Z',
      title: 'Database connection failed',
      excerpt: 'DB_URL is undefined.',
      externalUrl: null,
      metadata: { release: 'rel-bad' },
    },
  ],
};

describe('deep investigator', () => {
  it('correlates the configuration mismatch', () => {
    const result = investigate(bundle);
    expect(result.checks[0]?.status).toBe('failed');
    expect(result.checks[0]?.evidenceIds).toEqual(expect.arrayContaining(['config', 'error']));
  });
});
