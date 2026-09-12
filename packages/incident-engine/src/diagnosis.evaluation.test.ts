import { describe, expect, it } from 'vitest';
import type { Diagnosis, EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';
import {
  buildTriagePrompt,
  createDeterministicDiagnosis,
  getRollbackTarget,
  sanitizeBundle,
  sanitizeDiagnosis,
  selectRelevantEvidence,
  validateDiagnosis,
} from './index.js';

function fixture(): IncidentBundle {
  const event = (
    id: string,
    type: EvidenceEvent['type'],
    source: EvidenceEvent['source'],
    time: string,
    excerpt: string,
  ): EvidenceEvent => ({
    id,
    type,
    source,
    timestamp: `2026-09-03T${time}:00.000Z`,
    title: id,
    excerpt,
    metadata: { release: 'current', serviceId: 'orders' },
  });
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-03T10:05:00.000Z',
    incident: {
      id: 'incident',
      serviceId: 'orders',
      title: 'Requests failing',
      severity: 'critical',
      status: 'open',
      startedAt: '2026-09-03T10:02:00.000Z',
      lastUpdatedAt: '2026-09-03T10:05:00.000Z',
    },
    serviceHealth: {
      serviceId: 'orders',
      serviceName: 'Orders',
      status: 'degraded',
      version: 'current',
      checkedAt: '2026-09-03T10:05:00.000Z',
      checks: { api: 'degraded', database: 'failed' },
    },
    evidence: [
      {
        ...event(
          'config',
          'configuration_changed',
          'github',
          '10:00',
          'DATABASE_URL was replaced with DB_URL',
        ),
        metadata: { commitSha: 'abc' },
      },
      {
        ...event('deploy', 'deployment_completed', 'deployment', '10:01', 'Promoted current'),
        metadata: {
          release: 'current',
          commitSha: 'abc',
          previousHealthy: 'true',
          previousRelease: 'previous',
        },
      },
      event(
        'error',
        'exception',
        'sentry',
        '10:02',
        'ConfigurationError: DB_URL is undefined at src/database.ts:14.',
      ),
      event('health', 'health_check_failed', 'health', '10:05', 'Database readiness is failing.'),
    ],
  };
}

function change(bundle: IncidentBundle, id: string, patch: Partial<EvidenceEvent>) {
  Object.assign(
    bundle.evidence.find((event) => event.id === id)!,
    patch,
  );
}

function checkReferences(diagnosis: Diagnosis, bundle: IncidentBundle) {
  const ids = new Set(bundle.evidence.map((event) => event.id));
  const groups = [
    diagnosis.evidenceIds,
    ...diagnosis.alternativeCauses.map((cause) => cause.evidenceIds),
  ];
  if (diagnosis.proposedAction) groups.push(diagnosis.proposedAction.evidenceIds);
  for (const cited of groups) for (const id of cited) expect(ids.has(id)).toBe(true);
  if (diagnosis.likelyCause) expect(diagnosis.evidenceIds.length).toBeGreaterThan(0);
  if (diagnosis.proposedAction)
    expect(diagnosis.proposedAction.evidenceIds.length).toBeGreaterThan(0);
  expect(validateDiagnosis(diagnosis, bundle).success).toBe(true);
  expect(validateDiagnosis({ ...diagnosis, mode: 'on-device-llm' }, bundle).success).toBe(true);
}

