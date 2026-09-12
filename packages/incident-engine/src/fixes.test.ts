import { describe, expect, it } from 'vitest';
import { FixContextSchema, type FixProposal } from '@pocketsre/contracts';
import { buildFixPrompt, validateFix } from './fixes.js';

const context = FixContextSchema.parse({
  id: 'a888ca81-d043-4e7b-b086-18a47a0ca83c',
  repository: 'owner/service',
  baseBranch: 'main',
  baseCommit: 'a'.repeat(40),
  baseTree: 'b'.repeat(40),
  expiresAt: '2099-01-01T00:00:00.000Z',
  bundle: {
    schemaVersion: 1,
    generatedAt: '2026-09-12T10:00:00.000Z',
    incident: {
      id: 'incident',
      serviceId: 'api',
      title: 'HTTP failures',
      severity: 'critical',
      status: 'open',
      startedAt: '2026-09-12T10:00:00.000Z',
      lastUpdatedAt: '2026-09-12T10:00:00.000Z',
    },
    serviceHealth: {
      serviceId: 'api',
      serviceName: 'API',
      version: 'v2',
      status: 'down',
      checkedAt: '2026-09-12T10:00:00.000Z',
      checks: {},
    },
    evidence: [
      {
        id: 'failure',
        source: 'health',
        type: 'health_check_failed',
        title: 'Port mismatch',
        timestamp: '2026-09-12T10:00:00.000Z',
        excerpt: 'Service listens on 3001; platform expects 3000.',
        metadata: {},
      },
    ],
  },
  files: [
    {
      path: 'src/server.ts',
      sha: 'c'.repeat(40),
      mode: '100755',
      content: 'const port = 3001;\nlisten(port);\n',
    },
  ],
});
const proposal: FixProposal = {
  summary: 'The configured port may explain the failed probe.',
  evidenceIds: ['failure'],
  edits: [
    {
      path: 'src/server.ts',
      before: 'const port = 3001;',
      after: 'const port = 3000;',
      reason: 'Match the platform port.',
      evidenceIds: ['failure'],
    },
  ],
};

describe('bounded fix validation', () => {
  it('applies exact edits and preserves unrelated source and executable mode', () => {
    expect(validateFix(context, proposal).changes).toEqual([
      {
        path: 'src/server.ts',
        mode: '100755',
        before: context.files[0]!.content,
        after: 'const port = 3000;\nlisten(port);\n',
      },
    ]);
  });
  it('rejects invented references on individual edits as well as the summary', () => {
    expect(() => validateFix(context, { ...proposal, evidenceIds: ['invented'] })).toThrow(
      /evidence/,
    );
    expect(() =>
      validateFix(context, {
        ...proposal,
        edits: [{ ...proposal.edits[0], evidenceIds: ['invented'] }],
      }),
    ).toThrow(/evidence/);
  });
  it('rejects ambiguous, missing, unchanged and unauthorized replacements', () => {
    for (const edit of [
      { before: 'missing' },
      { after: proposal.edits[0]!.before },
      { path: '../secret' },
      { path: '.github/workflows/deploy.yml' },
    ])
      expect(() =>
        validateFix(context, { ...proposal, edits: [{ ...proposal.edits[0], ...edit }] }),
      ).toThrow();
    expect(() =>
      validateFix(
        {
          ...context,
          files: [{ ...context.files[0]!, content: 'const port = 3001; const port = 3001;' }],
        },
        proposal,
      ),
    ).toThrow(/exactly one/);
  });
  it('rejects model commands and treats abstention as no publishable fix', () => {
    expect(() => validateFix(context, { ...proposal, command: 'run anything' })).toThrow();
    expect(() => validateFix(context, { ...proposal, edits: [] })).toThrow(/more evidence/);
  });
  it('does not publish credentials or changes that cancel each other', () => {
    expect(() =>
      validateFix(context, {
        ...proposal,
        edits: [{ ...proposal.edits[0], after: 'ghp_examplecredentialvalue' }],
      }),
    ).toThrow(/publish/);
    expect(() =>
      validateFix(context, {
        ...proposal,
        edits: [
          proposal.edits[0],
          { ...proposal.edits[0], before: 'const port = 3000;', after: 'const port = 3001;' },
        ],
      }),
    ).toThrow(/net changes/);
  });
  it('frames source as untrusted and does not claim tests have run', () => {
    const prompt = buildFixPrompt(context);
    expect(prompt).toContain('untrusted data');
    expect(prompt).toContain('Do not claim tests passed');
    expect(prompt).toContain('const port = 3001;');
  });
});
