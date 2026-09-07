import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import type { IncidentBundle, InvestigationResult } from '@pocketsre/contracts';

/** Bounded static inspection only; never reads .env or executes repository code. */
export async function inspectEnvironmentContract(
  bundle: IncidentBundle,
  repository: string,
): Promise<InvestigationResult['checks'][number]> {
  const root = await realpath(resolve(repository));
  let count = 0;
  let totalBytes = 0;
  let truncated = false;
  const usages = new Map<string, Set<string>>();
  async function readBounded(path: string): Promise<string | null> {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    if (++count > 250 || info.size > 128_000 || totalBytes + info.size > 2_000_000) {
      truncated = true;
      return null;
    }
    const canonical = await realpath(path);
    if (!canonical.startsWith(`${root}${sep}`)) return null;
    totalBytes += info.size;
    return readFile(canonical, 'utf8');
  }
  let example: string | null;
  try {
    example = await readBounded(join(root, '.env.example'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    example = null;
  }
  if (example === null)
    return {
      name: 'repository-environment-contract',
      status: 'inconclusive',
      summary: 'No readable root .env.example found. Production environment was not inspected.',
      evidenceIds: [],
    };
  const declared = new Set(
    [...example.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(
      (match) => match[1]!,
    ),
  );
  async function walk(directory: string, depth = 0): Promise<void> {
    if (depth > 8 || count > 250) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith('.') ||
        ['node_modules', 'dist', 'build', 'vendor'].includes(entry.name)
      )
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const content = await readBounded(path);
      if (!content) continue;
      for (const match of content.matchAll(
        /(?:process\.env|import\.meta\.env)(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g,
      )) {
        const key = (match[1] ?? match[2])!;
        const paths = usages.get(key) ?? new Set<string>();
        paths.add(relative(root, path));
        usages.set(key, paths);
      }
    }
  }
  const source = join(root, 'src');
  try {
    if (!(await lstat(source)).isSymbolicLink()) await walk(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const missing = [...usages.keys()].filter((key) => !declared.has(key) && key !== 'NODE_ENV');
  const evidenceIds = bundle.evidence
    .filter((event) => missing.some((key) => `${event.title} ${event.excerpt}`.includes(key)))
    .map((event) => event.id);
  return {
    name: 'repository-environment-contract',
    status: missing.length ? 'failed' : truncated || usages.size === 0 ? 'inconclusive' : 'passed',
    summary: missing.length
      ? `Static check: variables referenced in src/ but absent from .env.example: ${missing.map((key) => `${key} (${[...usages.get(key)!].join(', ')})`).join('; ')}. This does not establish the production environment or runtime behavior.${truncated ? ' Scan was truncated.' : ''}`
      : `Checked ${count} files. ${truncated ? 'Scan limits reached.' : usages.size === 0 ? 'No static environment usages found.' : 'Static variable references appear in .env.example.'} Production environment was not inspected.`,
    evidenceIds,
  };
}
