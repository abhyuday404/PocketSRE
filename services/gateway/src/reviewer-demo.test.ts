import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FixContext, FixDraft, FixProposal } from '@pocketsre/contracts';
import { GOOD_CHECKOUT, ReviewerDemoRepository, reviewerDemoService } from './reviewer-demo.js';
import { createGatewayApp } from './app.js';
import { createLiveBundleLoader } from './connectors.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pocketsre-reviewer-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let url = '';
  const verify = vi.fn(async (sha: string) => {
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).version).toBe(sha);
    expect((await (await fetch(`${url}/checkout?unitPrice=10&quantity=3`)).json()).total).toBe(30);
  });
  const repository = new ReviewerDemoRepository(directory, verify);
  await repository.initialize();
  const service = reviewerDemoService(repository);
  await new Promise<void>((done) => service.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => service.close(() => done())));
  url = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  const loadBundle = createLiveBundleLoader({
    healthUrl: `${url}/health`,
    serviceId: 'reviewer-checkout',
    serviceName: 'Reviewer Checkout',
    connectors: [],
  });
  const app = createGatewayApp({ loadBundle, fixRepository: repository });
  cleanup.push(() => app.close());
  const post = (path: string, payload: object) =>
    app.inject({ method: 'POST', url: path, payload });
  async function prepare(after = '*') {
    const bundle = (await app.inject('/v1/incidents/current')).json();
    const response = await post('/v1/fixes/context', {
      incidentId: bundle.incident.id,
      paths: ['checkout.mjs'],
    });
    expect(response.statusCode).toBe(200);
    const context = response.json() as FixContext;
    const evidenceIds = [context.bundle.evidence.at(-1)!.id];
    const proposal: FixProposal = {
      summary: 'Restore multiplication for line totals.',
      evidenceIds,
      edits: [
        {
          path: 'checkout.mjs',
          before: 'unitPrice + quantity',
          after: `unitPrice ${after} quantity`,
          reason: 'Three items at ten each must total thirty.',
          evidenceIds,
        },
      ],
    };
    const prepared = await post('/v1/fixes/prepare', { contextId: context.id, proposal });
    expect(prepared.statusCode).toBe(200);
    return { context, draft: prepared.json() as FixDraft };
  }
  return { repository, verify, app, post, prepare, url };
}

it('starts green, detects the one-line source regression, and deploys only after approval with live verification', async () => {
  const { repository, verify, app, post, prepare, url } = await fixture();
  expect((await fetch(`${url}/health`)).status).toBe(200);
  await writeFile(repository.file, GOOD_CHECKOUT.replace('*', '+'));
  expect((await fetch(`${url}/health`)).status).toBe(503);
  expect((await (await fetch(`${url}/checkout?unitPrice=10&quantity=3`)).json()).total).toBe(13);
  const { draft } = await prepare();
  expect(draft.delivery).toBe('local-demo');
  expect(verify).not.toHaveBeenCalled();
  expect((await fetch(`${url}/health`)).status).toBe(503);
  const approval = {
    draftId: draft.id,
    requestId: randomUUID(),
    approvedAt: new Date().toISOString(),
  };
  const response = await post('/v1/fixes/execute', approval);
  expect(response.statusCode).toBe(202);
  expect(response.json()).toMatchObject({ status: 'succeeded' });
  expect(response.json()).not.toHaveProperty('pullRequestUrl');
  expect(await readFile(repository.file, 'utf8')).toBe(GOOD_CHECKOUT);
  expect(verify).toHaveBeenCalledOnce();
  expect((await post('/v1/fixes/execute', approval)).json()).toEqual(response.json());
  expect(verify).toHaveBeenCalledOnce();
  expect((await app.inject('/v1/actions/audit')).json().entries[0].action).toBe('DEPLOY_DEMO_FIX');
  expect((await app.inject('/v1/incidents/current')).json().incident.status).toBe('resolved');
});

it('rejects stale source, unapproved execution, and arbitrary generated JavaScript', async () => {
  const { repository, prepare, post, verify } = await fixture();
  const broken = GOOD_CHECKOUT.replace('*', '+');
  await writeFile(repository.file, broken);
  const { context, draft } = await prepare();
  expect((await post('/v1/fixes/execute', { draftId: draft.id })).statusCode).not.toBe(202);
  await expect(
    repository.deploy(context, {
      ...draft,
      changes: [{ ...draft.changes[0]!, after: 'process.exit(0)' }],
    }),
  ).rejects.toThrow(/isolated/);
  await expect(repository.readSource(['../outside.mjs'])).rejects.toThrow();
  await writeFile(repository.file, `${broken}\n`);
  await expect(repository.deploy(context, draft)).rejects.toThrow(/changed/);
  expect(verify).not.toHaveBeenCalled();
});

it('preserves the previous source when tests fail or HTTP verification fails', async () => {
  const { repository, prepare, verify } = await fixture();
  const broken = GOOD_CHECKOUT.replace('*', '+');
  await writeFile(repository.file, broken);
  const { context, draft } = await prepare();
  await expect(
    repository.deploy(context, { ...draft, changes: [{ ...draft.changes[0]!, after: broken }] }),
  ).rejects.toThrow(/regression/);
  expect(await repository.source()).toBe(broken);
  verify.mockRejectedValueOnce(new Error('HTTP verification failed'));
  await expect(repository.deploy(context, draft)).rejects.toThrow(/HTTP/);
  expect(await repository.source()).toBe(broken);
});

it('reports a rejected generated patch on the phone without changing the PC source', async () => {
  const { repository, prepare, post, verify } = await fixture();
  const broken = GOOD_CHECKOUT.replace('*', '+');
  await writeFile(repository.file, broken);
  const { draft } = await prepare('* /* generated comment */');
  const approval = {
    draftId: draft.id,
    requestId: randomUUID(),
    approvedAt: new Date().toISOString(),
  };
  const result = (await post('/v1/fixes/execute', approval)).json();
  expect(result.status).toBe('failed');
  expect(result.message).toContain('Patch rejected; the PC file was not changed.');
  expect(await repository.source()).toBe(broken);
  expect(verify).not.toHaveBeenCalled();
  expect((await post('/v1/fixes/execute', approval)).json()).toEqual(result);
});

it('reports a rolled-back deployment without exposing raw verification errors', async () => {
  const { repository, prepare, post, verify } = await fixture();
  const broken = GOOD_CHECKOUT.replace('*', '+');
  await writeFile(repository.file, broken);
  const { draft } = await prepare();
  verify.mockRejectedValueOnce(new Error('private diagnostic from provider'));
  const result = (
    await post('/v1/fixes/execute', {
      draftId: draft.id,
      requestId: randomUUID(),
      approvedAt: new Date().toISOString(),
    })
  ).json();
  expect(result.status).toBe('failed');
  expect(result.message).toContain('previous PC source was restored');
  expect(result.message).not.toContain('private diagnostic');
  expect(await repository.source()).toBe(broken);
});
