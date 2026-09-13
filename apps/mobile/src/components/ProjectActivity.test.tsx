import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createSampleIncident } from '../data/sampleIncident';
const api = vi.hoisted(() => ({
  actions: vi.fn(),
  incident: vi.fn(),
  history: vi.fn(),
  cache: vi.fn(),
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  Linking: { openURL: vi.fn() },
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', Icon: 'Icon', ui: {} }));
vi.mock('../api/gateway', () => ({
  fetchProjectActions: api.actions,
  fetchProjectIncident: api.incident,
  getGatewayUrl: () => 'https://server.example',
}));
vi.mock('../storage/incidents', () => ({
  cacheIncident: api.cache,
  readIncidentHistory: api.history,
}));
import { ProjectActivity } from './ProjectActivity';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.resetAllMocks();
});
it('filters saved evidence and actions to the current repository', async () => {
  const bundle = createSampleIncident();
  const own = structuredClone(bundle);
  own.incident.serviceId = 'github:1';
  own.incident.title = 'Own incident';
  const other = structuredClone(bundle);
  other.incident.serviceId = 'github:2';
  other.incident.title = 'Other incident';
  api.history.mockResolvedValue({
    records: [
      { id: 'one', source: 'gateway', bundle: own },
      { id: 'two', source: 'gateway', bundle: other },
    ],
    notice: null,
  });
  api.actions.mockResolvedValue([
    { requestId: 'other', serviceId: 'github:2', result: { message: 'Other action' } },
  ]);
  const project = {
    id: 'one',
    repository: { id: 1, fullName: 'owner/one', private: true, defaultBranch: 'main' },
    createdAt: new Date().toISOString(),
    healthUrl: null,
    sourcePaths: [],
    monitoring: false,
    deployment: null,
  };
  await act(async () => {
    renderer = create(<ProjectActivity project={project} />);
  });
  expect(api.actions).toHaveBeenCalledWith('one');
  expect(JSON.stringify(renderer.toJSON())).toContain('Own incident');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Other incident');
  await act(async () => renderer.root.findByProps({ label: 'Actions' }).props.onPress());
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Other action');
});
