import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ServiceHealthSchema, type EvidenceEvent, type IncidentBundle } from '@pocketsre/contracts';
import { redactEvidence, sanitizeBundle } from '@pocketsre/incident-engine';

type Fetch = typeof globalThis.fetch;
export interface EvidenceConnector {
  readonly name: string;
  collect(since: string): Promise<EvidenceEvent[]>;
}

async function getJson(url: string, token: string | undefined, fetcher: Fetch): Promise<unknown> {
  const response = await fetcher(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'user-agent': 'PocketSRE/0.1',
    },
  });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
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
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
        id: `sentry:${issue.id}`,
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

export function createLiveBundleLoader(options: {
  healthUrl: string;
  healthToken?: string;
  connectors: EvidenceConnector[];
  fetcher?: Fetch;
}) {
  const url = new URL(options.healthUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search)
    throw new Error('HEALTH_URL must be an HTTP(S) URL without credentials or query parameters');
  let current: IncidentBundle['incident'] | undefined;
  return async (): Promise<IncidentBundle> => {
    const health = ServiceHealthSchema.parse(
      await getJson(url.toString(), options.healthToken, options.fetcher ?? fetch),
    );
    const generatedAt = new Date().toISOString();
    const unhealthy = health.status !== 'healthy';
    if (!current || (current.status === 'resolved' && unhealthy)) {
      current = {
        id: randomUUID(),
        serviceId: health.serviceId,
        title: `${health.serviceName} health incident`,
        severity: unhealthy ? 'critical' : 'info',
        status: unhealthy ? 'open' : 'resolved',
        startedAt: generatedAt,
        lastUpdatedAt: generatedAt,
      };
    }
    current = {
      ...current,
      status: unhealthy ? 'open' : 'resolved',
      severity: unhealthy ? 'critical' : 'info',
      lastUpdatedAt: generatedAt,
    };
    const incident = { ...current };
    const since = new Date(Date.parse(incident.startedAt) - 3_600_000).toISOString();
    const results = await Promise.allSettled(
      options.connectors.map((connector) => connector.collect(since)),
    );
    const evidence: EvidenceEvent[] = [
      {
        id: `health:${current.id}:${health.version}:${health.status}`,
        source: 'health',
        type: unhealthy ? 'health_check_failed' : 'health_check_passed',
        timestamp: health.checkedAt,
        title: `${health.serviceName}: ${health.status}`,
        excerpt: JSON.stringify(health.checks),
        metadata: { release: health.version },
      },
    ];
    const collection = results.map((result, index) => {
      const source = options.connectors[index]!.name;
      if (result.status === 'fulfilled') {
        evidence.push(...result.value);
        return {
          source,
          status: 'ok' as const,
          message: `${result.value.length} evidence items collected.`,
        };
      }
      return {
        source,
        status: 'unavailable' as const,
        message:
          'Could not collect evidence. Check credentials, permissions, rate limits, and connectivity.',
      };
    });
    return sanitizeBundle({
      schemaVersion: 1,
      generatedAt,
      incident,
      serviceHealth: health,
      evidence,
      collection,
    });
  };
}
