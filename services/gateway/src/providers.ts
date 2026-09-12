import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EvidenceEvent, TrackedProject } from '@pocketsre/contracts';
import { redactEvidence } from '@pocketsre/incident-engine';
import { ProjectRequestError } from './github-account.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const projectSchema = z.object({
  id,
  name: z.string().max(200),
  link: z
    .object({ type: z.string(), org: z.string().optional(), repo: z.string().optional() })
    .nullish(),
});
const deploymentSchema = z.object({
  uid: id.optional(),
  id: id.optional(),
  state: z.string().optional(),
  readyState: z.string().optional(),
  created: z.number().optional(),
  createdAt: z.number().optional(),
});
export interface DeploymentProvider {
  status(): { connected: boolean; teamId: string | null };
  projects(
    repository: string,
    cursor?: string,
  ): Promise<{
    projects: { id: string; name: string; repository: string | null; suggested: boolean }[];
    next: string | null;
  }>;
  project(projectId: string): Promise<{ id: string; name: string }>;
  evidence(project: TrackedProject, kind: 'build' | 'runtime'): Promise<EvidenceEvent[]>;
}

/** GET-only Vercel adapter. Tokens supplied from environment or UI remain in memory. */
export class VercelProvider implements DeploymentProvider {
  private generation = 0;
  constructor(
    private token = '',
    private teamId = '',
    private fetcher: typeof fetch = fetch,
  ) {}
  status() {
    return { connected: !!this.token, teamId: this.teamId || null };
  }
  async connect(token: string, teamId: string) {
    const generation = ++this.generation;
    const candidate = new VercelProvider(token, teamId, this.fetcher);
    await candidate.projects(''); // Validate access before replacing the current connection.
    if (generation !== this.generation)
      throw new ProjectRequestError('The Vercel connection changed. Connect again if needed.', 409);
    this.token = token;
    this.teamId = teamId;
  }
  disconnect() {
    this.generation++;
    this.token = '';
    this.teamId = '';
  }
  private async read(
    path: string,
    query: Record<string, string> = {},
    stream = false,
  ): Promise<unknown> {
    if (!this.token) throw new ProjectRequestError('Connect Vercel to read deployment logs.', 409);
    const url = new URL(`https://api.vercel.com${path}`);
    for (const [key, value] of Object.entries({
      ...query,
      ...(this.teamId ? { teamId: this.teamId } : {}),
    }))
      url.searchParams.set(key, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), stream ? 5000 : 12000);
    let text = '';
    try {
      const response = await this.fetcher(url.href, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProjectRequestError(
          response.status === 401 || response.status === 403
            ? 'Vercel denied access. Check the token, team, project permissions, and log availability.'
            : 'Vercel could not return logs or deployments. Try again later.',
          502,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) return [];
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          let item: ReadableStreamReadResult<Uint8Array>;
          try {
            item = await reader.read();
          } catch (error) {
            if (stream && text.trim() && controller.signal.aborted) break;
            throw error;
          }
          if (item.done) {
            text += decoder.decode();
            break;
          }
          bytes += item.value.length;
          if (bytes > 2_000_000)
            throw new ProjectRequestError(
              'Vercel log response exceeded the collection limit.',
              502,
            );
          text += decoder.decode(item.value, { stream: true });
          if (stream && text.split('\n').length > 100) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!text.trim()) return [];
    try {
      return JSON.parse(text);
    } catch {
      if (!stream)
        throw new ProjectRequestError('Vercel returned an unsupported log response.', 502);
      // Runtime logs may be NDJSON/SSE. Ignore only the unfinished final record.
      return text
        .split('\n')
        .slice(0, -1)
        .filter((line) => line.trim() && !line.startsWith(':'))
        .map((line) => JSON.parse(line.replace(/^data:\s*/, '')));
    }
  }
  async projects(repository: string, cursor?: string) {
    const raw = await this.read('/v10/projects', {
      limit: '50',
      ...(cursor ? { from: cursor } : {}),
    });
    const result = Array.isArray(raw)
      ? { projects: raw, pagination: undefined }
      : z
          .object({
            projects: z.array(z.unknown()),
            pagination: z
              .object({ next: z.union([z.string(), z.number()]).nullable().optional() })
              .optional(),
          })
          .parse(raw);
    const projects = z
      .array(projectSchema)
      .max(50)
      .parse(result.projects)
      .map((p) => {
        const repo =
          p.link?.type === 'github' && p.link.org && p.link.repo
            ? `${p.link.org}/${p.link.repo}`
            : null;
        return {
          id: p.id,
          name: p.name,
          repository: repo,
          suggested: repo?.toLowerCase() === repository.toLowerCase(),
        };
      });
    return { projects, next: result.pagination?.next ? String(result.pagination.next) : null };
  }
  async project(projectId: string) {
    return projectSchema.parse(await this.read(`/v9/projects/${id.parse(projectId)}`));
  }
  async evidence(project: TrackedProject, kind: 'build' | 'runtime') {
    const binding = project.deployment;
    if (!binding) return [];
    const { deployments } = z.object({ deployments: z.array(deploymentSchema) }).parse(
      await this.read('/v7/deployments', {
        projectId: binding.projectId,
        target: binding.target,
        limit: '1',
      }),
    );
    const deployment = deployments[0];
    if (!deployment) return [];
    const deploymentId = id.parse(deployment.uid ?? deployment.id);
    const raw =
      kind === 'build'
        ? await this.read(`/v3/deployments/${deploymentId}/events`, {
            follow: '0',
            limit: '60',
            direction: 'backward',
          })
        : await this.read(
            `/v1/projects/${binding.projectId}/deployments/${deploymentId}/runtime-logs`,
            {},
            true,
          );
    const records = Array.isArray(raw) ? raw : [raw];
    const events: EvidenceEvent[] = [];
    for (const value of records.slice(0, 60)) {
      const log = z
        .object({
          message: z.string().optional(),
          text: z.string().optional(),
          level: z.string().optional(),
          timestampInMs: z.coerce.number().optional(),
          created: z.coerce.number().optional(),
          payload: z.object({ text: z.string().optional() }).optional(),
        })
        .safeParse(value);
      if (!log.success) continue;
      const excerpt = log.data.message ?? log.data.text ?? log.data.payload?.text;
      const timestamp = log.data.timestampInMs ?? log.data.created;
      if (
        !excerpt ||
        !timestamp ||
        !Number.isFinite(timestamp) ||
        Math.abs(Date.now() - timestamp) > 30 * 86400000
      )
        continue;
      const event: EvidenceEvent = {
        id: `vercel:${deploymentId}:${kind}:${createHash('sha256').update(`${timestamp}:${excerpt}`).digest('hex').slice(0, 24)}`,
        source: 'deployment',
        type: 'investigation_result',
        timestamp: new Date(timestamp).toISOString(),
        title: `Vercel ${kind} log · ${log.data.level ?? 'output'}`,
        excerpt: excerpt.slice(0, 4000),
        metadata: {
          provider: 'vercel',
          projectId: binding.projectId,
          deploymentId,
          target: binding.target,
          logKind: kind,
        },
      };
      events.push(redactEvidence(event));
    }
    return events;
  }
}
