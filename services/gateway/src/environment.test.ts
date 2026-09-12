import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPrivateGatewayEnvironment } from './environment.js';

it('loads external config without overriding process values and tolerates a missing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-env-'));
  const key = 'POCKETSRE_ENV_TEST_VALUE';
  const previous = process.env[key];
  try {
    const path = join(directory, 'gateway.env');
    loadPrivateGatewayEnvironment(path);
    await writeFile(path, `${key}=external-value\n`, { mode: 0o600 });
    delete process.env[key];
    loadPrivateGatewayEnvironment(path);
    expect(process.env[key]).toBe('external-value');
    process.env[key] = 'process-value';
    loadPrivateGatewayEnvironment(path);
    expect(process.env[key]).toBe('process-value');
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
