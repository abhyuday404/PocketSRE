import { createDemoApp } from './app.js';

const port = Number(process.env.DEMO_SERVICE_PORT ?? 4200);
const host = process.env.DEMO_SERVICE_HOST ?? '127.0.0.1';
const app = createDemoApp();

try {
  await app.listen({ port, host });
  console.info(`PocketSRE demo service listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
