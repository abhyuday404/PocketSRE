import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FixContextSchema,
  AgentTaskSchema,
  FixProposalSchema,
  type FixContext,
  type FixDraft,
  type IncidentBundle,
  type AuditEntry,
} from '@pocketsre/contracts';
import { containsCredential, validateFix } from '@pocketsre/incident-engine';
import type { AuditStore } from './audit.js';
import type { FixRepository } from './github-fixes.js';

export function registerFixRoutes(
  app: FastifyInstance,
  options: {
    repository?: FixRepository;
    loadBundle: () => Promise<IncidentBundle>;
    audit: AuditStore;
    claim: () => boolean;
    release: () => void;
  },
) {
  const contexts = new Map<string, FixContext>();
  const drafts = new Map<string, { context: FixContext; draft: FixDraft; consumed: boolean }>();
  const fail = (message: string, statusCode = 409) =>
    Object.assign(new Error(message), { statusCode });
  function repository() {
    if (!options.repository) throw fail('GitHub fixes are not configured on this gateway.', 403);
    return options.repository;
  }
  function expire() {
    for (const [id, context] of contexts)
      if (Date.parse(context.expiresAt) < Date.now()) contexts.delete(id);
    for (const [id, value] of drafts)
      if (Date.parse(value.draft.expiresAt) < Date.now()) drafts.delete(id);
  }
  async function current(context: FixContext) {
    if (Date.parse(context.expiresAt) < Date.now())
      throw fail('This source snapshot expired. Generate a new fix.');
    // Feature requests depend on this immutable source/request snapshot, not outage state.
    // The repository head is still checked immediately before every publication.
    if (context.task) return new Set(context.bundle.evidence.map((event) => event.id));
    const bundle = await options.loadBundle();
    if (
      bundle.incident.id !== context.bundle.incident.id ||
      bundle.incident.serviceId !== context.bundle.incident.serviceId ||
      bundle.serviceHealth.version !== context.bundle.serviceHealth.version
    )
      throw fail('The incident or release changed. Generate a new fix.');
    const ids = new Set(bundle.evidence.map((event) => event.id));
    return ids;
  }
  app.get('/v1/fixes/config', async () => ({
    enabled: !!options.repository,
    repository: options.repository?.repository ?? null,
    paths: options.repository?.paths ?? [],
  }));
  app.post('/v1/fixes/context', async (request) => {
    const repo = repository();
    const input = z
      .object({
        incidentId: z.string(),
        paths: z.array(z.string()).min(1).max(3),
        task: AgentTaskSchema.optional(),
      })
      .strict()
      .parse(request.body);
    expire();
    if (contexts.size >= 20)
      throw fail('Too many source snapshots. Wait for older snapshots to expire.');
    const bundle = await options.loadBundle();
    if (!input.task && input.incidentId !== bundle.incident.id)
      throw fail('Refresh the incident before reading source.');
    if (input.task && containsCredential(JSON.stringify(input.task)))
      throw fail('Remove credentials from the request and conversation.', 400);
    const source = await repo.readSource(input.paths);
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const taskBundle: IncidentBundle = input.task
      ? {
          ...bundle,
          evidence: [
            {
              id: `agent:${id}:request`,
              source: 'investigator',
              type: 'investigation_result',
              timestamp,
              title: 'User requested repository task',
              excerpt: input.task.request,
              metadata: { contextId: id },
            },
            ...source.files.map((file, index) => ({
              id: `agent:${id}:source:${index}`,
              source: 'github' as const,
              type: 'investigation_result' as const,
              timestamp,
              title: `Source snapshot: ${file.path}`,
              excerpt: `Read ${file.path} at commit ${source.baseCommit}; blob ${file.sha}.`,
              metadata: {
                contextId: id,
                path: file.path,
                commit: source.baseCommit,
                blob: file.sha,
              },
            })),
          ],
        }
      : bundle;
    const context = FixContextSchema.parse({
      ...source,
      id,
      repository: repo.repository,
      bundle: taskBundle,
      task: input.task,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    contexts.set(context.id, context);
    return context;
  });
  app.post('/v1/fixes/prepare', { bodyLimit: 65536 }, async (request) => {
    repository();
    const input = z
      .object({ contextId: z.string().uuid(), proposal: FixProposalSchema })
      .strict()
      .parse(request.body);
    expire();
    const context = contexts.get(input.contextId);
    if (!context) throw fail('Source snapshot expired. Read source again.');
    if (drafts.size >= 20) throw fail('Too many pending fixes. Wait for older drafts to expire.');
    await current(context);
    const draft: FixDraft = {
      id: randomUUID(),
      contextId: context.id,
      repository: context.repository,
      baseBranch: context.baseBranch,
      baseCommit: context.baseCommit,
      expiresAt: context.expiresAt,
      ...validateFix(context, input.proposal),
    };
    drafts.set(draft.id, { draft, context, consumed: false });
    return draft;
  });
  app.post('/v1/fixes/execute', async (request, reply) => {
    const repo = repository();
    const input = z
      .object({
        draftId: z.string().uuid(),
        requestId: z.string().uuid(),
        approvedAt: z.string().datetime(),
      })
      .strict()
      .parse(request.body);
    const fingerprint = JSON.stringify({ kind: 'github-fix', ...input });
    const existing = options.audit.get(input.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw fail('Approval ID is already used for a different action.');
      return reply.code(202).send(existing.entry.result);
    }
    const pending = drafts.get(input.draftId);
    if (!pending || pending.consumed)
      throw fail('This draft is expired or was already submitted. Check action history.');
    const age = Date.now() - Date.parse(input.approvedAt);
    if (age > 120000 || age < -5000) throw fail('Approval expired. Review the draft again.');
    if (!options.claim()) throw fail('Another action is in progress.');
    try {
      const ids = await current(pending.context);
      if (
        [
          ...pending.draft.proposal.evidenceIds,
          ...pending.draft.proposal.edits.flatMap((edit) => edit.evidenceIds),
        ].some((id) => !ids.has(id))
      )
        throw fail('The cited evidence changed. Generate a new fix.');
      await repo.assertHead(pending.context);
      const entry: AuditEntry = {
        requestId: input.requestId,
        incidentId: pending.context.bundle.incident.id,
        serviceId: pending.context.bundle.incident.serviceId,
        action: 'CREATE_GITHUB_PULL_REQUEST',
        targetRelease: pending.context.baseCommit,
        result: {
          actionId: randomUUID(),
          status: 'running',
          message: `Creating a draft PR in ${repo.repository}.`,
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
      };
      // Persist before provider writes. A lost response never authorizes another publication.
      pending.consumed = true;
      await options.audit.save(entry, fingerprint);
      try {
        entry.result.pullRequestUrl = await repo.publish(pending.context, pending.draft);
        entry.result.status = 'succeeded';
        entry.result.message =
          'Draft pull request created. Tests, merge, and deployment remain pending.';
      } catch {
        entry.result.status = 'failed';
        entry.result.message = `GitHub outcome is unverified. Check ${repo.repository} for branch pocketsre/fix-${pending.draft.id} and its PR before trying again.`;
      }
      entry.result.completedAt = new Date().toISOString();
      await options.audit.save(entry, fingerprint);
      return reply.code(202).send(entry.result);
    } finally {
      options.release();
    }
  });
}
