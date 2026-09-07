import { createGatewayApp } from './app.js';

const port = Number(process.env.GATEWAY_PORT ?? 4100);
const host = process.env.GATEWAY_HOST ?? '0.0.0.0';
const app = createGatewayApp();

try {
  await app.listen({ port, host });
  app.log.info(`PocketSRE gateway listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