const abstentionCases: Array<{
  name: string;
  edit: (bundle: IncidentBundle) => void;
  summary?: string;
}> = [
  {
    name: 'unrelated configuration and authentication exception',
    edit: (bundle) => {
      change(bundle, 'config', { excerpt: 'AUTH_ISSUER was replaced with AUTH_DOMAIN' });
      change(bundle, 'error', { excerpt: 'AuthenticationError: Invalid OAuth audience.' });
    },
  },
  {
    name: 'cache timeout with generic environment configuration',
    edit: (bundle) => {
      change(bundle, 'config', { excerpt: 'Changed the environment cache timeout.' });
      change(bundle, 'error', { excerpt: 'Redis connection timed out.' });
    },
  },
  {
    name: 'application exception despite a database configuration change',
    edit: (bundle) => {
      change(bundle, 'error', { excerpt: 'TypeError: Cannot read properties of undefined.' });
    },
  },
  {
    name: 'mismatching database variable',
    edit: (bundle) => {
      change(bundle, 'error', { excerpt: 'DATABASE_URL is undefined' });
    },
  },
  {
    name: 'case-sensitive database variable identity',
    edit: (bundle) => {
      change(bundle, 'config', { excerpt: 'database_url was replaced with db_url' });
    },
  },
  {
    name: 'negated missing variable',
    edit: (bundle) => {
      change(bundle, 'error', { excerpt: 'DB_URL is not missing. Authentication failed.' });
    },
  },
  {
    name: 'hypothetical missing variable',
    edit: (bundle) => {
      change(bundle, 'error', { excerpt: 'If DB_URL is undefined, configuration would fail.' });
    },
  },
  {
    name: 'configuration documentation mentioning a rename',
    edit: (bundle) => {
      change(bundle, 'config', {
        excerpt: 'The guide explains how DATABASE_URL was replaced with DB_URL in another project.',
      });
    },
  },
  {
    name: 'configuration diff with only an example comment',
    edit: (bundle) => {
      change(bundle, 'config', {
        excerpt: '-// process.env.DATABASE_URL example\n+// process.env.DB_URL example',
      });
    },
  },
  {
    name: 'configuration diff with only quoted environment examples',
    edit: (bundle) => {
      change(bundle, 'config', {
        excerpt: '-const guide = "process.env.DATABASE_URL";\n+const guide = "process.env.DB_URL";',
      });
    },
  },
  {
    name: 'unknown health without an observed release',
    edit: (bundle) => {
      bundle.serviceHealth = {
        ...bundle.serviceHealth,
        status: 'unknown',
        version: null,
        checks: {},
      } as unknown as IncidentBundle['serviceHealth'];
    },
  },
  {
    name: 'collector failure alone',
    edit: (bundle) => {
      bundle.evidence = [
        {
          ...bundle.evidence[3]!,
          type: 'health_check_unavailable',
          source: 'gateway',
          excerpt: 'Health collection timed out.',
          metadata: {},
        } as unknown as EvidenceEvent,
      ];
      bundle.serviceHealth = {
        ...bundle.serviceHealth,
        status: 'unknown',
        version: null,
        checks: {},
      } as unknown as IncidentBundle['serviceHealth'];
    },
  },
  {
    name: 'independent database outage',
    summary: 'database check failed',
    edit: (bundle) => {
      bundle.evidence = bundle.evidence.filter((event) => !['config', 'deploy'].includes(event.id));
      change(bundle, 'error', { excerpt: 'Database connection refused: ECONNREFUSED.' });
      change(bundle, 'health', {
        type: 'database_check_failed',
        source: 'database',
        excerpt: 'Database endpoint is unavailable independently of the application.',
      });
    },
  },
  {
    name: 'no evidence',
    edit: (bundle) => {
      bundle.evidence = [];
    },
  },
  {
    name: 'health observation alone',
    edit: (bundle) => {
      bundle.evidence = bundle.evidence.filter((event) => event.id === 'health');
    },
  },
  {
    name: 'wrong service',
    summary: 'outside',
    edit: (bundle) => {
      bundle.evidence.forEach((event) => {
        event.metadata.serviceId = 'unrelated-service';
      });
    },
  },
  {
    name: 'stale events',
    summary: 'outside',
    edit: (bundle) => {
      bundle.evidence.forEach((event) => {
        event.timestamp = '2026-09-02T10:00:00.000Z';
      });
    },
  },
  {
    name: 'stale health snapshot',
    summary: 'Fresh observations',
    edit: (bundle) => {
      bundle.serviceHealth.checkedAt = '2026-09-03T09:00:00.000Z';
    },
  },
  {
    name: 'future configuration',
    edit: (bundle) => {
      change(bundle, 'config', { timestamp: '2026-09-03T11:00:00.000Z' });
    },
  },
  {
    name: 'configuration after exception',
    summary: 'conflicts',
    edit: (bundle) => {
      change(bundle, 'config', { timestamp: '2026-09-03T10:03:00.000Z' });
    },
  },
  {
    name: 'configuration from another release',
    summary: 'conflicts',
    edit: (bundle) => {
      change(bundle, 'config', { metadata: { release: 'unrelated', commitSha: 'abc' } });
    },
  },
  {
    name: 'configuration from another commit',
    summary: 'conflicts',
    edit: (bundle) => {
      change(bundle, 'config', { metadata: { commitSha: 'unrelated' } });
    },
  },
  {
    name: 'exception from another release',
    edit: (bundle) => {
      change(bundle, 'error', { metadata: { release: 'previous' } });
    },
  },
  {
    name: 'incident predates deployment',
    summary: 'timeline',
    edit: (bundle) => {
      bundle.incident.startedAt = '2026-09-03T09:59:00.000Z';
    },
  },
  {
    name: 'failure predates deployment',
    summary: 'timeline',
    edit: (bundle) => {
      change(bundle, 'error', { timestamp: '2026-09-03T10:00:00.000Z' });
    },
  },
  {
    name: 'newer deployment contradicts snapshot release',
    summary: 'timeline',
    edit: (bundle) => {
      bundle.evidence.push({
        ...bundle.evidence[1]!,
        id: 'new-deploy',
        timestamp: '2026-09-03T10:04:00.000Z',
        metadata: { release: 'new-release' },
      });
    },
  },
  {
    name: 'conflicting previous healthy releases',
    summary: 'timeline',
    edit: (bundle) => {
      bundle.evidence.push({
        ...bundle.evidence[1]!,
        id: 'conflicting-deploy',
        metadata: { ...bundle.evidence[1]!.metadata, previousRelease: 'other' },
      });
    },
  },
  {
    name: 'database check reports healthy',
    summary: 'conflicts',
    edit: (bundle) => {
      bundle.serviceHealth.checks.database = 'healthy';
    },
  },
  {
    name: 'resolved incident with failing snapshot',
    summary: 'inconsistent',
    edit: (bundle) => {
      bundle.incident.status = 'resolved';
    },
  },
  {
    name: 'health collection unavailable',
    summary: 'unavailable',
    edit: (bundle) => {
      bundle.collection = [
        { source: 'Health', status: 'unavailable', message: 'Could not collect current health.' },
      ];
    },
  },
  {
    name: 'derived investigation without direct exception',
    edit: (bundle) => {
      change(bundle, 'error', {
        type: 'investigation_result',
        source: 'investigator',
        metadata: { evidenceIds: 'config' },
      });
    },
  },
  {
    name: 'ambiguous exception ID',
    edit: (bundle) => {
      bundle.evidence.push({
        ...bundle.evidence[2]!,
        excerpt: 'A different event using the same ID.',
      });
    },
  },
];

