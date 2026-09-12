import { z } from 'zod';

export const SeveritySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const IncidentStatusSchema = z.enum(['open', 'investigating', 'recovering', 'resolved']);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const EvidenceSourceSchema = z.enum([
  'github',
  'deployment',
  'sentry',
  'health',
  'database',
  'investigator',
  'gateway',
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EventTypeSchema = z.enum([
  'commit',
  'deployment_started',
  'deployment_completed',
  'configuration_changed',
  'exception',
  'error_rate_increased',
  'health_check_failed',
  'health_check_passed',
  'health_check_unavailable',
  'collection_failed',
  'database_check_failed',
  'investigation_result',
  'recovery_completed',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const IncidentSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().min(1),
  title: z.string().min(1),
  severity: SeveritySchema,
  status: IncidentStatusSchema,
  startedAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const EvidenceEventSchema = z.object({
  id: z.string().min(1),
  source: EvidenceSourceSchema,
  type: EventTypeSchema,
  timestamp: z.string().datetime(),
  title: z.string().min(1),
  excerpt: z.string(),
  externalUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

export const ServiceHealthSchema = z.object({
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  status: z.enum(['healthy', 'degraded', 'down', 'unknown']),
  // Null means this observation did not establish a current release.
  version: z.string().min(1).nullable(),
  checkedAt: z.string().datetime(),
  checks: z.record(z.string(), z.enum(['healthy', 'degraded', 'failed'])),
});
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

export const IncidentBundleSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  incident: IncidentSchema,
  serviceHealth: ServiceHealthSchema,
  evidence: z.array(EvidenceEventSchema),
  collection: z
    .array(
      z.object({
        source: z.string(),
        status: z.enum(['ok', 'unavailable']),
        message: z.string(),
        checkedAt: z.string().datetime().optional(),
        evidenceIds: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export type IncidentBundle = z.infer<typeof IncidentBundleSchema>;

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const HypothesisSchema = z.object({
  statement: z.string().min(1),
  confidence: ConfidenceSchema,
  evidenceIds: z.array(z.string()),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const AllowedActionSchema = z.enum([
  'RUN_HEALTH_CHECK',
  'TRIGGER_ROLLBACK_WORKFLOW',
  'CREATE_GITHUB_ISSUE',
  'CREATE_GITHUB_PULL_REQUEST',
]);
export type AllowedAction = z.infer<typeof AllowedActionSchema>;

export const ActionProposalSchema = z.object({
  type: AllowedActionSchema,
  target: z.string().min(1),
  reason: z.string().min(1),
  risk: z.string().min(1),
  reversible: z.boolean(),
  evidenceIds: z.array(z.string()),
  parameters: z.record(z.string(), z.string()).default({}),
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const DiagnosisSchema = z.object({
  mode: z.enum(['on-device-llm', 'organizer-runtime', 'deterministic']),
  summary: z.string().min(1),
  likelyCause: z.string().nullable(),
  confidence: ConfidenceSchema,
  evidenceIds: z.array(z.string()),
  alternativeCauses: z.array(HypothesisSchema),
  nextDiagnosticStep: z.string().nullable(),
  proposedAction: ActionProposalSchema.nullable(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export const diagnosisJsonSchema = z.toJSONSchema(DiagnosisSchema);

export const ApprovedActionRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.string().min(1).nullable(),
    incidentId: z.string().min(1),
    serviceId: z.string().min(1),
    action: AllowedActionSchema,
    target: z.string().min(1),
    parameters: z.record(z.string(), z.string()).default({}),
    approvedAt: z.string().datetime(),
  })
  .refine((request) => request.action === 'RUN_HEALTH_CHECK' || request.expectedVersion !== null, {
    message: 'A mutating action requires a known current release.',
    path: ['expectedVersion'],
  });
export type ApprovedActionRequest = z.infer<typeof ApprovedActionRequestSchema>;

export const ActionResultSchema = z.object({
  actionId: z.string().min(1),
  status: z.enum(['accepted', 'running', 'succeeded', 'failed']),
  message: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  pullRequestUrl: z
    .string()
    .regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/)
    .optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const AuditEntrySchema = z.object({
  requestId: z.string(),
  incidentId: z.string(),
  serviceId: z.string(),
  action: AllowedActionSchema,
  targetRelease: z.string().nullable(),
  result: ActionResultSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const InvestigationResultSchema = z.object({
  schemaVersion: z.literal(1),
  incidentId: z.string().min(1),
  generatedAt: z.string().datetime(),
  checks: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(['passed', 'failed', 'inconclusive']),
      summary: z.string().min(1),
      evidenceIds: z.array(z.string()),
    }),
  ),
});
export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;

export const RepositoryPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      /^[A-Za-z0-9_./-]+$/.test(path) &&
      path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Use a relative repository file path.',
  );
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const citations = z.array(z.string().min(1)).min(1).max(20);
export const FixProposalSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    evidenceIds: citations,
    edits: z
      .array(
        z
          .object({
            path: RepositoryPathSchema,
            before: z.string().min(1).max(6000),
            after: z.string().max(6000),
            reason: z.string().min(1).max(600),
            evidenceIds: citations,
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type FixProposal = z.infer<typeof FixProposalSchema>;
export const fixProposalJsonSchema = z.toJSONSchema(FixProposalSchema);
export const FixContextSchema = z.object({
  id: z.string().uuid(),
  repository: z.string(),
  baseBranch: z.string(),
  baseCommit: sha,
  baseTree: sha,
  expiresAt: z.string().datetime(),
  bundle: IncidentBundleSchema,
  files: z
    .array(
      z.object({
        path: RepositoryPathSchema,
        sha,
        mode: z.enum(['100644', '100755']),
        content: z.string().max(12000),
      }),
    )
    .min(1)
    .max(3),
});
export type FixContext = z.infer<typeof FixContextSchema>;
export const FixDraftSchema = z.object({
  id: z.string().uuid(),
  contextId: z.string().uuid(),
  repository: z.string(),
  baseBranch: z.string(),
  baseCommit: sha,
  expiresAt: z.string().datetime(),
  proposal: FixProposalSchema,
  changes: z
    .array(
      z.object({
        path: RepositoryPathSchema,
        before: z.string(),
        after: z.string(),
        mode: z.enum(['100644', '100755']),
      }),
    )
    .min(1)
    .max(3),
});
export type FixDraft = z.infer<typeof FixDraftSchema>;
export const FixConfigSchema = z.object({
  enabled: z.boolean(),
  repository: z.string().nullable(),
  paths: z.array(RepositoryPathSchema),
});
