import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { IncidentBundleSchema, type IncidentBundle } from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';
import { z } from 'zod';

const StateSchema = z.object({
  schemaVersion: z.literal(1),
  serviceId: z.string().min(1),
  current: IncidentBundleSchema.nullable(),
  history: z.array(IncidentBundleSchema),
});
type IncidentState = z.infer<typeof StateSchema>;

const DAY = 86_400_000;
const MAX_STORAGE_BYTES = 32_000_000;
export const DEFAULT_RETENTION = {
  maxEvidence: 500,
  evidenceAgeMs: 7 * DAY,
  maxHistory: 20,
  historyAgeMs: 30 * DAY,
};

/** One service, one gateway process per file. Refreshes must be serialized by the loader. */
export class IncidentStore {
  private state: IncidentState;
  private loading?: Promise<void>;
  private readonly retention: typeof DEFAULT_RETENTION;
  recoveredCorruptStorage = false;

  constructor(
    private readonly serviceId: string,
    private readonly path?: string,
    retention: Partial<typeof DEFAULT_RETENTION> = {},
  ) {
    this.state = { schemaVersion: 1, serviceId, current: null, history: [] };
    this.retention = { ...DEFAULT_RETENTION, ...retention };
    if (Object.values(this.retention).some((value) => !Number.isSafeInteger(value) || value < 1))
      throw new Error('Incident retention limits must be positive integers');
  }

  load(): Promise<void> {
    return (this.loading ??= this.loadFromDisk());
  }

  private async loadFromDisk() {
    if (!this.path) return;
    let contents: string;
    try {
      const file = await open(this.path, 'r');
      try {
        if ((await file.stat()).size > MAX_STORAGE_BYTES) {
          contents = ''; // Oversized state is corrupt; never read it into memory.
        } else contents = await file.readFile('utf8');
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      await this.quarantine();
      return;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'schemaVersion' in parsed &&
      parsed.schemaVersion !== 1
    )
      throw new Error('Unsupported incident storage version; use a compatible gateway');
    const validated = StateSchema.safeParse(parsed);
    if (!validated.success) {
      await this.quarantine();
      return;
    }
    const state = validated.data;
    if (state.serviceId !== this.serviceId)
      throw new Error('INCIDENT_PATH belongs to another service; choose a separate file');
    const bundles = [...state.history, ...(state.current ? [state.current] : [])];
    if (
      bundles.some(
        (bundle) =>
          bundle.incident.serviceId !== this.serviceId ||
          bundle.serviceHealth.serviceId !== this.serviceId,
      )
    ) {
      await this.quarantine();
      return;
    }
    this.state = {
      ...state,
      current: state.current ? sanitizeBundle(state.current) : null,
      history: state.history.map(sanitizeBundle),
    };
  }

  private async quarantine() {
    // Preserve the file for operator inspection. Do not print its contents or ingest them as evidence.
    await rename(this.path!, `${this.path}.corrupt-${Date.now()}-${randomUUID()}`);
    this.recoveredCorruptStorage = true;
  }

  get current(): IncidentBundle | null {
    return this.state.current ? structuredClone(this.state.current) : null;
  }

  private retain(bundle: IncidentBundle, now: number): IncidentBundle {
    const evidence = [...new Map(bundle.evidence.map((event) => [event.id, event])).values()]
      .filter((event) => Date.parse(event.timestamp) >= now - this.retention.evidenceAgeMs)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
      .slice(-this.retention.maxEvidence);
    const ids = new Set(evidence.map((event) => event.id));
    return {
      ...bundle,
      evidence,
      collection: bundle.collection?.map((item) => ({
        ...item,
        evidenceIds: item.evidenceIds?.filter((id) => ids.has(id)),
      })),
    };
  }

  async save(bundle: IncidentBundle): Promise<IncidentBundle> {
    await this.load();
    const clean = sanitizeBundle(IncidentBundleSchema.parse(bundle));
    if (
      clean.incident.serviceId !== this.serviceId ||
      clean.serviceHealth.serviceId !== this.serviceId
    )
      throw new Error('Cannot persist evidence for another service');
    const previous = this.state.current;
    const sameIncident = previous?.incident.id === clean.incident.id;
    const now = Date.parse(clean.generatedAt);
    const current = this.retain(
      {
        ...clean,
        evidence: [...(sameIncident ? previous.evidence : []), ...clean.evidence],
      },
      now,
    );
    const history = [...this.state.history, ...(!sameIncident && previous ? [previous] : [])]
      .filter(
        (item) => Date.parse(item.incident.lastUpdatedAt) >= now - this.retention.historyAgeMs,
      )
      .slice(-this.retention.maxHistory)
      .map((item) => this.retain(item, now));
    const next: IncidentState = { ...this.state, current, history };
    if (this.path) {
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > MAX_STORAGE_BYTES)
        throw new Error('Incident storage exceeds its size limit');
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(serialized);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, this.path);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    // A failed write must not advance memory past durable state.
    this.state = next;
    return structuredClone(current);
  }
}