describe('diagnosis evaluation: conservative deterministic rules', () => {
  it('preserves the controlled configuration demo and the verified rollback path', () => {
    const bundle = fixture();
    const diagnosis = createDeterministicDiagnosis(bundle);
    checkReferences(diagnosis, bundle);
    expect(diagnosis.likelyCause).toContain('DB_URL');
    expect(diagnosis.confidence).toBe('medium');
    expect(diagnosis.evidenceIds).toEqual(expect.arrayContaining(['config', 'error']));
    expect(diagnosis.proposedAction?.parameters).toEqual({ targetRelease: 'previous' });
    expect(diagnosis.proposedAction?.evidenceIds).toEqual(
      expect.arrayContaining(['config', 'error', 'deploy', 'health']),
    );
    expect(getRollbackTarget(bundle)).toBe('previous');
  });

  it.each(abstentionCases)('$name', ({ edit, summary }) => {
    const bundle = fixture();
    edit(bundle);
    const diagnosis = createDeterministicDiagnosis(bundle);
    checkReferences(diagnosis, bundle);
    expect(diagnosis.likelyCause).toBeNull();
    expect(diagnosis.confidence).toBe('low');
    expect(diagnosis.alternativeCauses).toEqual([]);
    expect(diagnosis.proposedAction?.type).not.toBe('TRIGGER_ROLLBACK_WORKFLOW');
    if (summary) expect(diagnosis.summary).toContain(summary);
  });

  it('requires a release/commit link before suggesting a rollback', () => {
    const bundle = fixture();
    change(bundle, 'config', { metadata: {} });
    expect(createDeterministicDiagnosis(bundle).likelyCause).not.toBeNull();
    expect(createDeterministicDiagnosis(bundle).proposedAction).toBeNull();
  });

  it('recognizes the controlled diff form and does not depend on the bundle wall-clock age', () => {
    const bundle = fixture();
    change(bundle, 'config', {
      excerpt: '-const url = process.env.DATABASE_URL;\n+const url = process.env.DB_URL;',
    });
    const first = createDeterministicDiagnosis(bundle);
    expect(first.likelyCause).toContain('DB_URL');
    expect(first.proposedAction?.type).toBe('TRIGGER_ROLLBACK_WORKFLOW');
    const shifted = fixture();
    for (const event of shifted.evidence)
      event.timestamp = event.timestamp.replace('2026-', '2020-');
    shifted.generatedAt = shifted.generatedAt.replace('2026-', '2020-');
    shifted.incident.startedAt = shifted.incident.startedAt.replace('2026-', '2020-');
    shifted.incident.lastUpdatedAt = shifted.incident.lastUpdatedAt.replace('2026-', '2020-');
    shifted.serviceHealth.checkedAt = shifted.serviceHealth.checkedAt.replace('2026-', '2020-');
    expect(createDeterministicDiagnosis(shifted)).toEqual(createDeterministicDiagnosis(fixture()));
  });

  it('recognizes recovery while retaining the original failure history', () => {
    const bundle = fixture();
    bundle.generatedAt = '2026-09-03T10:06:00.000Z';
    bundle.serviceHealth = {
      ...bundle.serviceHealth,
      status: 'healthy',
      version: 'previous',
      checkedAt: bundle.generatedAt,
      checks: { api: 'healthy', database: 'healthy' },
    };
    bundle.incident.status = 'resolved';
    bundle.evidence.push({
      ...bundle.evidence[3]!,
      id: 'recovered',
      timestamp: bundle.generatedAt,
      type: 'recovery_completed',
      source: 'health',
      excerpt: 'API and database passed.',
      metadata: { release: 'previous' },
    });
    const diagnosis = createDeterministicDiagnosis(bundle);
    checkReferences(diagnosis, bundle);
    expect(diagnosis.summary).toContain('agrees with the healthy snapshot');
    expect(diagnosis.evidenceIds).toEqual(['recovered']);
    expect(diagnosis.likelyCause).toBeNull();
    expect(diagnosis.proposedAction).toBeNull();
    expect(getRollbackTarget(bundle)).toBeNull();
    const oldDiagnosis = createDeterministicDiagnosis(fixture());
    expect(validateDiagnosis({ ...oldDiagnosis, proposedAction: null }, bundle).success).toBe(
      false,
    );
  });

  it('does not treat a recovery event conflicting with failed health as proof of recovery', () => {
    const bundle = fixture();
    bundle.evidence.push({ ...bundle.evidence[3]!, id: 'recovery', type: 'recovery_completed' });
    const diagnosis = createDeterministicDiagnosis(bundle);
    checkReferences(diagnosis, bundle);
    expect(diagnosis.summary).toContain('conflict');
    expect(diagnosis.likelyCause).toBeNull();
    expect(getRollbackTarget(bundle)).toBeNull();
  });
});

