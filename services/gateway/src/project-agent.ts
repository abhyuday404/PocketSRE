import { mergeAudit } from './project-merge.js';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { IncidentBundle, TrackedProject } from '@pocketsre/contracts';
import { isFixPathAllowed } from '@pocketsre/incident-engine';
import { createGatewayApp } from './app.js';
import { GitHubFixRepository, FixDeploymentError, type FixRepository } from './github-fixes.js';
import type { ProjectOptions } from './projects.js';
import { ProjectRequestError } from './github-account.js';

export function registerProjectAgent(
  app: FastifyInstance,
  options: ProjectOptions,
  probe: (id: string) => Promise<IncidentBundle>,
) {
  const children = new Map<string, { key: string; app: ReturnType<typeof createGatewayApp> }>();
  const queue = new Map<string, Promise<unknown>>();
  function serial<T>(id: string, work: () => Promise<T>) {
    const next = (queue.get(id) ?? Promise.resolve()).then(work);
    queue.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }
  app.addHook('onClose', async () => {
    await Promise.all([...queue.values()].map((p) => p.catch(() => {})));
    await Promise.all([...children.values()].map((child) => child.app.close()));
  });
  app.put('/v1/projects/:id/source', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { paths } = z
      .object({
        paths: z
          .array(
            z
              .string()
              .max(200)
              .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./@()-]+$/),
          )
          .min(1)
          .max(20),
      })
      .strict()
      .parse(request.body);
    if (new Set(paths).size !== paths.length || paths.some((path) => !isFixPathAllowed(path)))
      throw new ProjectRequestError(
        'Choose unique source paths without credentials, workflows, or parent-directory traversal.',
      );
    return serial(id, async () => {
      await options.store.get(id);
      await options.store.update((projects) =>
        projects.map((project) =>
          project.id === id ? { ...project, sourcePaths: paths } : project,
        ),
      );
      // Discard snapshots and approvals even if paths are later changed back.
      const previous = children.get(id);
      if (previous) await previous.app.close();
      children.delete(id);
      return options.store.get(id);
    });
  });
  async function child(project: TrackedProject) {
    const key = JSON.stringify([project.repository.fullName, project.sourcePaths]);
    const existing = children.get(project.id);
    if (existing?.key === key) return existing.app;
    if (existing) await existing.app.close();
    const fixToken =
      !options.fixRepositories || options.fixRepositories.includes(project.repository.fullName)
        ? options.fixToken
        : undefined;
    const base = project.sourcePaths.length
      ? new GitHubFixRepository(
          project.repository.fullName,
          project.sourcePaths,
          fixToken ?? '',
          async (input, init) => {
            if (!init?.method || init.method === 'GET')
              return options.github.readRepositoryResponse(
                project.repository.fullName,
                input,
                init,
              );
            if (!fixToken)
              throw new FixDeploymentError(
                'Project source access is read-only. Configure a separate PR credential before publishing.',
              );
            return fetch(input, init);
          },
        )
      : undefined;
    const repository: FixRepository | undefined = base
      ? {
          repository: base.repository,
          paths: base.paths,
          canPublish: !!fixToken,
          readSource: (paths) => base.readSource(paths),
          assertHead: (context) => base.assertHead(context),
          publish: (context, draft) => {
            if (!fixToken) throw new FixDeploymentError('Project source access is read-only.');
            return base.publish(context, draft);
          },
        }
      : undefined;
    const gateway = createGatewayApp({
      fixRepository: repository,
      auditPath: join(options.store.directory, `${project.id}.actions.json`),
      loadBundle: async () => {
        const current = await options.store.get(project.id);
        if (current.healthUrl) return probe(project.id);
        const now = new Date().toISOString();
        return {
          schemaVersion: 1,
          generatedAt: now,
          incident: {
            id: `project:${project.id}`,
            serviceId: `github:${project.repository.id}`,
            title: 'Repository task · health not configured',
            severity: 'info',
            status: 'resolved',
            startedAt: now,
            lastUpdatedAt: now,
          },
          serviceHealth: {
            serviceId: `github:${project.repository.id}`,
            serviceName: project.repository.fullName,
            status: 'unknown',
            version: null,
            checkedAt: now,
            checks: {},
          },
          evidence: [],
        };
      },
    });
    await gateway.ready();
    children.set(project.id, { key, app: gateway });
    return gateway;
  }
  app.get('/v1/projects/:id/activity/actions', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const response = await serial(id, async () => {
      const gateway = await child(await options.store.get(id));
      return gateway.inject({ method: 'GET', url: '/v1/actions/audit' });
    });
    if (response.statusCode !== 200)
      return reply.code(response.statusCode).type('application/json').send(response.body);
    const merges = (await mergeAudit(options.store, id)).list();
    const entries = [
      ...response.json<{ entries: import('@pocketsre/contracts').AuditEntry[] }>().entries,
      ...merges,
    ];
    return {
      entries: entries
        .sort((a, b) => b.result.startedAt.localeCompare(a.result.startedAt))
        .slice(0, 100),
    };
  });
  app.route({
    method: ['GET', 'POST'],
    url: '/v1/projects/:id/fixes/:operation',
    handler: async (request, reply) => {
      const { id, operation } = z
        .object({
          id: z.string().uuid(),
          operation: z.enum(['config', 'context', 'prepare', 'execute']),
        })
        .parse(request.params);
      // Serialize per project so changing source configuration cannot race an approval.
      const work = serial(id, async () => {
        const project = await options.store.get(id);
        const gateway = await child(project);
        return gateway.inject({
          method: request.method as 'GET' | 'POST',
          url: `/v1/fixes/${operation}`,
          ...(request.body ? { payload: request.body } : {}),
        });
      });
      const response = await work;
      return reply.code(response.statusCode).type('application/json').send(response.body);
    },
  });
}
