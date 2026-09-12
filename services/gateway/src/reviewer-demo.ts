import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, rename, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import type { FixContext, FixDraft } from '@pocketsre/contracts';
import { FixDeploymentError, type FixRepository } from './github-fixes.js';

export const GOOD_CHECKOUT =
  'export function lineTotal(unitPrice, quantity) {\n  return unitPrice * quantity;\n}\n';
const digest = (source: string) => createHash('sha1').update(source).digest('hex');
// This demo deliberately supports just the advertised one-operator regression.
// Never execute arbitrary model-produced JavaScript on the developer's laptop.
async function calculator(source: string): Promise<(price: number, quantity: number) => number> {
  if (
    !/^\s*export\s+function\s+lineTotal\(\s*unitPrice\s*,\s*quantity\s*\)\s*\{\s*return\s+unitPrice\s*[+*]\s*quantity\s*;\s*\}\s*$/.test(
      source,
    )
  )
    throw new FixDeploymentError(
      'Patch rejected; the PC file was not changed. Only the isolated checkout function with a + or * operator is supported. Keep its existing structure and change only the operator, without adding comments or other code. Generate a new fix.',
    );
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
    .lineTotal;
}
export const CHECKOUT_CASES = [
  [10, 3, 30],
  [5, 0, 0],
  [7, 4, 28],
] as const;
async function testSource(source: string) {
  const total = await calculator(source);
  for (const [price, quantity, expected] of CHECKOUT_CASES)
    if (total(price, quantity) !== expected)
      throw new FixDeploymentError(
        'Independent checkout regression test failed; the PC file was not changed. The patch must return 30 for 10 × 3, 0 for 5 × 0, and 28 for 7 × 4. Generate a new fix.',
      );
}

export class ReviewerDemoRepository implements FixRepository {
  readonly delivery = 'local-demo' as const;
  readonly repository = 'local-demo/reviewer-checkout';
  readonly paths = ['checkout.mjs'];
  readonly file: string;
  private root: string;
  constructor(
    directory: string,
    private verifyLive: (sha: string) => Promise<void>,
  ) {
    this.root = resolve(directory);
    this.file = join(this.root, 'checkout.mjs');
  }
  async initialize() {
    await mkdir(this.root, { recursive: true });
    this.root = await realpath(this.root);
    try {
      await writeFile(this.file, GOOD_CHECKOUT, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await this.source();
  }
  async source() {
    const info = await lstat(this.file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 4096 ||
      (await realpath(this.file)) !== join(this.root, 'checkout.mjs')
    )
      throw new Error(
        'Demo source must be the regular checkout.mjs file in its isolated directory.',
      );
    return readFile(this.file, 'utf8');
  }
  async observation() {
    const source = await this.source();
    let healthy = true;
    try {
      await testSource(source);
    } catch {
      healthy = false;
    }
    return { source, sha: digest(source), healthy };
  }
  async readSource(paths: string[]) {
    if (paths.length !== 1 || paths[0] !== 'checkout.mjs')
      throw new Error('Select checkout.mjs only.');
    const source = await this.source();
    const sha = digest(source);
    return {
      baseBranch: 'running-demo',
      baseCommit: sha,
      baseTree: sha,
      files: [{ path: 'checkout.mjs', content: source, mode: '100644' as const, sha }],
    };
  }
  async assertHead(context: FixContext) {
    if (
      context.repository !== this.repository ||
      context.baseCommit !== digest(await this.source())
    )
      throw new Error('Demo source changed. Read it again before deploying.');
  }
  async publish(): Promise<string> {
    throw new Error('This isolated demo does not publish GitHub PRs.');
  }
  private async replace(source: string) {
    const temporary = join(this.root, `.checkout-${randomUUID()}.mjs`);
    try {
      await writeFile(temporary, source, { flag: 'wx' });
      await this.source();
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async deploy(context: FixContext, draft: FixDraft) {
    if (draft.changes.length !== 1 || draft.changes[0]!.path !== 'checkout.mjs')
      throw new Error('Unexpected demo patch.');
    const change = draft.changes[0]!;
    await testSource(change.after);
    await this.assertHead(context);
    const before = await this.source();
    if (before !== change.before) throw new Error('The reviewed source no longer matches.');
    try {
      await this.replace(change.after);
    } catch {
      throw new FixDeploymentError(
        'Could not replace checkout.mjs on the PC. Check file permissions or an editor/file lock, then refresh health and inspect the file before generating a new fix.',
      );
    }
    try {
      await this.verifyLive(digest(change.after));
    } catch {
      try {
        if ((await this.source()) !== change.after)
          throw new Error('Source was edited during verification.');
        await this.replace(before);
      } catch {
        throw new FixDeploymentError(
          'Live HTTP verification failed and the previous source could not be safely restored. Inspect checkout.mjs and refresh health before continuing.',
        );
      }
      throw new FixDeploymentError(
        'Live HTTP verification failed. The previous PC source was restored. Check the demo service, then generate a new fix.',
      );
    }
  }
}

export function reviewerDemoService(repository: ReviewerDemoRepository) {
  return createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET') {
        response.writeHead(405).end('{}');
        return;
      }
      const { source, sha, healthy } = await repository.observation();
      if (url.pathname === '/health') {
        response.writeHead(healthy ? 200 : 503).end(
          JSON.stringify({
            serviceId: 'reviewer-checkout',
            serviceName: 'Reviewer Checkout',
            status: healthy ? 'healthy' : 'down',
            version: sha,
            checkedAt: new Date().toISOString(),
            checks: { api: 'healthy', checkout: healthy ? 'healthy' : 'failed' },
          }),
        );
      } else if (url.pathname === '/checkout') {
        const price = Number(url.searchParams.get('unitPrice'));
        const quantity = Number(url.searchParams.get('quantity'));
        if (
          !url.searchParams.has('unitPrice') ||
          !url.searchParams.has('quantity') ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isSafeInteger(quantity) ||
          quantity < 0
        ) {
          response.writeHead(400).end(JSON.stringify({ error: 'Invalid price or quantity' }));
          return;
        }
        response.end(
          JSON.stringify({ total: (await calculator(source))(price, quantity), version: sha }),
        );
      } else response.writeHead(404).end('{}');
    } catch {
      response.writeHead(503).end(JSON.stringify({ error: 'Demo source cannot be served.' }));
    }
  });
}
