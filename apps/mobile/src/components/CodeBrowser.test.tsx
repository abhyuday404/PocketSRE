import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const api = vi.hoisted(() => ({ code: vi.fn(), branches: vi.fn() }));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', Icon: 'Icon', ui: {} }));
vi.mock('../api/gateway', () => ({
  fetchProjectCode: api.code,
  fetchProjectBranches: api.branches,
}));
import { CodeBrowser } from './CodeBrowser';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer;
const project = {
  id: 'one',
  repository: { id: 1, fullName: 'owner/one', private: true, defaultBranch: 'main' },
  healthUrl: null,
  createdAt: '',
  monitoring: false,
  deployment: null,
  sourcePaths: [],
};
const directory = {
  path: '',
  ref: 'snapshot',
  kind: 'directory',
  entries: [{ name: 'app.ts', path: 'app.ts', kind: 'file', size: 50000, sha: 'blob' }],
  content: null,
  reason: null,
  size: null,
  truncated: false,
};
const button = (label: string) =>
  renderer.root.findAll(
    (n) =>
      (n.type === ('Button' as never) && n.props.label === label) ||
      (n.type === ('Pressable' as never) && n.props.accessibilityLabel === label),
  )[0]!;
beforeEach(() => {
  vi.resetAllMocks();
  api.code.mockResolvedValue(directory);
  api.branches.mockResolvedValue({ items: [{ name: 'develop' }], nextPage: null });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});
it('opens code using the pinned tree and pages through all file lines', async () => {
  await act(async () => {
    renderer = create(<CodeBrowser project={project} initialRef="main" />);
  });
  api.code.mockResolvedValue({
    ...directory,
    path: 'app.ts',
    kind: 'file',
    entries: [],
    content: Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n'),
  });
  await act(async () => button('Open app.ts').props.onPress());
  expect(api.code).toHaveBeenLastCalledWith('one', 'snapshot', 'app.ts');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('line 250');
  await act(async () => button('Next lines').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('line 250');
});
it('switches branches at the root and ignores an old in-flight file read', async () => {
  await act(async () => {
    renderer = create(<CodeBrowser project={project} initialRef="main" />);
  });
  let resolve!: (value: unknown) => void;
  api.code.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => button('Open app.ts').props.onPress());
  await act(async () => button('Branch / ref: main').props.onPress());
  await act(async () => button('develop').props.onPress());
  expect(api.code).toHaveBeenLastCalledWith('one', 'develop', '');
  await act(async () => resolve({ ...directory, kind: 'file', content: 'stale secret text' }));
  expect(JSON.stringify(renderer.toJSON())).not.toContain('stale secret text');
});
