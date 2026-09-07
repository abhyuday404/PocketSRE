import { createGatewayApp } from './app.js';
import { resolve } from 'node:path';

const port = Number(process.env.GATEWAY_PORT ?? 4100);
const host = process.env.GATEWAY_HOST ?? '127.0.0.1';
if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.GATEWAY_ACCESS_TOKEN) {
  throw new Error('GATEWAY_ACCESS_TOKEN is required when binding to the LAN.');
}
const app = createGatewayApp({
  demoServiceUrl: process.env.DEMO_SERVICE_URL,
  accessToken: process.env.GATEWAY_ACCESS_TOKEN,
  auditPath: resolve(process.env.AUDIT_PATH ?? '.pocketsre-data/actions.json'),
});

try {
  await app.listen({ port, host });
  app.log.info(`PocketSRE gateway listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
