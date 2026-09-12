import { loadEnvFile } from 'node:process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Private local credentials never need to live in the checkout or mobile bundle. */
export function loadPrivateGatewayEnvironment(
  path = resolve(homedir(), '.pocketsre', 'gateway.env'),
) {
  try {
    // Node preserves values already supplied by the process or service .env.
    loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
