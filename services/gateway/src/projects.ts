import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ProjectHealthUrlSchema,
  RepositoryNameSchema,
  TrackedProjectSchema,
  PushTokenSchema,
  type TrackedProject,
} from '@pocketsre/contracts';
import { GitHubAccount, ProjectRequestError } from './github-account.js';
import { createLiveBundleLoader } from './connectors.js';
import { VercelProvider } from './providers.js';
import { ProjectMonitor, type PushTransport } from './project-monitor.js';
import { registerProjectAgent } from './project-agent.js';

const stateSchema = z
  .object({ version: z.literal(1), projects: z.array(TrackedProjectSchema).max(50) })
  .strict();
export class ProjectStore {
  private projects: TrackedProject[] = [];
  private loading?: Promise<void>;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  load() {
    return (this.loading ??= (async () => {
      await mkdir(this.directory, { recursive: true });
      try {
        const file = await open(join(this.directory, 'projects.json'), 'r');
        try {
          if ((await file.stat()).size > 1_000_000)
            throw new Error('Project store exceeds its limit.');
          this.projects = stateSchema.parse(JSON.parse(await file.readFile('utf8'))).projects;
          if (
            new Set(this.projects.map((p) => p.id)).size !== this.projects.length ||
            new Set(this.projects.map((p) => p.repository.id)).size !== this.projects.length
          )
            throw new Error('Project store contains duplicate identities.');
        } finally {
          await file.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })());
  }
  async list() {
    await this.load();
    return structuredClone(this.projects);
  }
  async get(id: string) {
    const project = (await this.list()).find((p) => p.id === id);
    if (!project)
      throw new ProjectRequestError('Project not found. Refresh your project list.', 404);
    return project;
  }
  async update(transform: (projects: TrackedProject[]) => TrackedProject[]) {
    const work = this.pending.then(async () => {
      await this.load();
      const state = stateSchema.parse({
        version: 1,
        projects: transform(structuredClone(this.projects)),
      });
      const temporary = join(this.directory, `.projects-${randomUUID()}.json`);
      try {
        await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
        await rename(temporary, join(this.directory, 'projects.json'));
        this.projects = state.projects;
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
    this.pending = work.catch(() => {});
    return work;
  }
}

export type ProjectOptions = {
  vercel?: VercelProvider;
  monitor?: { path: string; push: PushTransport; intervalMs?: number };
  fixToken?: string;
  github: GitHubAccount;
  store: ProjectStore;
  allowedHealthOrigins: string[];
  fetcher?: typeof fetch;
};

export function registerProjectRoutes(app: FastifyInstance, options?: ProjectOptions) {
  const loaders = new Map<
    string,
    { url: string; load: ReturnType<typeof createLiveBundleLoader>; selection: { logs: boolean } }
  >();
  const queues = new Map<string, Promise<unknown>>();
  const allowed = new Set(
    (options?.allowedHealthOrigins ?? []).map((value) => {
      const url = new URL(value);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error('Project health allowlist must contain HTTP(S) origins only.');
      return url.origin;
    }),
  );
  const requireOptions = () => {
    if (!options)
      throw new ProjectRequestError(
        'Projects are not enabled on this gateway. Configure a protected GitHub connection first.',
        409,
      );
    return options;
  };
  const validateHealth = (value: string) => {
    const url = new URL(ProjectHealthUrlSchema.parse(value));
    if (url.username || url.password || url.search || url.hash)
      throw new ProjectRequestError(
        'Health URLs cannot contain credentials, query parameters, or fragments.',
      );
    if (!allowed.has(url.origin))
      throw new ProjectRequestError(
        'This health host is not allowed by the gateway. Ask its administrator to allow the deployment host before connecting it.',
      );
    return url.href;
  };
  app.get('/v1/github/connection', async () =>
    options
      ? options.github.status()
      : {
          enabled: false,
          connected: false,
          canSignIn: false,
          account: null,
          expiresAt: null,
        },
  );
  app.post('/v1/github/device', async () => requireOptions().github.start());
  app.post('/v1/github/device/poll', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.body);
    return requireOptions().github.poll(id);
  });
  app.delete('/v1/github/connection', async () => {
    requireOptions().github.disconnect();
    return { disconnected: true };
  });
  app.get('/v1/github/repositories', async (request) => {
    const { page } = z
      .object({ page: z.coerce.number().int().min(1).max(1000).default(1) })
      .strict()
      .parse(request.query);
    return requireOptions().github.repositories(page);
  });
  app.get('/v1/projects', async () => ({ projects: options ? await options.store.list() : [] }));
  app.post('/v1/projects', async (request) => {
    const { repository: name } = z
      .object({ repository: RepositoryNameSchema })
      .strict()
      .parse(request.body);
    const { github, store } = requireOptions();
    const repository = await github.repository(name);
    await store.update((projects) => {
      if (projects.some((p) => p.repository.id === repository.id)) return projects;
      if (projects.length >= 50) throw new ProjectRequestError('You can track up to 50 projects.');
      return [
        ...projects,
        {
          id: randomUUID(),
          repository,
          healthUrl: null,
          createdAt: new Date().toISOString(),
          monitoring: false,
          deployment: null,
          sourcePaths: [],
        },
      ];
    });
    return (await store.list()).find((p) => p.repository.id === repository.id)!;
  });
  app.put('/v1/projects/:id/health', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { healthUrl } = z
      .object({ healthUrl: ProjectHealthUrlSchema.nullable() })
      .strict()
      .parse(request.body);
    const url = healthUrl ? validateHealth(healthUrl) : null;
    const { store } = requireOptions();
    await store.update((projects) => {
      if (!projects.some((p) => p.id === id))
        throw new ProjectRequestError('Project not found.', 404);
      return projects.map((p) => (p.id === id ? { ...p, healthUrl: url } : p));
    });
    loaders.delete(id);
    return store.get(id);
  });
  app.delete('/v1/projects/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await requireOptions().store.update((projects) => projects.filter((p) => p.id !== id));
    loaders.delete(id);
    return { removed: true };
  });
  function checkIncident(id: string, logs = true) {
    const work = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const { store, fetcher = fetch } = requireOptions();
      const project = await store.get(id);
      if (!project.healthUrl)
        throw new ProjectRequestError('Add a health endpoint to check this project.', 409);
      const healthUrl = validateHealth(project.healthUrl); // Recheck saved URLs after config changes.
      let loader = loaders.get(id);
      const signature = healthUrl + JSON.stringify(project.deployment);
      if (!loader || loader.url !== signature) {
        const serviceId = `github:${project.repository.id}`;
        const selection = { logs };
        const load = createLiveBundleLoader({
          healthUrl,
          serviceId,
          serviceName: project.repository.fullName,
          incidentPath: join(store.directory, `${id}.incident.json`),
          connectors: () =>
            selection.logs && project.deployment
              ? (['build', 'runtime'] as const).map((kind) => ({
                  name: `Vercel ${kind} logs`,
                  collect: async () => {
                    if (!options?.vercel) throw new Error('Vercel is not configured.');
                    return options.vercel.evidence(project, kind);
                  },
                }))
              : [],
          fetcher: async (input, init) => {
            const response = await fetcher(input, init);
            await response.body?.cancel().catch(() => {});
            // Availability only: never infer business correctness or a release from arbitrary JSON.
            if (!response.ok && response.status < 500)
              return new Response(null, { status: response.status });
            return new Response(
              JSON.stringify({
                serviceId,
                serviceName: project.repository.fullName,
                status: response.ok ? 'healthy' : 'down',
                version: null,
                checkedAt: new Date().toISOString(),
                checks: { http: response.ok ? 'healthy' : 'failed' },
              }),
              { status: response.ok ? 200 : response.status },
            );
          },
        });
        loader = { url: signature, load, selection };
        loaders.set(id, loader);
      }
      loader.selection.logs = logs;
      const bundle = await loader.load();
      const current = await store.get(id);
      if (
        current.healthUrl !== project.healthUrl ||
        JSON.stringify(current.deployment) !== JSON.stringify(project.deployment)
      )
        throw new ProjectRequestError(
          'The endpoint changed during this check. Refresh again.',
          409,
        );
      return bundle;
    });
    queues.set(
      id,
      work.catch(() => {}),
    );
    return work;
  }
  app.get('/v1/projects/:id/incident', async (request) =>
    checkIncident(z.object({ id: z.string().uuid() }).parse(request.params).id),
  );
  if (options) registerProjectAgent(app, options, checkIncident);
  const provider = () => {
    const value = requireOptions().vercel;
    if (!value)
      throw new ProjectRequestError('Vercel connections are not enabled on this gateway.', 409);
    return value;
  };
  app.get('/v1/providers/vercel', async () => provider().status());
  app.put('/v1/providers/vercel', async (request) => {
    const input = z
      .object({
        token: z.string().trim().min(10).max(500),
        teamId: z
          .string()
          .regex(/^[A-Za-z0-9_-]*$/)
          .max(120)
          .default(''),
      })
      .strict()
      .parse(request.body);
    await provider().connect(input.token, input.teamId);
    return provider().status();
  });
  app.delete('/v1/providers/vercel', async () => {
    provider().disconnect();
    return provider().status();
  });
  app.get('/v1/projects/:id/deployments/available', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { cursor } = z.object({ cursor: z.string().max(120).optional() }).parse(request.query);
    const project = await requireOptions().store.get(id);
    return provider().projects(project.repository.fullName, cursor);
  });
  app.put('/v1/projects/:id/deployment', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z
      .object({
        projectId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,120}$/)
          .nullable(),
        target: z.enum(['production', 'preview']).default('production'),
      })
      .strict()
      .parse(request.body);
    const remote = input.projectId ? await provider().project(input.projectId) : null;
    const store = requireOptions().store;
    await store.get(id);
    await store.update((projects) =>
      projects.map((p) =>
        p.id === id
          ? {
              ...p,
              deployment: remote
                ? {
                    provider: 'vercel',
                    projectId: remote.id,
                    name: remote.name,
                    target: input.target,
                  }
                : null,
            }
          : p,
      ),
    );
    loaders.delete(id);
    return store.get(id);
  });
  const monitor = options?.monitor
    ? new ProjectMonitor({
        ...options.monitor,
        list: () => options.store.list(),
        probe: (id) => checkIncident(id, false),
      })
    : undefined;
  if (monitor) {
    app.addHook('onReady', () => monitor.start());
    app.addHook('onClose', () => monitor.stop());
  }
  app.put('/v1/projects/:id/monitor', async (request) => {
    if (!monitor) throw new ProjectRequestError('Background monitoring is not configured.', 409);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body);
    const store = requireOptions().store;
    const project = await store.get(id);
    if (enabled && !project.healthUrl)
      throw new ProjectRequestError('Save a health endpoint before enabling monitoring.');
    await store.update((projects) =>
      projects.map((p) => (p.id === id ? { ...p, monitoring: enabled } : p)),
    );
    return store.get(id);
  });
  app.get('/v1/projects/:id/monitor', async (request) => {
    if (!monitor) throw new ProjectRequestError('Background monitoring is not configured.', 409);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return monitor.status(id, (await requireOptions().store.get(id)).monitoring);
  });
  app.put('/v1/projects/:id/notifications', async (request) => {
    if (!monitor) throw new ProjectRequestError('Notifications are not configured.', 409);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z
      .object({ deviceId: z.string().uuid(), token: PushTokenSchema.nullable() })
      .strict()
      .safeParse(request.body);
    if (!input.success)
      throw new ProjectRequestError('Provide a valid device ID and Expo push token.');
    await requireOptions().store.get(id);
    return monitor.subscribe(input.data.deviceId, id, input.data.token);
  });
}
