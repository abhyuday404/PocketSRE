import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AuditStore } from './audit.js';

it('retains unfinished actions across process restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-audit-'));
  try {
    const path = join(directory, 'actions.json');
    const first = new AuditStore(path);
    await first.save(
      {
        requestId: 'request',
        incidentId: 'incident',
        serviceId: 'service',
        action: 'RUN_HEALTH_CHECK',
        targetRelease: null,
        result: {
          actionId: 'action',
          status: 'running',
          message: 'Started',
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
      },
      'fingerprint',
    );
    const restarted = new AuditStore(path);
    await restarted.load();
    expect(restarted.get('request')?.entry.result.status).toBe('running');
    expect(restarted.get('request')?.fingerprint).toBe('fingerprint');
  } finally {
    await rm(directory, { recursive: true });
  }
});
