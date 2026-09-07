import { File, Paths } from 'expo-file-system';
import { IncidentBundleSchema, type IncidentBundle } from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';

const cache = () => new File(Paths.document, 'pocketsre-incidents.json');
type CachedRecord = { gateway: string; bundle: IncidentBundle };

export async function readIncidentHistory(gateway: string): Promise<IncidentBundle[]> {
  const file = cache();
  if (!file.exists) return [];
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((record: CachedRecord) => record.gateway === gateway)
      .flatMap((record: CachedRecord) => {
        const result = IncidentBundleSchema.safeParse(record.bundle);
        return result.success ? [sanitizeBundle(result.data)] : [];
      })
      .slice(0, 10);
  } catch {
    return [];
  }
}

export async function cacheIncident(gateway: string, bundle: IncidentBundle): Promise<void> {
  const previous = await readIncidentHistory(gateway);
  const records = [
    sanitizeBundle(bundle),
    ...previous.filter((item) => item.incident.id !== bundle.incident.id),
  ].slice(0, 10);
  const file = cache();
  file.create({ overwrite: true });
  file.write(JSON.stringify(records.map((item) => ({ gateway, bundle: item }))));
}

export function clearIncidentCache(): void {
  const file = cache();
  if (file.exists) file.delete();
}
