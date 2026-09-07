import { createDemoApp } from './app.js';

const port = Number(process.env.DEMO_SERVICE_PORT ?? 4200);
const host = process.env.DEMO_SERVICE_HOST ?? '0.0.0.0';
const app = createDemoApp();

try {
  await app.listen({ port, host });
  app.log.info(`PocketSRE demo service listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
