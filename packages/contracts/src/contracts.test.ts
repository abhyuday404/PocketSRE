import { expect, it } from 'vitest';
import { ApprovedActionRequestSchema, IncidentBundleSchema } from './index.js';

const at = '2026-09-12T10:00:00.000Z';
const legacy = {
  schemaVersion: 1,
  generatedAt: at,
  incident: {
    id: 'incident',
    serviceId: 'api',
    title: 'API',
    severity: 'critical',
    status: 'open',
    startedAt: at,
    lastUpdatedAt: at,
  },
  serviceHealth: {
    serviceId: 'api',
    serviceName: 'API',
    status: 'degraded',
    version: 'v1',
    checkedAt: at,
    checks: { api: 'failed' },
  },
  evidence: [],
  collection: [{ source: 'GitHub', status: 'ok', message: 'Collected' }],
};

it('keeps existing v1 bundles valid without requiring new availability fields', () => {
  expect(IncidentBundleSchema.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
});

it('round-trips unknown health, nullable release and timestamped collection evidence in v1', () => {
  const expanded = {
    ...legacy,
    serviceHealth: { ...legacy.serviceHealth, status: 'unknown', version: null, checks: {} },
    evidence: [
      {
        id: 'probe',
        source: 'health',
        type: 'health_check_unavailable',
        timestamp: at,
        title: 'Health unknown',
        excerpt: 'Probe unavailable',
        metadata: {},
      },
      {
        id: 'provider',
        source: 'gateway',
        type: 'collection_failed',
        timestamp: at,
        title: 'Provider unavailable',
        excerpt: 'Collection failed',
        metadata: {},
      },
    ],
    collection: [
      {
        source: 'Health',
        status: 'unavailable',
        message: 'Probe unavailable',
        checkedAt: at,
        evidenceIds: ['probe'],
      },
    ],
  };
  expect(IncidentBundleSchema.parse(JSON.parse(JSON.stringify(expanded)))).toEqual(expanded);
});

it('permits an unknown expected version only for a read-only health check', () => {
  const request = {
    requestId: '2364b31d-943f-4d89-800f-9f70b9dc54b4',
    expectedVersion: null,
    incidentId: 'incident',
    serviceId: 'api',
    target: 'api',
    action: 'RUN_HEALTH_CHECK',
    parameters: {},
    approvedAt: at,
  };
  expect(ApprovedActionRequestSchema.safeParse(request).success).toBe(true);
  for (const action of ['TRIGGER_ROLLBACK_WORKFLOW', 'CREATE_GITHUB_ISSUE'])
    expect(ApprovedActionRequestSchema.safeParse({ ...request, action }).success).toBe(false);
  expect(
    ApprovedActionRequestSchema.safeParse({
      ...request,
      action: 'TRIGGER_ROLLBACK_WORKFLOW',
      expectedVersion: 'v1',
    }).success,
  ).toBe(true);
});