describe('diagnosis evaluation: reference and action boundaries', () => {
  it('accepts paraphrases while reporting that causal correctness has not been verified', () => {
    const bundle = fixture();
    const candidate: Diagnosis = {
      ...createDeterministicDiagnosis(bundle),
      mode: 'on-device-llm',
      summary:
        'The renamed database setting and initialization error suggest an environment mismatch.',
      likelyCause: 'The deployed environment may still supply the old setting name.',
      nextDiagnosticStep: 'Inspect the release environment variable names.',
    };
    candidate.proposedAction!.reason =
      'Try the prior healthy release after reviewing the linked change and deployment failures.';
    const result = validateDiagnosis(candidate, bundle);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.validation).toEqual({ references: 'validated', causality: 'not-verified' });
  });

  it('accepts a new read-only hypothesis supported structurally by current failures', () => {
    const bundle = fixture();
    bundle.evidence = bundle.evidence.filter((event) => event.id === 'error');
    change(bundle, 'error', { excerpt: 'AuthenticationError: JWT audience mismatch.' });
    const candidate: Diagnosis = {
      ...createDeterministicDiagnosis(bundle),
      mode: 'on-device-llm',
      summary: 'Requests are failing authentication.',
      likelyCause: 'The token audience may differ from the expected audience.',
      nextDiagnosticStep: 'Compare the configured audience with the failing request metadata.',
    };
    expect(candidate.confidence).toBe('low');
    expect(candidate.proposedAction?.type).toBe('RUN_HEALTH_CHECK');
    expect(validateDiagnosis(candidate, bundle).success).toBe(true);
    expect(validateDiagnosis({ ...candidate, confidence: 'medium' }, bundle).success).toBe(false);
  });

  it.each(['summary', 'alternative', 'action'] as const)(
    'rejects invented references in %s',
    (location) => {
      const bundle = fixture();
      const diagnosis = createDeterministicDiagnosis(bundle);
      if (location === 'summary') diagnosis.evidenceIds = ['invented'];
      if (location === 'alternative')
        diagnosis.alternativeCauses = [
          { statement: 'Another hypothesis', confidence: 'low', evidenceIds: ['invented'] },
        ];
      if (location === 'action') diagnosis.proposedAction!.evidenceIds = ['invented'];
      expect(validateDiagnosis(diagnosis, bundle).success).toBe(false);
    },
  );

  it('rejects hypotheses citing only unrelated or derived events, and high confidence from source counts', () => {
    const bundle = fixture();
    bundle.evidence.push({
      ...bundle.evidence[2]!,
      id: 'derived',
      type: 'investigation_result',
      source: 'investigator',
      metadata: { evidenceIds: 'error' },
    });
    const diagnosis = createDeterministicDiagnosis(bundle);
    for (const evidenceIds of [[], ['config'], ['derived']]) {
      expect(validateDiagnosis({ ...diagnosis, evidenceIds }, bundle).success).toBe(false);
    }
    expect(
      validateDiagnosis(
        { ...diagnosis, confidence: 'high', evidenceIds: ['error', 'config', 'derived'] },
        bundle,
      ).success,
    ).toBe(false);
  });

  it.each(
    abstentionCases.filter((entry) =>
      ['timeline', 'conflicts', 'inconsistent', 'unavailable', 'Fresh observations'].includes(
        entry.summary ?? '',
      ),
    ),
  )('rejects active model causes for $name', ({ edit }) => {
    const bundle = fixture();
    const candidate = createDeterministicDiagnosis(bundle);
    edit(bundle);
    expect(
      validateDiagnosis({ ...candidate, mode: 'on-device-llm', proposedAction: null }, bundle)
        .success,
    ).toBe(false);
  });

  it('rejects unsupported, incorrectly targeted, uncited and parameter-injected actions', () => {
    const bundle = fixture();
    const diagnosis = createDeterministicDiagnosis(bundle);
    const action = diagnosis.proposedAction!;
    for (const patch of [
      { type: 'RUN_SHELL_COMMAND' },
      { type: 'CREATE_GITHUB_ISSUE', parameters: {} },
      { target: 'another-service' },
      { evidenceIds: [] },
      { evidenceIds: ['config'] },
      { parameters: { targetRelease: 'invented' } },
      { parameters: { targetRelease: 'previous', command: 'anything' } },
      { type: 'RUN_HEALTH_CHECK', evidenceIds: [], parameters: {} },
      { type: 'RUN_HEALTH_CHECK', parameters: { url: 'https://unapproved.example' } },
    ])
      expect(
        validateDiagnosis({ ...diagnosis, proposedAction: { ...action, ...patch } }, bundle)
          .success,
      ).toBe(false);
    bundle.evidence = bundle.evidence.filter((event) => event.id !== 'deploy');
    expect(validateDiagnosis(diagnosis, bundle).success).toBe(false);
  });
});

