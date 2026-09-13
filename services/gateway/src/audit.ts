import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AuditEntrySchema, type AuditEntry } from '@pocketsre/contracts';
import { z } from 'zod';

const RecordSchema = z.object({ entry: AuditEntrySchema, fingerprint: z.string() });
type StoredAction = z.infer<typeof RecordSchema>;

/** Single-process ledger. In-flight records survive restarts and are never automatically retried. */
export class AuditStore {
  private records = new Map<string, StoredAction>();
  constructor(private readonly path?: string) {}
  async load() {
    if (!this.path) return;
    try {
      const records = z.array(RecordSchema).parse(JSON.parse(await readFile(this.path, 'utf8')));
      this.records = new Map(records.map((record) => [record.entry.requestId, record]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  get(id: string) {
    return this.records.get(id);
  }
  list(limit = 100): AuditEntry[] {
    return [...this.records.values()]
      .map((item) => item.entry)
      .reverse()
      .slice(0, limit);
  }
  async save(entry: AuditEntry, fingerprint: string) {
    this.records.set(entry.requestId, { entry, fingerprint });
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(`${this.path}.tmp`, JSON.stringify([...this.records.values()]), {
      mode: 0o600,
    });
    await rename(`${this.path}.tmp`, this.path);
  }
}
