import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  ServiceHealthSchema,
  EvidenceEventSchema,
  type ServiceHealth,
  type EvidenceEvent,
  type IncidentBundle,
} from '@pocketsre/contracts';
import { redactEvidence, sanitizeBundle } from '@pocketsre/incident-engine';
import { IncidentStore, DEFAULT_RETENTION } from './incidents.js';

type Fetch = typeof globalThis.fetch;
export interface EvidenceConnector {
  readonly name: string;
  collect(since: string): Promise<EvidenceEvent[]>;
}

function request(url: string, token: string | undefined, fetcher: Fetch, timeoutMs = 8_000) {
  return fetcher(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'user-agent': 'PocketSRE/0.1',
    },
  });
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provider response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) throw new Error('Provider response exceeds 2 MB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function getJson(url: string, token: string | undefined, fetcher: Fetch): Promise<unknown> {
  const response = await request(url, token, fetcher);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Provider HTTP ${response.status}`);
  }
  return readJson(response);
}

const CommitSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  html_url: z.string().url(),
  commit: z.object({
    message: z.string(),
    committer: z.object({ date: z.string().datetime({ offset: true }) }).nullable(),
  }),
});
const DetailSchema = CommitSchema.extend({
  files: z.array(z.object({ filename: z.string(), patch: z.string().optional() })).default([]),
});

export class GitHubConnector implements EvidenceConnector {
  readonly name = 'GitHub';
  constructor(
    private readonly repository: string,
    private readonly token?: string,
    private readonly fetcher: Fetch = fetch,
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw new Error('GITHUB_REPOSITORY must be owner/repo');
  }
  async collect(since: string): Promise<EvidenceEvent[]> {
    const base = `https://api.github.com/repos/${this.repository}/commits`;
    const commits = z
      .array(CommitSchema)
      .parse(
        await getJson(
          `${base}?per_page=5&since=${encodeURIComponent(since)}`,
          this.token,
          this.fetcher,
        ),
      );
    const details = await Promise.all(
      commits
        .slice(0, 5)
        .map(async (commit) =>
          DetailSchema.parse(await getJson(`${base}/${commit.sha}`, this.token, this.fetcher)),
        ),
    );
    return details.flatMap((commit): EvidenceEvent[] => {
      if (!commit.commit.committer) return [];
      const timestamp = new Date(commit.commit.committer.date).toISOString();
      const common = {
        source: 'github' as const,
        timestamp,
        externalUrl: commit.html_url,
        metadata: { commitSha: commit.sha, repository: this.repository },
      };
      const events: EvidenceEvent[] = [
        {
          ...common,
          id: `github:${commit.sha}`,
          type: 'commit',
          title: commit.commit.message.split('\n')[0]!.slice(0, 200),
          excerpt: commit.commit.message.slice(0, 1500),
        },
      ];
      for (const file of commit.files.slice(0, 10)) {
        if (!file.patch) continue;
        events.push({
          ...common,
          id: `github:${commit.sha}:${file.filename}`,
          type: /config|environment|\.env|database|migration|deploy/i.test(file.filename)
            ? 'configuration_changed'
            : 'commit',
          title: `Changed ${file.filename}`,
          excerpt: file.patch.slice(0, 2000),
          metadata: { ...common.metadata, file: file.filename },
        });
      }
      return events.map(redactEvidence);
    });
  }
}

const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  culprit: z.string().optional(),
  permalink: z.string().url(),
  firstSeen: z.string().datetime({ offset: true }),
  lastSeen: z.string().datetime({ offset: true }),
  count: z.string().optional(),
});

export class SentryConnector implements EvidenceConnector {
  readonly name = 'Sentry';
  constructor(
    private readonly organization: string,
    private readonly project: string,
    private readonly token: string,
    private readonly fetcher: Fetch = fetch,
  ) {
    if (![organization, project].every((part) => /^[a-zA-Z0-9_-]+$/.test(part)))
      throw new Error('Invalid Sentry project slug');
  }
  async collect(since: string): Promise<EvidenceEvent[]> {
    const query = encodeURIComponent(`is:unresolved lastSeen:>=${since}`);
    const url = `https://sentry.io/api/0/projects/${this.organization}/${this.project}/issues/?limit=10&sort=date&query=${query}`;
    const issues = z.array(IssueSchema).parse(await getJson(url, this.token, this.fetcher));
    return issues.slice(0, 10).map((issue) =>
      redactEvidence({
        id: `sentry:${issue.id}:${new Date(issue.lastSeen).toISOString()}`,
        source: 'sentry',
        type: 'exception',
        timestamp: new Date(issue.lastSeen).toISOString(),
        title: issue.title,
        excerpt: `${issue.title}\nLocation: ${issue.culprit ?? 'not provided'}\nOccurrences: ${issue.count ?? 'unknown'}`,
        externalUrl: issue.permalink,
        metadata: { issueId: issue.id, firstSeen: issue.firstSeen, lastSeen: issue.lastSeen },
      }),
    );
  }
}

