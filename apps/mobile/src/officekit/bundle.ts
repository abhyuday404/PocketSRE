import type { IncidentBundle } from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';

export function serializeOfficeKitBundle(bundle: IncidentBundle): string {
  return JSON.stringify(sanitizeBundle(bundle), null, 2);
}
