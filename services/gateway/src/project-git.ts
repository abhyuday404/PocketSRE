import { registerProjectMerges } from './project-merge.js';
import { z } from 'zod';
import { CodePathSchema, readGitCode } from './git-code.js';
import type { FastifyInstance } from 'fastify';
import { GitPullSchema, GitCommitSchema, GitBranchSchema } from '@pocketsre/contracts';
import type { ProjectOptions } from './projects.js';
import { ProjectRequestError } from './github-account.js';

function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ProjectRequestError('Use a valid project, page number and git reference.', 400);
  return result.data;
}
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(150).default(1) }).strict();
const refSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => !/[\s\x00-\x1f]/.test(v), 'Invalid git reference.');
const fileSchema = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
  patch: z.string().optional(),
});
export function gitDiffFiles(value: unknown) {
  let budget = 120000;
  return fileSchema
    .array()
    .parse(value)
    .map((file) => {
      const patch = file.patch?.slice(0, Math.min(16000, budget)) ?? null;
      budget -= patch?.length ?? 0;
      return {
        ...file,
        patch,
        patchTruncated: !!file.patch && file.patch.length > (patch?.length ?? 0),
      };
    });
}
export function registerProjectGit(app: FastifyInstance, options?: ProjectOptions) {
  registerProjectMerges(app, options);
  async function repository(params: unknown) {
    const { id } = input(z.object({ id: z.string().uuid() }), params);
    if (!options) throw new ProjectRequestError('Connect GitHub to browse your projects.', 409);
    const project = await options.store.get(id);
    return {
      project,
      api: (path: string) => options.github.api(`/repos/${project.repository.fullName}${path}`),
    };
  }
  app.get('/v1/projects/:id/git/code', async (req) => {
    const { ref, path } = input(
      z.object({ ref: refSchema.optional(), path: CodePathSchema }).strict(),
      req.query,
    );
    const { api, project } = await repository(req.params);
    return readGitCode(api, ref ?? project.repository.defaultBranch, path);
  });
  app.get('/v1/projects/:id/git/pulls', async (req) => {
    const { page } = input(pageSchema, req.query);
    const { api } = await repository(req.params);
    const items = GitPullSchema.array().parse(
      await api(`/pulls?state=open&sort=updated&direction=desc&per_page=20&page=${page}`),
    );
    return { items, nextPage: items.length === 20 && page < 150 ? page + 1 : null };
  });
  app.get('/v1/projects/:id/git/branches', async (req) => {
    const { page } = input(pageSchema, req.query);
    const { api } = await repository(req.params);
    const items = GitBranchSchema.array().parse(await api(`/branches?per_page=30&page=${page}`));
    return { items, nextPage: items.length === 30 && page < 150 ? page + 1 : null };
  });
  app.get('/v1/projects/:id/git/commits', async (req) => {
    const { page, ref } = input(pageSchema.extend({ ref: refSchema.optional() }), req.query);
    const { api, project } = await repository(req.params);
    const items = GitCommitSchema.array().parse(
      await api(
        `/commits?sha=${encodeURIComponent(ref ?? project.repository.defaultBranch)}&per_page=20&page=${page}`,
      ),
    );
    return { items, nextPage: items.length === 20 && page < 150 ? page + 1 : null };
  });
  app.get('/v1/projects/:id/git/pulls/:number/files', async (req) => {
    const { number } = input(z.object({ number: z.coerce.number().int().positive() }), req.params);
    const { page, sha } = input(
      pageSchema.extend({
        sha: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .optional(),
      }),
      req.query,
    );
    const { api } = await repository(req.params);
    async function checkHead() {
      if (!sha) return;
      const value = z
        .object({ head: z.object({ sha: z.string() }) })
        .parse(await api(`/pulls/${number}`));
      if (value.head.sha !== sha)
        throw new ProjectRequestError(
          'The PR changed. Refresh the project and review its updated diff.',
          409,
        );
    }
    await checkHead();
    const files = gitDiffFiles(await api(`/pulls/${number}/files?per_page=20&page=${page}`));
    await checkHead();
    return {
      files,
      nextPage: files.length === 20 && page < 150 ? page + 1 : null,
      limited: page === 150,
      summary: `Pull request #${number} · changed files`,
    };
  });
  app.get('/v1/projects/:id/git/commits/:sha/files', async (req) => {
    const { sha } = input(z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }), req.params);
    const { page } = input(pageSchema, req.query);
    const { api } = await repository(req.params);
    const data = z
      .object({ files: z.array(z.unknown()).default([]) })
      .parse(await api(`/commits/${sha}?per_page=20&page=${page}`));
    const files = gitDiffFiles(data.files);
    return {
      files,
      nextPage: files.length === 20 && page < 150 ? page + 1 : null,
      limited: page === 150,
      summary: `Commit ${sha.slice(0, 7)}`,
    };
  });
  app.get('/v1/projects/:id/git/compare', async (req) => {
    const { base, head } = input(
      z.object({ base: refSchema, head: refSchema }).strict(),
      req.query,
    );
    const { api } = await repository(req.params);
    const data = z
      .object({
        status: z.string(),
        ahead_by: z.number(),
        behind_by: z.number(),
        files: z.array(z.unknown()).default([]),
      })
      .parse(
        await api(
          `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1&page=1`,
        ),
      );
    return {
      files: gitDiffFiles(data.files),
      nextPage: null,
      limited: data.files.length >= 300,
      summary: `${data.status} · ${data.ahead_by} ahead · ${data.behind_by} behind`,
    };
  });
}
