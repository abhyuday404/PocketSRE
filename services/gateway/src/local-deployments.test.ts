import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import type { TrackedProject } from '@pocketsre/contracts';
import { LocalDeployments } from './local-deployments.js';
it('reads only the configured repository logs and labels real deployment evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pc-deploy-'));
  try {
    await mkdir(join(dir, 'state'));
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ projects: [{ name: 'demo', repository: 'owner/demo' }] }),
    );
    await writeFile(
      join(dir, 'state/demo.json'),
      JSON.stringify({
        repository: 'owner/demo',
        events: [
          {
            id: 'build',
            timestamp: new Date().toISOString(),
            kind: 'build',
            level: 'info',
            message: 'Deployment launched at abc',
            sha: 'abc',
          },
          {
            id: 'runtime',
            timestamp: new Date().toISOString(),
            kind: 'runtime',
            level: 'error',
            message: 'Invalid TAX_RATE',
            sha: 'abc',
          },
        ],
      }),
    );
    const provider = new LocalDeployments(dir);
    const project = {
      repository: { fullName: 'owner/demo' },
      deployment: { projectId: 'demo', provider: 'local' },
    } as TrackedProject;
    expect(await provider.evidence(project, 'runtime')).toMatchObject([
      {
        id: 'pc-deploy:runtime',
        source: 'deployment',
        type: 'exception',
        excerpt: 'Invalid TAX_RATE',
        metadata: { commit: 'abc', logKind: 'runtime' },
      },
    ]);
    await expect(
      provider.evidence(
        { ...project, repository: { ...project.repository, fullName: 'owner/other' } },
        'build',
      ),
    ).rejects.toThrow('not configured');
    await expect(
      provider.evidence(
        { ...project, deployment: { ...project.deployment!, projectId: '../secret' } },
        'build',
      ),
    ).rejects.toThrow('not configured');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
