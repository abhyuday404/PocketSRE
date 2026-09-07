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
  status: z.enum(['healthy', 'degraded', 'down']),
  version: z.string().min(1),
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

export const ApprovedActionRequestSchema = z.object({
  incidentId: z.string().min(1),
  serviceId: z.string().min(1),
  action: AllowedActionSchema,
  target: z.string().min(1),
  parameters: z.record(z.string(), z.string()).default({}),
  approvedAt: z.string().datetime(),
});
export type ApprovedActionRequest = z.infer<typeof ApprovedActionRequestSchema>;

export const ActionResultSchema = z.object({
  actionId: z.string().min(1),
  status: z.enum(['accepted', 'running', 'succeeded', 'failed']),
  message: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

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
