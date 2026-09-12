import { z } from 'zod';
import { RepositoryPathSchema, type FixContext, type FixDraft } from '@pocketsre/contracts';
import { containsCredential, isFixPathAllowed } from '@pocketsre/incident-engine';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const commitSchema = z.object({ sha, tree: z.object({ sha }) });
const objectSchema = z.object({ sha });
export interface FixRepository {
  readonly repository: string;
  readonly paths: string[];
  readSource(
    paths: string[],
  ): Promise<Pick<FixContext, 'baseBranch' | 'baseCommit' | 'baseTree' | 'files'>>;
  assertHead(context: FixContext): Promise<void>;
  publish(context: FixContext, draft: FixDraft): Promise<string>;
}

export class GitHubFixRepository implements FixRepository {
  constructor(
    readonly repository: string,
    readonly paths: string[],
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      (!token.trim() && fetcher === fetch)
    )
      throw new Error('GitHub fixes require a repository and a dedicated token.');
    if (
      !paths.length ||
      paths.length > 20 ||
      paths.some((path) => !RepositoryPathSchema.safeParse(path).success || !isFixPathAllowed(path))
    )
      throw new Error('Configure up to 20 allowed source paths for GitHub fixes.');
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        accept: 'application/vnd.github+json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        'content-type': 'application/json',
        'user-agent': 'PocketSRE/0.1',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub request failed (${response.status}).`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('GitHub returned an empty response.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2_000_000) throw new Error('GitHub source response is too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  private async head(branch: string) {
    return z
      .object({ object: objectSchema })
      .parse(await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  }

  async readSource(paths: string[]) {
    if (
      !paths.length ||
      paths.length > 3 ||
      new Set(paths).size !== paths.length ||
      paths.some((path) => !this.paths.includes(path))
    )
      throw new Error('Select up to three configured source files.');
    const { default_branch: baseBranch } = z
      .object({ default_branch: z.string().min(1) })
      .parse(await this.request(''));
    const baseCommit = await this.head(baseBranch);
    const commit = commitSchema.parse(await this.request(`/git/commits/${baseCommit}`));
    const tree = z
      .object({
        truncated: z.boolean(),
        tree: z.array(
          z.object({
            path: z.string(),
            mode: z.string(),
            type: z.string(),
            sha,
            size: z.number().optional(),
          }),
        ),
      })
      .parse(await this.request(`/git/trees/${commit.tree.sha}?recursive=1`));
    if (tree.truncated)
      throw new Error('Repository tree is too large for this bounded source reader.');
    const files: FixContext['files'] = [];
    let size = 0;
    for (const path of paths) {
      const entry = tree.tree.find((item) => item.path === path);
      if (
        !entry ||
        entry.type !== 'blob' ||
        !['100644', '100755'].includes(entry.mode) ||
        (entry.size ?? Infinity) > 12000
      )
        throw new Error('Only small, regular source files can be read for a fix.');
      const blob = z
        .object({ sha, encoding: z.literal('base64'), content: z.string() })
        .parse(await this.request(`/git/blobs/${entry.sha}`));
      if (blob.sha !== entry.sha) throw new Error('Source identity mismatch.');
      const bytes = Buffer.from(blob.content, 'base64');
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      size += bytes.length;
      if (size > 12000 || content.includes('\0') || containsCredential(content))
        throw new Error('Source is too large, binary, or contains a credential.');
      files.push({ path, sha: entry.sha, mode: entry.mode as '100644' | '100755', content });
    }
    return { baseBranch, baseCommit, baseTree: commit.tree.sha, files };
  }

  async assertHead(context: FixContext) {
    if (
      context.repository !== this.repository ||
      (await this.head(context.baseBranch)) !== context.baseCommit
    )
      throw new Error('The repository changed. Read the latest source and generate a new fix.');
  }

  /** Called only through the gateway action boundary after an immutable draft is approved. */
  async publish(context: FixContext, draft: FixDraft) {
    await this.assertHead(context);
    const branch = `pocketsre/fix-${draft.id}`;
    const tree = objectSchema.parse(
      await this.request('/git/trees', {
        base_tree: context.baseTree,
        tree: draft.changes.map((change) => ({
          path: change.path,
          mode: change.mode,
          type: 'blob',
          content: change.after,
        })),
      }),
    );
    const commit = objectSchema.parse(
      await this.request('/git/commits', {
        message: `PocketSRE: ${draft.proposal.summary.split('\n')[0]!.slice(0, 100)}`,
        tree: tree.sha,
        parents: [context.baseCommit],
      }),
    );
    await this.request('/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
    const pull = z.object({ number: z.number().int().positive() }).parse(
      await this.request('/pulls', {
        title: `Fix: ${draft.proposal.summary.split('\n')[0]!.slice(0, 100)}`,
        head: branch,
        base: context.baseBranch,
        draft: true,
        body: [
          draft.proposal.summary,
          `Incident: ${context.bundle.incident.id}`,
          `Evidence: ${draft.proposal.evidenceIds.join(', ')}`,
          ...draft.proposal.edits.map(
            (edit) => `${edit.path}: ${edit.reason}\nEvidence: ${edit.evidenceIds.join(', ')}`,
          ),
          `Generated on the phone against commit ${context.baseCommit}.`,
          'Validation: exact source replacements and evidence references checked. Tests have NOT been run by PocketSRE. Review the patch and run repository CI before merging.',
          'Creating this draft PR does not merge or deploy it. Repository automation may run on the new branch or pull request.',
        ].join('\n\n'),
      }),
    );
    return `https://github.com/${this.repository}/pull/${pull.number}`;
  }
}
