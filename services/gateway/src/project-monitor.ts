import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { PushTokenSchema, type IncidentBundle, type TrackedProject } from '@pocketsre/contracts';
import { advanceMonitor, initialMonitorState } from '@pocketsre/incident-engine';

const observationSchema = z.object({
  url: z.string(),
  failures: z.number(),
  recoveries: z.number(),
  alertOpen: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  status: z.enum(['healthy', 'down', 'degraded', 'unknown']).nullable(),
  error: z.string().nullable(),
});
const subscriptionSchema = z.object({
  deviceId: z.string().uuid(),
  projectId: z.string().uuid(),
  token: PushTokenSchema,
});
const jobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  deviceId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  incidentId: z.string(),
  event: z.enum(['down', 'recovered']),
  createdAt: z.number(),
  nextAt: z.number(),
  attempts: z.number(),
  receiptId: z.string().nullable(),
  status: z.enum(['pending', 'receipt', 'sent', 'failed']),
  error: z.string().nullable(),
});
const ledgerSchema = z.object({
  gatewayId: z.string().uuid(),
  monitors: z.record(z.string(), observationSchema),
  subscriptions: z.array(subscriptionSchema).max(100),
  jobs: z.array(jobSchema).max(500),
});
type Ledger = z.infer<typeof ledgerSchema>;
export class PushDeliveryError extends Error {
  constructor(
    readonly permanent: boolean,
    readonly removeDevice = false,
  ) {
    super('Push delivery failed.');
  }
}
export interface PushTransport {
  send(token: string, job: Ledger['jobs'][number], gatewayId: string): Promise<string>;
  receipt(id: string): Promise<'pending' | 'sent'>;
}
export class ExpoPushTransport implements PushTransport {
  constructor(
    private accessToken?: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string, body: unknown) {
    const response = await this.fetcher(`https://exp.host/--/api/v2/push/${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PushDeliveryError(
        response.status >= 400 && response.status < 500 && response.status !== 429,
      );
    }
    // Only one ticket/receipt is requested, never an arbitrary user-supplied endpoint.
    const reader = response.body?.getReader();
    if (!reader) throw new PushDeliveryError(false);
    const decoder = new TextDecoder();
    let raw = '';
    let bytes = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) {
          raw += decoder.decode();
          break;
        }
        bytes += item.value.length;
        if (bytes > 64000) throw new PushDeliveryError(false);
        raw += decoder.decode(item.value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(raw) as { data?: unknown };
  }
  private ticket(value: unknown) {
    const result = z
      .object({
        status: z.enum(['ok', 'error']),
        id: z.string().optional(),
        details: z.object({ error: z.string().optional() }).optional(),
      })
      .parse(value);
    if (result.status === 'error')
      throw new PushDeliveryError(
        result.details?.error !== 'MessageRateExceeded',
        result.details?.error === 'DeviceNotRegistered',
      );
    return result;
  }
  async send(token: string, job: Ledger['jobs'][number], gatewayId: string) {
    const result = await this.request('send', {
      to: token,
      title: job.title,
      body: job.body,
      sound: 'default',
      channelId: 'project-health',
      data: { projectId: job.projectId, incidentId: job.incidentId, eventId: job.id, gatewayId },
    });
    const ticket = this.ticket(result.data);
    if (!ticket.id) throw new PushDeliveryError(false);
    return ticket.id;
  }
  async receipt(id: string) {
    const result = await this.request('getReceipts', { ids: [id] });
    const map = z.record(z.string(), z.unknown()).parse(result.data);
    if (!map[id]) return 'pending';
    this.ticket(map[id]);
    return 'sent';
  }
}

/** Serialized durable monitor state + delivery outbox. Store outside the source repository. */
export class ProjectMonitor {
  private state: Ledger = { gatewayId: randomUUID(), monitors: {}, subscriptions: [], jobs: [] };
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  constructor(
    private options: {
      path: string;
      list: () => Promise<TrackedProject[]>;
      probe: (id: string) => Promise<IncidentBundle>;
      push: PushTransport;
      intervalMs?: number;
      now?: () => number;
    },
  ) {}
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private load() {
    return (this.loaded ??= (async () => {
      try {
        const file = await open(this.options.path, 'r');
        try {
          if ((await file.stat()).size > 2_000_000) throw new Error('Monitor ledger too large.');
          this.state = ledgerSchema.parse(JSON.parse(await file.readFile('utf8')));
        } finally {
          await file.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })());
  }
  private async save(state: Ledger) {
    await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.options.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(ledgerSchema.parse(state)), {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, this.options.path);
      this.state = structuredClone(state);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.load();
      return work();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  subscribe(deviceId: string, projectId: string, token: string | null) {
    return this.serial(async () => {
      const next = structuredClone(this.state);
      next.subscriptions = next.subscriptions.filter(
        (s) => !(s.deviceId === deviceId && s.projectId === projectId),
      );
      // Token rotation updates this device's existing subscriptions too.
      if (token) {
        for (const s of next.subscriptions) if (s.deviceId === deviceId) s.token = token;
        next.subscriptions.push({ deviceId, projectId, token: PushTokenSchema.parse(token) });
      } else
        next.jobs = next.jobs.filter(
          (job) =>
            !(
              job.deviceId === deviceId &&
              job.projectId === projectId &&
              ['pending', 'receipt'].includes(job.status)
            ),
        );
      await this.save(next);
      return { gatewayId: next.gatewayId, enabled: !!token };
    });
  }
  async status(projectId: string, enabled: boolean) {
    await this.load();
    const state = this.state.monitors[projectId];
    return {
      enabled,
      lastCheckedAt: state?.lastCheckedAt ?? null,
      status: state?.status ?? null,
      alertOpen: state?.alertOpen ?? false,
      failures: state?.failures ?? 0,
      error: state?.error ?? null,
    };
  }
  async start() {
    await this.load();
    this.stopped = false;
    const run = async () => {
      try {
        await this.tick();
      } catch {
        /* Persisted previous state is preserved; status checks expose no invented success. */
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(() => void run(), this.options.intervalMs ?? 30000);
          this.timer.unref();
        }
      }
    };
    this.timer = setTimeout(() => void run(), 0);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.queue;
  }
  tick() {
    return this.serial(async () => {
      const projects = await this.options.list();
      const enabled = new Set(projects.filter((p) => p.monitoring && p.healthUrl).map((p) => p.id));
      for (const project of projects) {
        const next = structuredClone(this.state);
        if (!enabled.has(project.id)) {
          delete next.monitors[project.id];
          await this.save(next);
          continue;
        }
        let previous = next.monitors[project.id];
        if (!previous || previous.url !== project.healthUrl) {
          next.jobs = next.jobs.filter((job) => job.projectId !== project.id);
          previous = {
            url: project.healthUrl!,
            ...initialMonitorState(),
            lastCheckedAt: null,
            status: null,
            error: null,
          };
        }
        try {
          const bundle = await this.options.probe(project.id);
          const transition = advanceMonitor(previous, bundle.serviceHealth.status);
          next.monitors[project.id] = {
            ...previous,
            ...transition.state,
            status: bundle.serviceHealth.status,
            lastCheckedAt: bundle.serviceHealth.checkedAt,
            error: null,
          };
          if (transition.event) {
            for (const sub of next.subscriptions.filter((s) => s.projectId === project.id))
              next.jobs.push({
                id: randomUUID(),
                projectId: project.id,
                deviceId: sub.deviceId,
                title: transition.event === 'down' ? 'Project down' : 'Project recovered',
                body: `${project.repository.fullName}: ${transition.event === 'down' ? 'two consecutive availability checks failed.' : 'two consecutive availability checks passed.'}`,
                incidentId: bundle.incident.id,
                event: transition.event,
                createdAt: this.now(),
                nextAt: this.now(),
                attempts: 0,
                receiptId: null,
                status: 'pending',
                error: null,
              });
          }
        } catch {
          next.monitors[project.id] = {
            ...previous,
            failures: 0,
            recoveries: 0,
            status: 'unknown',
            lastCheckedAt: new Date(this.now()).toISOString(),
            error: 'The gateway could not complete this check.',
          };
        }
        next.jobs = next.jobs.filter((j) => this.now() - j.createdAt < 86400000).slice(-500);
        await this.save(next); // Persist transition + outbox together before any external send.
      }
      const latest = await this.options.list();
      const active = new Set(
        latest
          .filter((p) => p.monitoring && p.healthUrl === this.state.monitors[p.id]?.url)
          .map((p) => p.id),
      );
      const next = structuredClone(this.state);
      for (const key of Object.keys(next.monitors)) if (!active.has(key)) delete next.monitors[key];
      next.jobs = next.jobs.filter(
        (j) => active.has(j.projectId) && this.now() - j.createdAt < 86400000,
      );
      next.subscriptions = next.subscriptions.filter((s) =>
        latest.some((p) => p.id === s.projectId),
      );
      await this.save(next);
      for (const job of this.state.jobs
        .filter((j) => ['pending', 'receipt'].includes(j.status) && j.nextAt <= this.now())
        .slice(0, 2)) {
        const update = structuredClone(this.state);
        const current = update.jobs.find((j) => j.id === job.id)!;
        const sub = update.subscriptions.find(
          (s) => s.deviceId === job.deviceId && s.projectId === job.projectId,
        );
        if (!sub) {
          current.status = 'failed';
          await this.save(update);
          continue;
        }
        try {
          if (current.receiptId) {
            const receipt = await this.options.push.receipt(current.receiptId);
            current.status = receipt === 'sent' ? 'sent' : 'receipt';
            current.nextAt = this.now() + 15 * 60000;
          } else {
            current.attempts++;
            // Reserve the attempt before sending. Lost responses may duplicate delivery on retry.
            current.nextAt = this.now() + 60000;
            await this.save(update);
            current.receiptId = await this.options.push.send(
              sub.token,
              current,
              this.state.gatewayId,
            );
            current.status = 'receipt';
            current.nextAt = this.now() + 15 * 60000;
          }
          current.error = null;
        } catch (error) {
          current.error = 'Notification delivery could not be confirmed.';
          if (error instanceof PushDeliveryError && error.removeDevice)
            update.subscriptions = update.subscriptions.filter((s) => s.token !== sub.token);
          if (current.attempts >= 5 || (error instanceof PushDeliveryError && error.permanent))
            current.status = 'failed';
          current.nextAt = this.now() + Math.min(3600000, 30000 * 2 ** current.attempts);
        }
        await this.save(update);
      }
    });
  }
}