export interface LiveBundleOptions {
  healthUrl: string;
  serviceId: string;
  serviceName: string;
  healthToken?: string;
  incidentPath?: string;
  connectors: EvidenceConnector[];
  fetcher?: Fetch;
  now?: () => number;
  healthTimeoutMs?: number;
  healthMaxAgeMs?: number;
}

type CollectionEntry = NonNullable<IncidentBundle['collection']>[number];
type HealthObservation = {
  health: ServiceHealth;
  evidence: EvidenceEvent;
  collection: CollectionEntry;
};
const ObservedHealthSchema = ServiceHealthSchema.extend({
  status: z.enum(['healthy', 'degraded', 'down']),
});

async function collectHealth(options: LiveBundleOptions): Promise<HealthObservation> {
  const now = options.now ?? Date.now;
  let httpStatus: number | undefined;
  let reason = 'network_error';
  let observed: ServiceHealth | undefined;
  try {
    const response = await request(
      options.healthUrl,
      options.healthToken,
      options.fetcher ?? fetch,
      options.healthTimeoutMs,
    );
    httpStatus = response.status;
    if (response.ok || response.status >= 500) {
      reason = 'invalid_response';
      const parsed = ObservedHealthSchema.safeParse(await readJson(response));
      if (parsed.success) {
        const age = now() - Date.parse(parsed.data.checkedAt);
        if (parsed.data.serviceId !== options.serviceId) reason = 'service_mismatch';
        else if (age > (options.healthMaxAgeMs ?? 60_000)) reason = 'stale_response';
        else if (age < -5_000) reason = 'future_response';
        else if (!response.ok && parsed.data.status === 'healthy') reason = 'conflicting_response';
        else {
          observed = { ...parsed.data, serviceName: options.serviceName };
          reason = 'observed';
        }
      }
    } else {
      reason = 'http_error';
      await response.body?.cancel().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      reason = 'timeout';
    // Never expose exception strings, response bodies, URLs or credentials.
  }
  return healthObservation(options, reason, httpStatus, observed);
}

function healthObservation(
  options: LiveBundleOptions,
  reason: string,
  httpStatus?: number,
  observed?: ServiceHealth,
): HealthObservation {
  const checkedAt = new Date((options.now ?? Date.now)()).toISOString();
  const endpointFailed = httpStatus !== undefined && httpStatus >= 500;
  const health: ServiceHealth = observed ?? {
    serviceId: options.serviceId,
    serviceName: options.serviceName,
    status: endpointFailed ? 'down' : 'unknown',
    version: null,
    checkedAt,
    checks: {},
  };
  const message = observed
    ? `Health endpoint reports ${observed.status}.`
    : endpointFailed
      ? `Health endpoint returned HTTP ${httpStatus}. Current component health and release could not be established (${reason}).`
      : `Current service health and release are unknown (${reason}${httpStatus ? `, HTTP ${httpStatus}` : ''}). This does not establish which component failed.`;
  const evidence: EvidenceEvent = {
    id: `health:${randomUUID()}`,
    source: 'health',
    type:
      health.status === 'unknown'
        ? 'health_check_unavailable'
        : health.status === 'healthy'
          ? 'health_check_passed'
          : 'health_check_failed',
    timestamp: checkedAt,
    title: `${options.serviceName}: ${observed ? health.status : endpointFailed ? 'health endpoint failure' : 'health unknown'}`,
    excerpt: observed ? `${message}\n${JSON.stringify(observed.checks)}` : message,
    metadata: {
      reason,
      ...(httpStatus !== undefined ? { httpStatus: String(httpStatus) } : {}),
      ...(observed ? { healthCheckedAt: observed.checkedAt } : {}),
      ...(observed?.version ? { release: observed.version } : {}),
    },
  };
  return {
    health,
    evidence,
    collection: {
      source: 'Health',
      status: observed ? 'ok' : 'unavailable',
      checkedAt,
      message,
      evidenceIds: [evidence.id],
    },
  };
}

export function createLiveBundleLoader(options: LiveBundleOptions) {
  const url = new URL(options.healthUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('HEALTH_URL must be an HTTP(S) URL without credentials or query parameters');
  if (!options.serviceId.trim() || !options.serviceName.trim())
    throw new Error('HEALTH_SERVICE_ID and HEALTH_SERVICE_NAME are required for live collection');
  for (const limit of [options.healthTimeoutMs, options.healthMaxAgeMs]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
      throw new Error('Health time limits must be positive integers');
  }
  const store = new IncidentStore(options.serviceId, options.incidentPath);
  const now = options.now ?? Date.now;
  let pending: Promise<unknown> = Promise.resolve();
  let storageWarningRecorded = false;

  async function collect(): Promise<IncidentBundle> {
    await store.load();
    const previous = store.current;
    const started = now();
    const since = new Date(
      Math.max(
        previous && previous.incident.status !== 'resolved'
          ? Date.parse(previous.incident.startedAt) - 3_600_000
          : started - 3_600_000,
        started - DEFAULT_RETENTION.evidenceAgeMs,
      ),
    ).toISOString();
    // Health and all providers start independently, including on an unavailable cold start.
    const [healthResult, results] = await Promise.all([
      collectHealth(options),
      Promise.allSettled(
        options.connectors.map(async (connector) =>
          z.array(EvidenceEventSchema).parse(await connector.collect(since)),
        ),
      ),
    ]);
    const generatedAt = new Date(now()).toISOString();
    // A slow provider must not turn a once-fresh observation into a stale recovery claim.
    const observation =
      healthResult.collection.status === 'ok' &&
      Date.parse(generatedAt) - Date.parse(healthResult.health.checkedAt) >
        (options.healthMaxAgeMs ?? 60_000)
        ? healthObservation(
            options,
            'stale_response',
            Number(healthResult.evidence.metadata.httpStatus),
          )
        : healthResult;
    const health = observation.health;
    const unhealthy = health.status !== 'healthy';
    const previousIncident = previous?.incident;
    const newIncident = !previousIncident || (previousIncident.status === 'resolved' && unhealthy);
    const incident: IncidentBundle['incident'] = {
      id: newIncident ? randomUUID() : previousIncident.id,
      serviceId: options.serviceId,
      title: `${options.serviceName} health incident`,
      status: unhealthy ? 'open' : 'resolved',
      // Losing observability never resolves or downgrades an existing confirmed outage.
      severity:
        health.status === 'healthy'
          ? 'info'
          : health.status === 'unknown'
            ? !newIncident && previousIncident.severity === 'critical'
              ? 'critical'
              : 'warning'
            : 'critical',
      startedAt: newIncident ? new Date(started).toISOString() : previousIncident.startedAt,
      lastUpdatedAt: generatedAt,
    };
    const evidence: EvidenceEvent[] = [observation.evidence];
    const collection: CollectionEntry[] = [observation.collection];
    results.forEach((result, index) => {
      const source = options.connectors[index]!.name;
      if (result.status === 'fulfilled') {
        evidence.push(...result.value);
        collection.push({
          source,
          status: 'ok',
          checkedAt: generatedAt,
          message: `${result.value.length} evidence items collected.`,
        });
      } else {
        const id = `collection:${randomUUID()}`;
        const message =
          'Could not collect evidence. Check credentials, permissions, rate limits, and connectivity.';
        evidence.push({
          id,
          source: 'gateway',
          type: 'collection_failed',
          timestamp: generatedAt,
          title: `${source} evidence unavailable`,
          excerpt: message,
          metadata: { connector: source },
        });
        collection.push({
          source,
          status: 'unavailable',
          checkedAt: generatedAt,
          message,
          evidenceIds: [id],
        });
      }
    });
    if (store.recoveredCorruptStorage) {
      const id = `storage:${randomUUID()}`;
      const message =
        'Corrupt incident storage was quarantined. Earlier incident identity and evidence could not be restored.';
      if (!storageWarningRecorded)
        evidence.push({
          id,
          source: 'gateway',
          type: 'collection_failed',
          timestamp: generatedAt,
          title: 'Incident continuity unavailable',
          excerpt: message,
          metadata: { reason: 'storage_corrupt' },
        });
      collection.push({
        source: 'Incident storage',
        status: 'unavailable',
        checkedAt: generatedAt,
        message,
        ...(!storageWarningRecorded ? { evidenceIds: [id] } : {}),
      });
    }
    const bundle = await store.save(
      sanitizeBundle({
        schemaVersion: 1,
        generatedAt,
        incident,
        serviceHealth: health,
        evidence,
        collection,
      }),
    );
    storageWarningRecorded = true;
    return bundle;
  }
  function loadBundle(): Promise<IncidentBundle> {
    const next = pending.then(collect);
    pending = next.catch(() => undefined);
    return next;
  }
  return Object.assign(loadBundle, { initialize: () => store.load() });
}
