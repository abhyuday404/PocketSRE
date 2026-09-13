import { expect, it, vi } from 'vitest';
import { CodePathSchema, readGitCode } from './git-code.js';
const root = 'a'.repeat(40),
  child = 'b'.repeat(40),
  blob = 'c'.repeat(40);
const tree = (sha: string, entries: object[]) => ({ sha, tree: entries, truncated: false });
const entry = (path: string, type = 'blob', size = 20, mode = '100644') => ({
  path,
  sha: type === 'tree' ? child : blob,
  type,
  size,
  mode,
});
it('browses all repository entries including dotfiles, directories and symlinks', async () => {
  const api = vi
    .fn()
    .mockResolvedValue(
      tree(root, [
        entry('z.ts'),
        entry('.env.example'),
        entry('src', 'tree', 0, '040000'),
        entry('link', 'blob', 20, '120000'),
      ]),
    );
  const result = await readGitCode(api, 'feature/code', '');
  expect(api).toHaveBeenCalledWith('/git/trees/feature%2Fcode');
  expect(result.ref).toBe(root);
  expect(result.entries[0]?.name).toBe('src');
  expect(result.entries.some((e) => e.name === '.env.example')).toBe(true);
  expect(result.entries.find((e) => e.name === 'link')?.kind).toBe('symlink');
});
it('walks folders through verified tree entries and reads the full UTF-8 blob', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(tree(root, [entry('src', 'tree', 0, '040000')]))
    .mockResolvedValueOnce(tree(child, [entry('hello world.ts')]))
    .mockResolvedValueOnce({
      encoding: 'base64',
      size: 20,
      content: Buffer.from('const greeting = "你好";\n').toString('base64'),
    });
  const result = await readGitCode(api, 'main', 'src/hello world.ts');
  expect(api.mock.calls.map((c) => c[0])).toEqual([
    '/git/trees/main',
    `/git/trees/${child}`,
    `/git/blobs/${blob}`,
  ]);
  expect(result.content).toBe('const greeting = "你好";\n');
  expect(result.ref).toBe(root);
});
it('does not download oversized blobs or follow submodule or symlink targets', async () => {
  const api = vi
    .fn()
    .mockResolvedValue(
      tree(root, [entry('large', 'blob', 600000), entry('module', 'commit', 0, '160000')]),
    );
  expect((await readGitCode(api, 'main', 'large')).reason).toContain('500 KB');
  expect((await readGitCode(api, 'main', 'module')).kind).toBe('submodule');
  expect(api).toHaveBeenCalledTimes(2);
});
it('labels binary content and rejects traversal paths', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(tree(root, [entry('image')]))
    .mockResolvedValueOnce({
      encoding: 'base64',
      size: 3,
      content: Buffer.from([0, 1, 2]).toString('base64'),
    });
  expect((await readGitCode(api, 'main', 'image')).reason).toContain('Binary');
  for (const path of ['../secret', '/etc/passwd', 'src/../secret', 'src//file', 'src\\file'])
    expect(CodePathSchema.safeParse(path).success).toBe(false);
  expect(CodePathSchema.safeParse('.github/workflows/build.yml').success).toBe(true);
});
