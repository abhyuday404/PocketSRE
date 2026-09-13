import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  merge: vi.fn(),
  ready: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Text: 'Text',
  View: 'View',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-id' }));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', ui: {} }));
vi.mock('./ConfirmationModal', () => ({ useConfirmation: () => mocks.confirm }));
vi.mock('../api/gateway', () => ({
  fetchMergePreview: mocks.preview,
  mergeProjectPull: mocks.merge,
  markProjectPullReady: mocks.ready,
}));
import { PullRequestMerge } from './PullRequestMerge';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer;
const sha = 'a'.repeat(40);
const button = (label: string) =>
  renderer.root.findAll((n) => n.type === ('Button' as never) && n.props.label === label)[0]!;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue({
    number: 12,
    title: 'Fix timeout',
    repository: 'owner/repo',
    sha,
    baseSha: 'b'.repeat(40),
    headRef: 'fix',
    baseRef: 'main',
    ready: true,
    merged: false,
    reasons: [],
    methods: ['squash', 'merge'],
    checks: [],
  });
  mocks.merge.mockResolvedValue({ status: 'succeeded', message: 'Merged #12' });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});
async function mount(onMerged = vi.fn()) {
  await act(async () => {
    renderer = create(
      <PullRequestMerge projectId="project" number={12} reviewedSha={sha} onMerged={onMerged} />,
    );
  });
}
it('shows exact target confirmation and writes only after approval, once', async () => {
  const merged = vi.fn();
  await mount(merged);
  await act(async () => button('Create merge commit').props.onPress());
  await act(async () => button('Review merge').props.onPress());
  expect(mocks.merge).not.toHaveBeenCalled();
  const [title, message, actions] = mocks.confirm.mock.calls[0]!;
  expect(title).toBe('Merge this pull request?');
  expect(message).toContain('owner/repo · #12');
  expect(message).toContain('fix → main');
  expect(actions[0]).toMatchObject({ text: 'Cancel', style: 'cancel' });
  await act(async () => {
    actions[1].onPress();
    actions[1].onPress();
  });
  expect(mocks.merge).toHaveBeenCalledTimes(1);
  expect(mocks.merge).toHaveBeenCalledWith(
    'project',
    12,
    expect.objectContaining({ sha, method: 'merge', baseRef: 'main' }),
  );
  expect(merged).toHaveBeenCalledTimes(1);
});
it('blocks merging when commits changed since the diff was opened', async () => {
  mocks.preview.mockResolvedValue({ ...(await mocks.preview()), sha: 'c'.repeat(40) });
  await mount();
  expect(button('Review merge')).toBeUndefined();
  expect(mocks.merge).not.toHaveBeenCalled();
});
it('does not execute a pending confirmation after leaving the PR', async () => {
  await mount();
  await act(async () => button('Review merge').props.onPress());
  const actions = mocks.confirm.mock.calls[0]![2];
  await act(async () => renderer.unmount());
  await act(async () => actions[1].onPress());
  expect(mocks.merge).not.toHaveBeenCalled();
});

it('requires separate approval to mark a draft ready without merging it', async () => {
  mocks.preview.mockResolvedValue({
    ...(await mocks.preview()),
    draft: true,
    canMarkReady: true,
    ready: false,
  });
  mocks.ready.mockResolvedValue({ status: 'succeeded', message: 'Ready' });
  await mount();
  await act(async () => button('Mark ready for review').props.onPress());
  expect(mocks.ready).not.toHaveBeenCalled();
  await act(async () => mocks.confirm.mock.calls[0]![2][1].onPress());
  expect(mocks.ready).toHaveBeenCalledWith('project', 12, expect.objectContaining({ sha }));
  expect(mocks.merge).not.toHaveBeenCalled();
});
