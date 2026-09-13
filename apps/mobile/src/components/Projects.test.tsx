import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createSampleIncident } from '../data/sampleIncident';

const api = vi.hoisted(() => ({
  connection: vi.fn(),
  projects: vi.fn(),
  repositories: vi.fn(),
  track: vi.fn(),
  save: vi.fn(),
  source: vi.fn(),
  check: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  disconnect: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  open: vi.fn(),
}));
vi.mock('./ConfirmationModal', () => ({ useConfirmation: () => api.confirm }));
vi.mock('react-native', () => ({
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (s: unknown) => s },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  Linking: { openURL: api.open },
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', Icon: 'Icon', ui: {} }));
vi.mock('../api/gateway', () => ({
  fetchGitHubConnection: api.connection,
  fetchProjects: api.projects,
  fetchGitHubRepositories: api.repositories,
  trackProject: api.track,
  saveProjectHealth: api.save,
  saveProjectSource: api.source,
  fetchProjectIncident: api.check,
  startGitHubSignIn: api.start,
  pollGitHubSignIn: api.poll,
  disconnectGitHub: api.disconnect,
  removeProject: api.remove,
}));
import { Projects } from './Projects';
vi.mock('./ProjectActivity', () => ({ ProjectActivity: 'ProjectActivity' }));
vi.mock('./ProjectOperations', () => ({ ProjectOperations: 'ProjectOperations' }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer | undefined;
const repo = { id: 12, fullName: 'reviewer/checkout', private: true, defaultBranch: 'main' };
const project = {
  id: 'c87e49ea-6a58-4a48-bd25-1574b3bc4c13',
  repository: repo,
  healthUrl: null,
  monitoring: false,
  deployment: null,
  sourcePaths: [],
  createdAt: '2026-09-12T00:00:00.000Z',
};
const button = (label: string) =>
  renderer!.root.findAll(
    (node) =>
      (node.type === ('Button' as never) && node.props.label === label) ||
      (node.type === ('Pressable' as never) && node.props.accessibilityLabel === label),
  )[0]!;
beforeEach(() => {
  vi.resetAllMocks();
  api.connection.mockResolvedValue({
    enabled: true,
    connected: true,
    canSignIn: true,
    account: 'reviewer',
    expiresAt: null,
  });
  api.projects.mockResolvedValue([]);
  api.track.mockResolvedValue(project);
  api.save.mockImplementation(async (id, healthUrl) => ({ ...project, id, healthUrl }));
  api.repositories.mockResolvedValue({ repositories: [repo], nextPage: null });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});

it('still opens saved project health when GitHub is unavailable', async () => {
  api.connection.mockRejectedValueOnce(new Error('GitHub unavailable'));
  api.projects.mockResolvedValue([{ ...project, healthUrl: 'https://checkout.example/health' }]);
  await act(async () => {
    renderer = create(<Projects />);
  });
  expect(button('Open reviewer/checkout')).toBeDefined();
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
  expect(button('Refresh project health').props.disabled).toBe(false);
});

it('selects a real repository before offering endpoint setup and probes the selected project only', async () => {
  await act(async () => {
    renderer = create(<Projects />);
  });
  await act(async () => {
    await button('Add project').props.onPress();
  });
  api.projects.mockResolvedValue([project]);
  await act(async () => {
    await button('Import reviewer/checkout').props.onPress();
  });
  expect(api.track).toHaveBeenCalledWith('reviewer/checkout');
  expect(button('Back to projects')).toBeDefined();
  expect(button('Refresh project health').props.disabled).toBe(true);
  const input = renderer!.root.findByProps({ accessibilityLabel: 'Project health URL' });
  await act(async () => {
    input.props.onChangeText('https://checkout.example/health');
  });
  api.projects.mockResolvedValue([{ ...project, healthUrl: 'https://checkout.example/health' }]);
  await act(async () => {
    await button('Save health endpoint').props.onPress();
  });
  expect(api.save).toHaveBeenCalledWith(project.id, 'https://checkout.example/health');
  api.check.mockResolvedValue(createSampleIncident());
  await act(async () => {
    await button('Refresh project health').props.onPress();
  });
  expect(api.check).toHaveBeenCalledWith(project.id);
});

it('opens the GitHub verification page only after sign-in is requested and shows the code', async () => {
  api.connection.mockResolvedValue({
    enabled: true,
    connected: false,
    canSignIn: true,
    account: null,
    expiresAt: null,
  });
  api.start.mockResolvedValue({
    id: project.id,
    userCode: 'TEST-CODE',
    verificationUrl: 'https://github.com/login/device',
    expiresAt: '2099-01-01T00:00:00.000Z',
    interval: 5,
  });
  await act(async () => {
    renderer = create(<Projects />);
  });
  expect(api.open).not.toHaveBeenCalled();
  await act(async () => {
    await button('Connect GitHub').props.onPress();
  });
  expect(api.open).toHaveBeenCalledWith('https://github.com/login/device');
  expect(JSON.stringify(renderer!.toJSON())).toContain('TEST-CODE');
});

it('reports missing setup and network failures without pretending repositories are connected', async () => {
  api.connection.mockResolvedValue({
    enabled: false,
    connected: false,
    canSignIn: false,
    account: null,
    expiresAt: null,
  });
  await act(async () => {
    renderer = create(<Projects />);
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('not configured on this gateway');
  expect(button('Connect GitHub').props.icon).toBe('github');
  await act(async () => {
    await button('Connect GitHub').props.onPress();
  });
  expect(api.start).not.toHaveBeenCalled();
  api.projects.mockRejectedValueOnce(new Error('Gateway is offline'));
  await act(async () => {
    await button('Refresh projects').props.onPress();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Gateway is offline');
});

it('shows saved repositories in a horizontal carousel with Add project last', async () => {
  api.projects.mockResolvedValue([
    project,
    { ...project, id: 'second', repository: { ...repo, id: 13, fullName: 'reviewer/api' } },
  ]);
  await act(async () => {
    renderer = create(<Projects />);
  });
  const carousel = renderer!.root.findByProps({ accessibilityLabel: 'Imported GitHub projects' });
  expect(carousel.props.horizontal).toBe(true);
  expect(
    carousel.findAllByType('Pressable' as never).map((n) => n.props.accessibilityLabel),
  ).toEqual(['Open reviewer/checkout', 'Open reviewer/api', 'Add project']);
  expect(api.repositories).not.toHaveBeenCalled();
  expect(button('Save health endpoint')).toBeUndefined();
});

it('keeps source and endpoint settings scoped to the selected project', async () => {
  const second = {
    ...project,
    id: 'second',
    repository: { ...repo, id: 13, fullName: 'reviewer/api' },
    healthUrl: 'https://api.example/health',
    sourcePaths: ['src/api.ts'],
  };
  api.projects.mockResolvedValue([project, second]);
  api.source.mockResolvedValue({ ...second, sourcePaths: ['src/api.ts', 'src/config.ts'] });
  const onOpenAgent = vi.fn();
  await act(async () => {
    renderer = create(<Projects onOpenAgent={onOpenAgent} />);
  });
  await act(async () => {
    button('Open reviewer/api').props.onPress();
  });
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Project health URL' }).props.value).toBe(
    second.healthUrl,
  );
  await act(async () => {
    button('Source files').props.onPress();
  });
  expect(
    renderer!.root.findByProps({ accessibilityLabel: 'Project source paths' }).props.value,
  ).toBe('src/api.ts');
  await act(async () => {
    renderer!.root
      .findByProps({ accessibilityLabel: 'Project source paths' })
      .props.onChangeText('src/api.ts\nsrc/config.ts');
  });
  await act(async () => {
    await button('Save source files').props.onPress();
  });
  expect(api.source).toHaveBeenCalledWith('second', ['src/api.ts', 'src/config.ts']);
  await act(async () => {
    button('Analyze with project agent').props.onPress();
  });
  expect(onOpenAgent).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'second', sourcePaths: ['src/api.ts', 'src/config.ts'] }),
  );
  await act(async () => {
    button('Back to projects').props.onPress();
  });
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Project health URL' }).props.value).toBe(
    '',
  );
  await act(async () => {
    button('Source files').props.onPress();
  });
  expect(
    renderer!.root.findByProps({ accessibilityLabel: 'Project source paths' }).props.value,
  ).toBe('');
});

it('keeps imported projects available after GitHub disconnects and opens project-specific settings', async () => {
  api.connection.mockResolvedValue({ enabled: true, connected: false, canSignIn: true });
  api.projects.mockResolvedValue([project]);
  await act(async () => {
    renderer = create(<Projects />);
  });
  expect(button('Connect GitHub').props.icon).toBe('github');
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
  await act(async () => {
    button('Deployment').props.onPress();
  });
  expect(renderer!.root.findByType('ProjectOperations' as never).props).toMatchObject({
    project,
    section: 'deployment',
  });
  await act(async () => {
    button('Alerts').props.onPress();
  });
  expect(renderer!.root.findByType('ProjectOperations' as never).props).toMatchObject({
    project,
    section: 'monitoring',
  });
});

it('shows failed imports in the picker without opening a fake project', async () => {
  api.track.mockRejectedValue(new Error('GitHub access expired'));
  await act(async () => {
    renderer = create(<Projects />);
  });
  await act(async () => {
    await button('Add project').props.onPress();
  });
  await act(async () => {
    await button('Import reviewer/checkout').props.onPress();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('GitHub access expired');
  expect(button('Save health endpoint')).toBeUndefined();
});

it('distinguishes failed project loading from an empty account', async () => {
  api.projects.mockRejectedValue(new Error('Gateway is offline'));
  await act(async () => {
    renderer = create(<Projects />);
  });
  expect(button('Retry loading projects')).toBeDefined();
  expect(button('Add project')).toBeUndefined();
});

it('counts only projects, including when the carousel is on Add project', async () => {
  api.projects.mockResolvedValue([project]);
  await act(async () => {
    renderer = create(<Projects />);
  });
  const count = () =>
    renderer!.root.findByProps({ accessibilityLabel: 'Project count' }).props.children;
  expect(count()).toBe('1 / 1 · Project workspace');
  const carousel = renderer!.root.findByProps({ accessibilityLabel: 'Imported GitHub projects' });
  await act(async () => {
    carousel.props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: carousel.props.snapToInterval } },
    });
  });
  expect(count()).toBe('1 project · Add a project');
});

it('removes only the confirmed project without depending on another GitHub request', async () => {
  const other = {
    ...project,
    id: 'other',
    repository: { ...repo, id: 13, fullName: 'reviewer/api' },
  };
  api.projects.mockResolvedValue([project, other]);
  await act(async () => {
    renderer = create(<Projects />);
  });
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
  await act(async () => {
    button('Remove project').props.onPress();
  });
  expect(api.remove).not.toHaveBeenCalled();
  const actions = api.confirm.mock.calls[0]![2];
  api.projects.mockRejectedValue(new Error('Gateway read failed'));
  await act(async () => {
    await actions.find((a: { text: string }) => a.text === 'Remove project').onPress();
  });
  expect(api.remove).toHaveBeenCalledWith(project.id);
  expect(button('Open reviewer/checkout')).toBeUndefined();
  expect(button('Open reviewer/api')).toBeDefined();
  expect(api.projects).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Project count' }).props.children).toBe(
    '1 / 1 · Project workspace',
  );
});

it('keeps a project and reports a failed removal, then allows retry', async () => {
  api.projects.mockResolvedValue([project]);
  api.remove.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(undefined);
  await act(async () => {
    renderer = create(<Projects />);
  });
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
  await act(async () => {
    button('Remove project').props.onPress();
  });
  const confirm = api.confirm.mock.calls[0]![2].find(
    (a: { text: string }) => a.text === 'Remove project',
  ).onPress;
  await act(async () => {
    await confirm();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Connection lost');
  expect(button('Remove project').props.disabled).toBe(false);
  await act(async () => {
    await confirm();
  });
  expect(button('Open reviewer/checkout')).toBeUndefined();
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Project count' }).props.children).toBe(
    '0 projects · Add a project',
  );
});

it('opens activity inside the selected project workspace', async () => {
  api.projects.mockResolvedValue([project]);
  await act(async () => {
    renderer = create(<Projects />);
  });
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
  await act(async () => {
    button('Activity').props.onPress();
  });
  expect(renderer!.root.findByType('ProjectActivity' as never).props.project.id).toBe(project.id);
});
