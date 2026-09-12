import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createSampleIncident } from '../data/sampleIncident';

const api = vi.hoisted(() => ({
  connection: vi.fn(),
  projects: vi.fn(),
  repositories: vi.fn(),
  track: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  disconnect: vi.fn(),
  remove: vi.fn(),
  open: vi.fn(),
}));
vi.mock('react-native', () => ({
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Linking: { openURL: api.open },
  Alert: { alert: vi.fn() },
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', ui: {} }));
vi.mock('../api/gateway', () => ({
  fetchGitHubConnection: api.connection,
  fetchProjects: api.projects,
  fetchGitHubRepositories: api.repositories,
  trackProject: api.track,
  saveProjectHealth: api.save,
  fetchProjectIncident: api.check,
  startGitHubSignIn: api.start,
  pollGitHubSignIn: api.poll,
  disconnectGitHub: api.disconnect,
  removeProject: api.remove,
}));
import { Projects } from './Projects';
vi.mock('./ProjectOperations', () => ({ ProjectOperations: 'ProjectOperations' }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer | undefined;
const repo = { id: 12, fullName: 'reviewer/checkout', private: true, defaultBranch: 'main' };
const project = {
  id: 'c87e49ea-6a58-4a48-bd25-1574b3bc4c13',
  repository: repo,
  healthUrl: null,
  createdAt: '2026-09-12T00:00:00.000Z',
};
const button = (label: string) =>
  renderer!.root.findAll(
    (node) => node.type === ('Button' as never) && node.props.label === label,
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
    await button('Choose repositories').props.onPress();
  });
  api.projects.mockResolvedValue([project]);
  await act(async () => {
    await button('Track reviewer/checkout').props.onPress();
  });
  expect(api.track).toHaveBeenCalledWith('reviewer/checkout');
  await act(async () => {
    button('Open reviewer/checkout').props.onPress();
  });
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
  expect(button('Connect GitHub')).toBeUndefined();
  api.projects.mockRejectedValueOnce(new Error('Gateway is offline'));
  await act(async () => {
    await button('Refresh projects').props.onPress();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Gateway is offline');
});
