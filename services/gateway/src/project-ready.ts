import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { GitReadyRequestSchema, type AuditEntry } from '@pocketsre/contracts';
import type { ProjectOptions } from './projects.js';
import { ProjectRequestError } from './github-account.js';
import { mergeAudit } from './project-merge.js';
export function canReady(options: ProjectOptions | undefined, repository: string) {
  return (
    !!options?.fixToken &&
    (!options.fixRepositories || options.fixRepositories.includes(repository))
  );
}
export function registerProjectReady(
  app: FastifyInstance,
  options: ProjectOptions | undefined,
  locks: Set<string>,
) {
  app.post('/v1/projects/:id/actions/pulls/:number/ready', async (req, reply) => {
    const params = z
      .object({ id: z.string().uuid(), number: z.coerce.number().int().positive() })
      .safeParse(req.params);
    const parsed = GitReadyRequestSchema.safeParse(req.body);
    if (!params.success || !parsed.success)
      throw new ProjectRequestError('Confirm a valid PR and its current commit.', 400);
    if (!options) throw new ProjectRequestError('Connect GitHub first.', 409);
    const { id, number } = params.data,
      body = parsed.data;
    const project = await options.store.get(id),
      repository = project.repository.fullName;
    if (!canReady(options, repository))
      throw new ProjectRequestError(
        'A PR publication credential is not configured for this repository.',
        409,
      );
    const audit = await mergeAudit(options.store, id);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ action: 'ready', repository, number, ...body }))
      .digest('hex');
    if (locks.has(id)) throw new ProjectRequestError('Another PR action is in progress.', 409);
    locks.add(id);
    try {
      const previous = audit.get(body.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ProjectRequestError('This confirmation ID has already been used.', 409);
        return reply
          .code(previous.entry.result.status === 'running' ? 202 : 200)
          .send(previous.entry.result);
      }
      const age = Date.now() - Date.parse(body.approvedAt);
      if (age < -30000 || age > 300000)
        throw new ProjectRequestError('Confirmation expired. Review again.', 409);
      const pull = z
        .object({
          node_id: z.string(),
          state: z.string(),
          draft: z.boolean(),
          head: z.object({ sha: z.string() }),
        })
        .parse(await options.github.api(`/repos/${repository}/pulls/${number}`));
      if (pull.state !== 'open' || pull.head.sha !== body.sha)
        throw new ProjectRequestError('The PR changed. Refresh and review it again.', 409);
      const entry: AuditEntry = {
        requestId: body.requestId,
        incidentId: `pull:${number}`,
        serviceId: `github:${project.repository.id}`,
        action: 'MARK_PULL_REQUEST_READY',
        targetRelease: body.sha,
        result: {
          actionId: body.requestId,
          status: 'running',
          message: `Ready-for-review request for #${number} has an unconfirmed outcome. Refresh GitHub before retrying.`,
          startedAt: new Date().toISOString(),
          completedAt: null,
          pullRequestUrl: `https://github.com/${repository}/pull/${number}`,
        },
      };
      await audit.save(entry, fingerprint);
      try {
        if (pull.draft)
          await options.github.markPullRequestReady(
            pull.node_id,
            body.requestId,
            options.fixToken!,
          );
        entry.result.status = 'succeeded';
        entry.result.message = `PR #${number} is ready for review. Wait for checks, then review the merge.`;
        entry.result.completedAt = new Date().toISOString();
      } catch (error) {
        if (
          error instanceof ProjectRequestError &&
          [400, 401, 403, 404, 422].includes(error.statusCode)
        ) {
          entry.result.status = 'failed';
          entry.result.message = 'GitHub declined this request. Check PR permissions and refresh.';
          entry.result.completedAt = new Date().toISOString();
        }
      }
      await audit.save(entry, fingerprint);
      return reply.code(entry.result.status === 'running' ? 202 : 200).send(entry.result);
    } finally {
      locks.delete(id);
    }
  });
}
