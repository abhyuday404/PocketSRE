import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), next: 0 }));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => `new-${++api.next}` }));
vi.mock('./ui', () => ({ Button: 'Button', Icon: 'Icon', ui: {} }));
vi.mock('./FixHarness', () => ({ FixHarness: 'FixHarness' }));
vi.mock('../storage/chats', () => ({ readChats: api.read, saveChat: api.save }));
import { ProjectConversations } from './ProjectConversations';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let view: ReactTestRenderer;
const first = {
  id: 'older',
  title: 'Find the timeout',
  updatedAt: '2026-09-12T00:00:00.000Z',
  conversation: [{ role: 'user', content: 'Find the timeout' }],
  request: '',
  paths: ['server.ts'],
};
const second = {
  ...first,
  id: 'latest',
  title: 'Review the cache',
  conversation: [{ role: 'user', content: 'Review the cache' }],
  updatedAt: '2026-09-13T00:00:00.000Z',
};
const props = {
  projectId: 'A',
  projectName: 'owner/A',
  incidentId: 'project:A',
  busy: false,
  connected: true,
  generate: vi.fn(),
};
const harness = () => view.root.findByType('FixHarness' as never);
const press = async (label: string) =>
  act(async () => view.root.findByProps({ accessibilityLabel: label }).props.onPress());
beforeEach(() => {
  vi.resetAllMocks();
  api.read.mockResolvedValue([second, first]);
  api.save.mockResolvedValue([]);
});
afterEach(async () => {
  if (view) await act(async () => view.unmount());
});
it('opens older chats with their selected files, searches history, and starts a separate conversation', async () => {
  await act(async () => {
    view = create(<ProjectConversations {...props} />);
  });
  expect(harness().props.chatSession.initial.id).toBe('latest');
  await press('Open project chat history');
  await act(async () =>
    view.root
      .findByProps({ accessibilityLabel: 'Search project chats' })
      .props.onChangeText('timeout'),
  );
  expect(
    view.root.findAllByProps({ accessibilityLabel: 'Open chat Review the cache' }),
  ).toHaveLength(0);
  await press('Open chat Find the timeout');
  expect(harness().props.chatSession.initial.paths).toEqual(['server.ts']);
  await act(async () =>
    harness().props.chatSession.onChange({
      conversation: first.conversation,
      request: 'More detail',
      paths: first.paths,
    }),
  );
  await press('Start new project chat');
  expect(api.save).toHaveBeenCalledWith(
    JSON.stringify(['A', 'owner/A']),
    expect.objectContaining({ id: 'older', request: 'More detail' }),
  );
  expect(harness().props.chatSession.initial.conversation).toEqual([]);
  await press('Open project chat history');
  expect(
    view.root.findAllByProps({ accessibilityLabel: 'Open chat Find the timeout' }),
  ).toHaveLength(1);
});
it('never shows another project’s chats while its history is loading', async () => {
  await act(async () => {
    view = create(<ProjectConversations {...props} />);
  });
  let resolve!: (value: unknown) => void;
  api.read.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () =>
    view.update(<ProjectConversations {...props} projectId="B" projectName="owner/B" />),
  );
  expect(view.root.findAllByType('FixHarness' as never)).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).not.toContain('Find the timeout');
  await act(async () => resolve([]));
  expect(harness().props.chatSession.initial.conversation).toEqual([]);
  expect(api.read).toHaveBeenLastCalledWith(JSON.stringify(['B', 'owner/B']));
});
it('flushes an unfinished message when leaving the agent', async () => {
  await act(async () => {
    view = create(<ProjectConversations {...props} />);
  });
  await act(async () =>
    harness().props.chatSession.onChange({
      conversation: first.conversation,
      request: 'Unsent draft',
      paths: [],
    }),
  );
  await act(async () => view.unmount());
  expect(api.save).toHaveBeenCalledWith(
    JSON.stringify(['A', 'owner/A']),
    expect.objectContaining({ request: 'Unsent draft' }),
  );
});
