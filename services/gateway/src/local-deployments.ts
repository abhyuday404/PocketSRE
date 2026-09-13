import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { EvidenceEvent, TrackedProject } from '@pocketsre/contracts';
import { redactEvidence } from '@pocketsre/incident-engine';
const configSchema = z.object({
  projects: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/), repository: z.string() })),
});
export class LocalDeployments {
  constructor(private readonly directory: string) {}
  async project(repository: string) {
    const config = configSchema.parse(
      JSON.parse(await readFile(join(this.directory, 'config.json'), 'utf8')),
    );
    return config.projects.find((p) => p.repository === repository) ?? null;
  }
  async evidence(project: TrackedProject, kind: 'build' | 'runtime'): Promise<EvidenceEvent[]> {
    const binding = await this.project(project.repository.fullName);
    if (!binding || binding.name !== project.deployment?.projectId)
      throw new Error('This repository is not configured in the PC deployment service.');
    const path = join(this.directory, 'state', `${binding.name}.json`);
    if ((await stat(path)).size > 1000000) throw new Error('Local deployment log limit exceeded.');
    const state = z
      .object({
        repository: z.literal(project.repository.fullName),
        events: z
          .array(
            z.object({
              id: z.string(),
              timestamp: z.string().datetime(),
              kind: z.enum(['build', 'runtime']),
              level: z.enum(['info', 'error']),
              message: z.string().max(2000),
              sha: z.string().nullable(),
            }),
          )
          .max(150),
      })
      .parse(JSON.parse(await readFile(path, 'utf8')));
    return state.events
      .filter((e) => e.kind === kind)
      .slice(-15)
      .map((e) =>
        redactEvidence({
          id: `pc-deploy:${e.id}`,
          source: 'deployment',
          type: e.level === 'error' ? 'exception' : 'deployment_completed',
          timestamp: e.timestamp,
          title: `PC ${kind} · ${e.level}`,
          excerpt: e.message,
          metadata: {
            provider: 'local',
            repository: project.repository.fullName,
            commit: e.sha ?? 'unknown',
            logKind: kind,
          },
        }),
      );
  }
}
