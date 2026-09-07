import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import type { IncidentBundle } from '@pocketsre/contracts';
import { inspectEnvironmentContract } from './repository.js';

it('finds missing example declarations without reading .env or following symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pocketsre-repo-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, '.env.example'), 'DATABASE_URL=example\n');
    await writeFile(join(root, '.env'), 'password=not-to-be-read');
    await writeFile(join(root, 'src', 'db.ts'), 'const url = process.env.DB_URL;');
    await symlink(join(root, '.env'), join(root, 'src', 'secret.ts'));
    const bundle = {
      evidence: [{ id: 'config', title: 'DB_URL missing', excerpt: '' }],
    } as IncidentBundle;
    const result = await inspectEnvironmentContract(bundle, root);
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('DB_URL');
    expect(result.summary).not.toContain('not-to-be-read');
    expect(result.evidenceIds).toEqual(['config']);
  } finally {
    await rm(root, { recursive: true });
  }
});
