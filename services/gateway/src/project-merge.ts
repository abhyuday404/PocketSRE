import { canReady, registerProjectReady } from './project-ready.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  GitMergeRequestSchema,
  mergeBlockers,
  type GitMergeMethod,
  type GitMergePreview,
  type AuditEntry,
} from '@pocketsre/contracts';
import { AuditStore } from './audit.js';
import { ProjectRequestError } from './github-account.js';
import type { ProjectOptions, ProjectStore } from './projects.js';
const ledgers = new WeakMap<ProjectStore, Map<string, Promise<AuditStore>>>();
export function mergeAudit(store: ProjectStore, id: string): Promise<AuditStore> {
  let map = ledgers.get(store);
  if (!map) {
    map = new Map();
    ledgers.set(store, map);
  }
  let value = map.get(id);
  if (!value) {
    value = (async () => {
      const audit = new AuditStore(join(store.directory, `${id}.merges.json`));
      await audit.load();
      return audit;
    })();
    map.set(id, value);
  }
  return value;
}
const paramsSchema = z.object({
  id: z.string().uuid(),
  number: z.coerce.number().int().positive().safe(),
});
const pullSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  mergeable_state: z.string(),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ sha: z.string(), ref: z.string() }),
});
const repoSchema = z.object({
  permissions: z.object({ push: z.boolean() }).optional(),
  allow_merge_commit: z.boolean(),
  allow_squash_merge: z.boolean(),
  allow_rebase_merge: z.boolean(),
});
export function registerProjectMerges(app: FastifyInstance, options?: ProjectOptions) {
  const locks = new Set<string>();
  registerProjectReady(app, options, locks);
  async function context(params: unknown) {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) throw new ProjectRequestError('Invalid project or pull request.', 400);
    if (!options) throw new ProjectRequestError('Connect GitHub first.', 409);
    const project = await options.store.get(parsed.data.id);
    const repository = project.repository.fullName;
    return {
      ...parsed.data,
      project,
      repository,
      audit: await mergeAudit(options.store, project.id),
      api: (path: string) => options.github.api(`/repos/${repository}${path}`),
    };
  }
  async function preview(ctx: Awaited<ReturnType<typeof context>>): Promise<GitMergePreview> {
    const [pullValue, repoValue] = await Promise.all([
      ctx.api(`/pulls/${ctx.number}`),
      ctx.api(''),
    ]);
    const pull = pullSchema.parse(pullValue),
      repo = repoSchema.parse(repoValue);
    const methods: GitMergeMethod[] = [];
    if (repo.allow_squash_merge) methods.push('squash');
    if (repo.allow_merge_commit) methods.push('merge');
    if (repo.allow_rebase_merge) methods.push('rebase');
    const [runsValue, statusValue] = await Promise.all([
      ctx.api(
        `/commits/${encodeURIComponent(pull.head.sha)}/check-runs?filter=latest&per_page=100`,
      ),
      ctx.api(`/commits/${encodeURIComponent(pull.head.sha)}/status?per_page=100`),
    ]);
    const runs = z
      .object({
        total_count: z.number(),
        check_runs: z.array(
          z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
        ),
      })
      .parse(runsValue);
    const statuses = z
      .object({
        total_count: z.number(),
        statuses: z.array(z.object({ context: z.string(), state: z.string() })),
      })
      .parse(statusValue);
    const checks = [
      ...runs.check_runs.map((c) => ({
        name: c.name,
        state: c.status === 'completed' ? (c.conclusion ?? 'unknown') : c.status,
      })),
      ...statuses.statuses.map((c) => ({ name: c.context, state: c.state })),
    ];
    const reasons = mergeBlockers({
      open: pull.state === 'open',
      draft: pull.draft,
      merged: pull.merged,
      push: repo.permissions?.push ?? false,
      mergeable: pull.mergeable,
      state: pull.mergeable_state,
      methods,
      checks,
      complete:
        runs.total_count <= runs.check_runs.length &&
        statuses.total_count <= statuses.statuses.length,
    });
    if (
      ctx.audit
        .list(Infinity)
        .some((e) => e.incidentId === `pull:${ctx.number}` && e.result.status === 'running')
    )
      reasons.push(
        'A previous PR action has an unconfirmed outcome. Check this PR on GitHub before taking further action.',
      );
    return {
      number: pull.number,
      title: pull.title,
      repository: ctx.repository,
      headRef: pull.head.ref,
      sha: pull.head.sha,
      baseRef: pull.base.ref,
      baseSha: pull.base.sha,
      merged: pull.merged,
      draft: pull.draft,
      canMarkReady: canReady(options, ctx.repository),
      ready: reasons.length === 0,
      reasons,
      methods,
      checks,
    };
  }
  app.get('/v1/projects/:id/git/pulls/:number/merge', async (req) =>
    preview(await context(req.params)),
  );
  app.post('/v1/projects/:id/actions/pulls/:number/merge', async (req, reply) => {
    const parsed = GitMergeRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ProjectRequestError(
        'A merge requires confirmation of the commit and merge method.',
        400,
      );
    const body = parsed.data;
    const ctx = await context(req.params);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ repository: ctx.repository, number: ctx.number, ...body }))
      .digest('hex');
    if (locks.has(ctx.id))
      throw new ProjectRequestError('Another merge is being processed. Refresh shortly.', 409);
    locks.add(ctx.id);
    try {
      const previous = ctx.audit.get(body.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ProjectRequestError(
            'This request ID already belongs to another confirmation.',
            409,
          );
        return reply
          .code(previous.entry.result.status === 'running' ? 202 : 200)
          .send(previous.entry.result);
      }
      const age = Date.now() - Date.parse(body.approvedAt);
      if (age < -30000 || age > 300000)
        throw new ProjectRequestError(
          'This confirmation expired. Refresh and review the PR again.',
          409,
        );
      const current = await preview(ctx);
      if (!current.ready) throw new ProjectRequestError(current.reasons.join(' '), 409);
      if (
        current.sha !== body.sha ||
        current.baseSha !== body.baseSha ||
        current.baseRef !== body.baseRef
      )
        throw new ProjectRequestError(
          'The PR changed since review. Refresh the diff and confirm again.',
          409,
        );
      if (!current.methods.includes(body.method))
        throw new ProjectRequestError('This merge method is no longer allowed.', 409);
      const entry: AuditEntry = {
        requestId: body.requestId,
        incidentId: `pull:${ctx.number}`,
        serviceId: `github:${ctx.project.repository.id}`,
        action: 'MERGE_GITHUB_PULL_REQUEST',
        targetRelease: body.sha,
        result: {
          actionId: body.requestId,
          status: 'running',
          startedAt: new Date().toISOString(),
          completedAt: null,
          message: `Merge #${ctx.number} (${body.method}) into ${body.baseRef} requested. Outcome unconfirmed; check GitHub.`,
          pullRequestUrl: `https://github.com/${ctx.repository}/pull/${ctx.number}`,
        },
      };
      // Persist intent before the write. Replays (including after a restart) never repeat it.
      await ctx.audit.save(entry, fingerprint);
      try {
        const result = z
          .object({ merged: z.boolean(), sha: z.string().nullable(), message: z.string() })
          .parse(
            await options!.github.mergePullRequest(
              ctx.repository,
              ctx.number,
              body.sha,
              body.method,
            ),
          );
        entry.result.status = result.merged ? 'succeeded' : 'failed';
        entry.result.message = result.merged
          ? `Merged #${ctx.number} into ${body.baseRef} using ${body.method}. Commit ${result.sha ?? 'confirmed by GitHub'}.`
          : `GitHub declined merge #${ctx.number}. Refresh its status before trying again.`;
        entry.result.completedAt = new Date().toISOString();
      } catch (error) {
        if (
          error instanceof ProjectRequestError &&
          [401, 403, 404, 405, 409, 422].includes(error.statusCode)
        ) {
          entry.result.status = 'failed';
          entry.result.message = `GitHub declined merge #${ctx.number}. Check permissions, required reviews, checks and branch rules, then refresh.`;
          entry.result.completedAt = new Date().toISOString();
        }
      }
      await ctx.audit.save(entry, fingerprint);
      return reply.code(entry.result.status === 'running' ? 202 : 200).send(entry.result);
    } finally {
      locks.delete(ctx.id);
    }
  });
}