describe('diagnosis evaluation: ranking, prompts and portable sanitization', () => {
  it('ranks equally structured database and authentication evidence equally', () => {
    const bundle = fixture();
    const error = bundle.evidence[2]!;
    bundle.evidence = [
      {
        ...error,
        id: 'b',
        title: 'checkout database DB_URL configuration connection critical 500',
      },
      { ...error, id: 'a', title: 'Authentication audience mismatch', excerpt: 'JWT rejected' },
    ];
    expect(selectRelevantEvidence(bundle).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('retains changes and counterevidence under a noisy exception stream', () => {
    const bundle = fixture();
    bundle.evidence.push({ ...bundle.evidence[3]!, id: 'recovery', type: 'recovery_completed' });
    for (let index = 0; index < 20; index++)
      bundle.evidence.push({ ...bundle.evidence[2]!, id: `noise-${index}` });
    const ranked = selectRelevantEvidence(bundle);
    expect(ranked).toHaveLength(10);
    expect(ranked.map((event) => event.id)).toEqual(
      expect.arrayContaining(['config', 'deploy', 'health', 'recovery']),
    );
    expect(createDeterministicDiagnosis(bundle).likelyCause).toBeNull();
    const prompt = buildTriagePrompt(bundle);
    const supplied = JSON.parse(prompt.split('INCIDENT_BUNDLE=')[1]!) as IncidentBundle;
    const assessment = JSON.parse(
      prompt.split('RULE_ASSESSMENT=')[1]!.split('\n')[0]!,
    ) as Diagnosis;
    const suppliedIds = supplied.evidence.map((event) => event.id);
    for (const id of assessment.evidenceIds) expect(suppliedIds).toContain(id);
    expect(prompt).toContain('not citation validity');
  });

  it('redacts persisted diagnosis and collection text without changing citation IDs or the input', () => {
    const bundle = fixture();
    bundle.collection = [
      {
        source: 'Health alice@example.com',
        status: 'unavailable',
        message: 'Authorization: Bearer sensitive',
      },
    ];
    const diagnosis = createDeterministicDiagnosis(fixture());
    diagnosis.summary = 'password=secret-value';
    diagnosis.likelyCause = 'alice@example.com';
    diagnosis.nextDiagnosticStep = 'token=hidden';
    diagnosis.alternativeCauses = [
      { statement: 'Bearer tokenvalue', confidence: 'low', evidenceIds: ['error'] },
    ];
    diagnosis.proposedAction!.reason = 'api_key=secret-value';
    diagnosis.proposedAction!.risk = 'password=secret-value';
    diagnosis.proposedAction!.parameters.targetRelease = 'secret=secret-value';
    const sanitized = sanitizeDiagnosis(diagnosis);
    expect(JSON.stringify(sanitized)).not.toMatch(
      /secret-value|alice@example.com|tokenvalue|hidden/,
    );
    expect(sanitized.evidenceIds).toEqual(diagnosis.evidenceIds);
    expect(sanitized.proposedAction?.evidenceIds).toEqual(diagnosis.proposedAction?.evidenceIds);
    expect(diagnosis.summary).toContain('secret-value');
    expect(JSON.stringify(sanitizeBundle(bundle).collection)).not.toMatch(
      /alice@example.com|sensitive/,
    );
    const safeBundle = sanitizeBundle(fixture());
    expect(
      validateDiagnosis(sanitizeDiagnosis(createDeterministicDiagnosis(safeBundle)), safeBundle)
        .success,
    ).toBe(true);
  });
});
