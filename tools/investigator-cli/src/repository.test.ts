import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import type { IncidentBundle } from '@pocketsre/contracts';
import { inspectEnvironmentContract } from './repository.js';

const bundle = {
  evidence: [{ id: 'config', title: 'DB_URL missing', excerpt: '' }],
} as IncidentBundle;

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), 'pocketsre-repo-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, '.env.example'), 'DATABASE_URL=example\n');
  await writeFile(
    join(root, '.env'),
    'password=not-to-be-read\nPRIVATE=process.env.ENV_FILE_MUST_NOT_BE_READ',
  );
  await writeFile(join(root, 'src', 'db.ts'), 'const url = process.env.DB_URL;');
  return root;
}

it('finds missing example declarations without reading .env', async () => {
  const root = await createRepository();
  try {
    const result = await inspectEnvironmentContract(bundle, root);
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('DB_URL');
    expect(result.summary).not.toContain('not-to-be-read');
    expect(result.summary).not.toContain('ENV_FILE_MUST_NOT_BE_READ');
    expect(result.evidenceIds).toEqual(['config']);
  } finally {
    await rm(root, { recursive: true });
  }
});

it('does not follow a source file symlink into .env', async ({ skip }) => {
  const root = await createRepository();
  try {
    // Creating the actual fixture probes capability. Only known Windows privilege errors skip it.
    try {
      await symlink(join(root, '.env'), join(root, 'src', 'secret.ts'), 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        skip(
          `Windows denied file-symlink creation (${code}); this regression remains mandatory on Linux CI.`,
        );
        return;
      }
      throw error;
    }
    const result = await inspectEnvironmentContract(bundle, root);
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('DB_URL');
    // Reading the linked file would introduce this otherwise-unused variable in the finding.
    expect(result.summary).not.toContain('ENV_FILE_MUST_NOT_BE_READ');
    expect(result.summary).not.toContain('not-to-be-read');
    expect(result.evidenceIds).toEqual(['config']);
  } finally {
    await rm(root, { recursive: true });
  }
});
