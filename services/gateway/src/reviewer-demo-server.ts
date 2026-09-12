import { resolve } from 'node:path';
import { createGatewayApp } from './app.js';
import { createLiveBundleLoader } from './connectors.js';
import { ReviewerDemoRepository, reviewerDemoService, CHECKOUT_CASES } from './reviewer-demo.js';

const directory = resolve(process.env.REVIEWER_DEMO_DIR ?? '../../.pocketsre-data/reviewer-demo');
const servicePort = Number(process.env.REVIEWER_SERVICE_PORT ?? 4310);
const gatewayPort = Number(process.env.REVIEWER_GATEWAY_PORT ?? 4101);
const serviceUrl = `http://127.0.0.1:${servicePort}`;
const repository = new ReviewerDemoRepository(directory, async (sha) => {
  const health = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(5000) });
  const value = (await health.json()) as { status: string; version: string };
  if (!health.ok || value.status !== 'healthy' || value.version !== sha)
    throw new Error('Live health did not verify the new source.');
  for (const [price, quantity, expected] of CHECKOUT_CASES) {
    const result = await fetch(`${serviceUrl}/checkout?unitPrice=${price}&quantity=${quantity}`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await result.json()) as { total: number; version: string };
    if (!result.ok || body.total !== expected || body.version !== sha)
      throw new Error('Live checkout probe failed.');
  }
});
await repository.initialize();
const service = reviewerDemoService(repository);
await new Promise<void>((done, reject) => {
  service.once('error', reject);
  service.listen(servicePort, '127.0.0.1', done);
});
const loadBundle = createLiveBundleLoader({
  healthUrl: `${serviceUrl}/health`,
  serviceId: 'reviewer-checkout',
  serviceName: 'Reviewer Checkout',
  incidentPath: resolve(directory, 'incidents.json'),
  connectors: [
    {
      name: 'Demo source',
      async collect() {
        const { source, sha } = await repository.observation();
        return [
          {
            id: `demo-source:${sha}`,
            source: 'investigator' as const,
            type: 'investigation_result' as const,
            timestamp: new Date().toISOString(),
            title: 'Running checkout source and business contract',
            excerpt: `checkout.mjs must multiply unit price by quantity: 10 x 3 = 30; 5 x 0 = 0; 7 x 4 = 28. Running source:\n${source}`,
            metadata: { release: sha, file: 'checkout.mjs' },
          },
        ];
      },
    },
  ],
});
const app = createGatewayApp({
  loadBundle,
  fixRepository: repository,
  auditPath: resolve(directory, 'actions.json'),
});
await loadBundle.initialize();
await app.listen({ host: '127.0.0.1', port: gatewayPort });
console.info(
  `Reviewer demo source: ${repository.file}\nService: ${serviceUrl}\nPhone gateway: http://127.0.0.1:${gatewayPort}`,
);
async function close() {
  await app.close();
  service.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
