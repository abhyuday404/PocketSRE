import { z } from 'zod';
import type { GitCode } from '@pocketsre/contracts';
import { ProjectRequestError } from './github-account.js';
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const entrySchema = z.object({
  path: z.string(),
  sha,
  mode: z.string(),
  type: z.enum(['tree', 'blob', 'commit']),
  size: z.number().nonnegative().optional(),
});
const treeSchema = z.object({ sha, tree: z.array(entrySchema), truncated: z.boolean() });
const kind = (item: z.infer<typeof entrySchema>) =>
  item.type === 'tree'
    ? ('directory' as const)
    : item.type === 'commit'
      ? ('submodule' as const)
      : item.mode === '120000'
        ? ('symlink' as const)
        : ('file' as const);
export const CodePathSchema = z
  .string()
  .max(2048)
  .default('')
  .refine(
    (path) =>
      path === '' ||
      (!/[\x00-\x1f\\]/.test(path) &&
        path.split('/').every((p) => p !== '' && p !== '.' && p !== '..') &&
        path.split('/').length <= 32),
    'Use a repository-relative file path.',
  );
export async function readGitCode(
  api: (path: string) => Promise<unknown>,
  ref: string,
  path: string,
): Promise<GitCode> {
  let tree = treeSchema.parse(await api(`/git/trees/${encodeURIComponent(ref)}`));
  const root = tree.sha; // Pin all subsequent reads to the same tree, even if the branch moves.
  const result: GitCode = {
    path,
    ref: root,
    kind: 'directory',
    entries: [],
    truncated: false,
    content: null,
    reason: null,
    size: null,
  };
  const parts = path ? path.split('/') : [];
  for (let index = 0; index < parts.length; index++) {
    const item = tree.tree.find((entry) => entry.path === parts[index]);
    if (!item)
      throw new ProjectRequestError(
        tree.truncated
          ? 'GitHub omitted part of this directory. Open it on GitHub.'
          : 'This path does not exist at the selected reference.',
        404,
      );
    if (item.type === 'tree') {
      tree = treeSchema.parse(await api(`/git/trees/${item.sha}`));
      continue;
    }
    if (index !== parts.length - 1)
      throw new ProjectRequestError('This path is not a directory.', 400);
    result.kind = kind(item);
    result.size = item.size ?? null;
    if (result.kind === 'submodule')
      return {
        ...result,
        reason: 'This is a submodule. Open GitHub to browse its linked repository.',
      };
    if ((item.size ?? Infinity) > 512000)
      return {
        ...result,
        reason: 'This file exceeds the 500 KB mobile viewer limit. Open the full file on GitHub.',
      };
    const blob = z
      .object({
        encoding: z.literal('base64'),
        content: z.string(),
        size: z.number().nonnegative(),
      })
      .parse(await api(`/git/blobs/${item.sha}`));
    if (blob.size > 512000)
      return {
        ...result,
        reason: 'This file exceeds the 500 KB mobile viewer limit. Open the full file on GitHub.',
      };
    const bytes = Buffer.from(blob.content, 'base64');
    try {
      if (bytes.includes(0)) throw new Error('Binary');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return {
        ...result,
        content,
        reason: result.kind === 'symlink' ? 'Symbolic link target (not followed).' : null,
      };
    } catch {
      return {
        ...result,
        reason: 'Binary or non-UTF-8 file. Open it on GitHub to view or download it.',
      };
    }
  }
  return {
    ...result,
    truncated: tree.truncated,
    entries: tree.tree
      .map((item) => ({
        name: item.path,
        path: path ? `${path}/${item.path}` : item.path,
        sha: item.sha,
        kind: kind(item),
        size: item.size ?? null,
      }))
      .sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          a.name.localeCompare(b.name),
      ),
  };
}
