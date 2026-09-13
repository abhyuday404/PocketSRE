import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  pulls: vi.fn(),
  commits: vi.fn(),
  branches: vi.fn(),
  diff: vi.fn(),
  compare: vi.fn(),
  code: vi.fn(),
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Linking: { openURL: vi.fn() },
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', Icon: 'Icon', ui: {} }));
vi.mock('../api/gateway', () => ({
  fetchProjects: api.projects,
  fetchProjectCode: api.code,
  fetchProjectPulls: api.pulls,
  fetchProjectCommits: api.commits,
  fetchProjectBranches: api.branches,
  fetchProjectDiff: api.diff,
  compareProjectRefs: api.compare,
}));
vi.mock('./PullRequestMerge', () => ({ PullRequestMerge: 'PullRequestMerge' }));
import { GitHub, FileDiff } from './GitHub';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer;
const project = (id: string) => ({
  id,
  repository: { id: Number(id), fullName: `owner/repo${id}`, defaultBranch: 'main', private: true },
  sourcePaths: [],
  createdAt: new Date().toISOString(),
  healthUrl: null,
  deployment: null,
  monitoring: false,
});
const pull = {
  number: 12,
  title: 'Fix timeout',
  body: 'Details',
  draft: false,
  state: 'open',
  updated_at: '2026-09-13T00:00:00Z',
  user: { login: 'owner' },
  head: { ref: 'fix', sha: 'a'.repeat(40) },
  base: { ref: 'main', sha: 'b'.repeat(40) },
};
const file = {
  filename: 'src/app.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1 +1 @@\n-old\n+new',
  patchTruncated: false,
};
const button = (label: string) =>
  renderer.root.findAll(
    (n) =>
      (n.type === ('Button' as never) && n.props.label === label) ||
      (n.type === ('Pressable' as never) && n.props.accessibilityLabel === label),
  )[0]!;
beforeEach(() => {
  vi.resetAllMocks();
  api.projects.mockResolvedValue([project('1'), project('2')]);
  api.pulls.mockResolvedValue({ items: [pull], nextPage: null });
  api.diff.mockResolvedValue({ files: [file], nextPage: null, limited: false, summary: 'Changes' });
  api.branches.mockResolvedValue({ items: [], nextPage: null });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});
it('shows imported-project PRs and opens the selected repository’s diff', async () => {
  await act(async () => {
    renderer = create(<GitHub onOpenProjects={vi.fn()} />);
  });
  expect(api.pulls).toHaveBeenCalledWith('1');
  expect(api.pulls).toHaveBeenCalledWith('2');
  await act(async () => button('Browse repo2').props.onPress());
  await act(async () => button('Review #12').props.onPress());
  expect(api.diff).toHaveBeenCalledWith('2', 'pulls', '12', 1, 'a'.repeat(40));
  await act(async () => button('Diff src/app.ts').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('+new');
});
it('ignores a late diff when switching repositories', async () => {
  let resolve!: (value: unknown) => void;
  api.diff.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => {
    renderer = create(<GitHub onOpenProjects={vi.fn()} />);
  });
  await act(async () => button('Browse repo1').props.onPress());
  await act(async () => button('Review #12').props.onPress());
  await act(async () => button('owner/repo2').props.onPress());
  await act(async () =>
    resolve({
      files: [{ ...file, filename: 'wrong-project.ts' }],
      nextPage: null,
      limited: false,
      summary: 'Wrong',
    }),
  );
  expect(JSON.stringify(renderer.toJSON())).not.toContain('wrong-project.ts');
  expect(button('Review #12')).toBeDefined();
});
it('compares explicit refs and distinguishes missing patches from unchanged files', async () => {
  api.compare.mockResolvedValue({
    files: [{ ...file, patch: null }],
    nextPage: null,
    limited: false,
    summary: 'ahead',
  });
  await act(async () => {
    renderer = create(<GitHub onOpenProjects={vi.fn()} />);
  });
  await act(async () => button('Browse repo1').props.onPress());
  await act(async () => button('Compare').props.onPress());
  await act(async () =>
    renderer.root
      .findByProps({ accessibilityLabel: 'Head reference' })
      .props.onChangeText('feature/login'),
  );
  await act(async () => button('Compare references').props.onPress());
  expect(api.compare).toHaveBeenCalledWith('1', 'main', 'feature/login');
  await act(async () => button('Diff src/app.ts').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('No text patch available');
});

it('shares branch selection between code and commits, including the header switcher', async () => {
  api.branches.mockResolvedValue({
    items: [{ name: 'feature/login', protected: false, commit: { sha: 'c'.repeat(40) } }],
    nextPage: null,
  });
  api.code.mockResolvedValue({
    path: '',
    ref: 'snapshot',
    kind: 'directory',
    entries: [],
    content: null,
    reason: null,
    size: null,
    truncated: false,
  });
  api.commits.mockResolvedValue({ items: [], nextPage: null });
  await act(async () => {
    renderer = create(<GitHub onOpenProjects={vi.fn()} />);
  });
  await act(async () => button('Browse repo1').props.onPress());
  await act(async () => button('Switch branch: main').props.onPress());
  await act(async () => button('Switch to feature/login').props.onPress());
  expect(api.code).toHaveBeenLastCalledWith('1', 'feature/login', '');
  expect(button('Switch branch: feature/login')).toBeDefined();
  await act(async () => button('Commits').props.onPress());
  expect(api.commits).toHaveBeenLastCalledWith('1', 'feature/login', 1);
  await act(async () => button('Code').props.onPress());
  expect(api.code).toHaveBeenLastCalledWith('1', 'feature/login', '');
  api.branches.mockResolvedValue({ items: [{ name: 'develop' }], nextPage: null });
  await act(async () => button('Branch / ref: feature/login').props.onPress());
  await act(async () => button('develop').props.onPress());
  expect(button('Switch branch: develop')).toBeDefined();
  await act(async () => button('Commits').props.onPress());
  expect(api.commits).toHaveBeenLastCalledWith('1', 'develop', 1);
  api.branches.mockResolvedValue({
    items: [{ name: 'main', protected: false, commit: { sha: 'a'.repeat(40) } }],
    nextPage: null,
  });
  await act(async () => button('Switch branch: develop').props.onPress());
  await act(async () => button('Switch to main').props.onPress());
  expect(api.commits).toHaveBeenLastCalledWith('1', 'main', 1);
});
