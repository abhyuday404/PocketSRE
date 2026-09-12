import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { disk, resetDisk } from '../storage/testStorage';
import { createSampleIncident } from '../data/sampleIncident';
import { createDeterministicDiagnosis } from '@pocketsre/incident-engine';
import { cacheIncident, cacheDiagnosis, cacheOfflineIncident } from '../storage/incidents';
import type { Diagnosis } from '@pocketsre/contracts';

const native = vi.hoisted(() => ({
  alert: vi.fn(),
  fetchCurrentIncident: vi.fn(),
  fetchGatewayMode: vi.fn(),
  executeApprovedAction: vi.fn(),
  loadConnection: vi.fn(),
  pickJsonFile: vi.fn(),
  analyze: vi.fn(),
}));
vi.mock('react-native', () => ({ Alert: { alert: native.alert } }));
vi.mock('../api/gateway', () => ({
  configureGateway: vi.fn(),
  fetchCurrentIncident: native.fetchCurrentIncident,
  fetchGatewayMode: native.fetchGatewayMode,
  fetchAudit: vi.fn(async () => []),
  executeApprovedAction: native.executeApprovedAction,
  injectDemoRegression: vi.fn(),
  resetDemo: vi.fn(),
}));
vi.mock('../settings/connection', () => ({
  loadConnection: native.loadConnection,
  saveConnection: vi.fn(async (value) => value),
}));
vi.mock('../officekit/bundle', () => ({
  pickJsonFile: native.pickJsonFile,
  shareIncidentFile: vi.fn(),
}));
vi.mock('../ai/LocalTriageEngine', () => ({
  createTriageEngine: () => ({ modeLabel: 'Deterministic test engine', analyze: native.analyze }),
}));
import { useIncident } from './useIncident';

const A = 'https://gateway-a.example';
const B = 'https://gateway-b.example';
let state: ReturnType<typeof useIncident>;
let renderer: ReactTestRenderer | null = null;
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
globals.IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  state = useIncident();
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await waitForIdle();
}
async function waitForIdle() {
  // The mount effect starts asynchronous native storage work independently of act.
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      expect(state.busy).toBe(false);
    },
    { timeout: 5_000, interval: 5 },
  );
}
async function unmount() {
  await act(async () => {
    renderer?.unmount();
    renderer = null;
  });
}

beforeEach(() => {
  resetDisk();
  vi.clearAllMocks();
  native.loadConnection.mockResolvedValue({ url: A, token: '' });
  native.fetchCurrentIncident.mockRejectedValue(new Error('Gateway offline'));
  native.fetchGatewayMode.mockResolvedValue('demo');
  native.analyze.mockImplementation(async (bundle) => createDeterministicDiagnosis(bundle));
  native.pickJsonFile.mockResolvedValue(null);
});
afterEach(unmount);

it('restores a saved diagnosis after an offline app restart without enabling actions', async () => {
  const bundle = createSampleIncident();
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  await mount();
  await act(async () => {
    await state.analyze();
  });
  expect(state.diagnosis).not.toBeNull();
  expect(state.canExecute).toBe(true);
  const analysis = state.diagnosis;
  await unmount();
  native.fetchCurrentIncident.mockRejectedValue(new Error('Offline'));
  await mount();
  expect(state.connection).toBe('cached');
  expect(state.bundle).toEqual(bundle);
  expect(state.diagnosis).toEqual(analysis);
  expect(state.analyzedAt).not.toBeNull();
  expect(state.canExecute).toBe(false);
});

it('restores exact live matches, invalidates changed evidence, and reopens the original analysis', async () => {
  const bundle = createSampleIncident();
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  await mount();
  await act(async () => {
    await state.analyze();
  });
  const first = state.history[0]!;
  await act(async () => {
    await state.refresh();
  });
  expect(state.diagnosis).toEqual(first.diagnosis!.value);
  const changed = structuredClone(bundle);
  changed.evidence[0]!.excerpt += ' Different current evidence.';
  native.fetchCurrentIncident.mockResolvedValue(changed);
  await act(async () => {
    await state.refresh();
  });
  expect(state.connection).toBe('live');
  expect(state.diagnosis).toBeNull();
  expect(state.canExecute).toBe(false);
  expect(state.history).toHaveLength(2);
  await act(async () => {
    state.selectHistory(first);
  });
  expect(state.connection).toBe('cached');
  expect(state.diagnosis).toEqual(first.diagnosis!.value);
  expect(state.bundle).toEqual(first.bundle);
  expect(state.canExecute).toBe(false);
});

it('persists an imported investigation and never promotes its analysis into a live gateway result', async () => {
  const bundle = createSampleIncident();
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  await mount();
  await act(async () => {
    await state.analyze();
  });
  native.pickJsonFile.mockResolvedValue({
    schemaVersion: 1,
    incidentId: bundle.incident.id,
    generatedAt: bundle.generatedAt,
    checks: [
      {
        name: 'Read environment',
        status: 'failed',
        summary: 'DB_URL is missing.',
        evidenceIds: [bundle.evidence[0]!.id],
      },
    ],
  });
  await act(async () => {
    await state.importFile();
  });
  expect(state.connection).toBe('imported');
  expect(state.diagnosis).toBeNull();
  expect(state.canExecute).toBe(false);
  await act(async () => {
    await state.analyze();
  });
  const imported = state.history.find((record) => record.source === 'imported-investigation')!;
  expect(imported.diagnosis).not.toBeNull();
  expect(imported.gateway).toBeNull();
  await unmount();
  native.fetchCurrentIncident.mockRejectedValue(new Error('Offline'));
  await mount();
  expect(state.connection).toBe('imported');
  expect(state.diagnosis).toEqual(imported.diagnosis!.value);
  expect(state.canExecute).toBe(false);
  native.fetchCurrentIncident.mockResolvedValue(imported.bundle);
  await act(async () => {
    await state.refresh();
  });
  expect(state.connection).toBe('live');
  expect(state.diagnosis).toBeNull();
  expect(state.canExecute).toBe(false);
});

it('changes gateway without carrying an old diagnosis or erasing the previous history', async () => {
  const bundle = createSampleIncident();
  const snapshot = await cacheIncident(A, bundle);
  await cacheDiagnosis(snapshot, createDeterministicDiagnosis(bundle));
  await cacheIncident(B, bundle);
  await mount();
  expect(state.diagnosis).not.toBeNull();
  await act(async () => {
    await state.updateConnection({ url: B, token: '' });
  });
  expect(state.diagnosis).toBeNull();
  expect(state.connection).toBe('cached');
  expect(state.history.filter((record) => record.gateway === A)).toHaveLength(0);
  expect(state.totalSaved).toBe(2);
  await act(async () => {
    await state.updateConnection({ url: A, token: '' });
  });
  expect(state.diagnosis).not.toBeNull();
  expect(state.canExecute).toBe(false);
});

it('treats an imported version 1 incident as offline even if it duplicates live evidence', async () => {
  const bundle = createSampleIncident();
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  await mount();
  await act(async () => {
    await state.analyze();
  });
  native.pickJsonFile.mockResolvedValue(bundle);
  await act(async () => {
    await state.importFile();
  });
  expect(state.connection).toBe('imported');
  expect(state.diagnosis).toBeNull();
  expect(state.history.map((record) => record.source)).toEqual(['imported-incident', 'gateway']);
  expect(state.canExecute).toBe(false);
  expect(state.bundle.schemaVersion).toBe(1);
});

it('rejects a delayed action approval after reopening offline evidence', async () => {
  native.fetchCurrentIncident.mockResolvedValue(createSampleIncident());
  await mount();
  await act(async () => {
    await state.analyze();
  });
  await act(async () => {
    state.confirmAction();
  });
  const approve = native.alert.mock.calls[0]![2].find(
    (button: { text: string }) => button.text === 'Approve',
  ).onPress;
  await act(async () => {
    state.selectHistory(state.history[0]!);
  });
  await act(async () => {
    approve();
  });
  await waitForIdle();
  expect(native.executeApprovedAction).not.toHaveBeenCalled();
  expect(state.message).toContain('Evidence or connection changed');
});

it('requires a fresh gateway match even before approving a cached read-only action', async () => {
  const bundle = createSampleIncident();
  const diagnosis = createDeterministicDiagnosis(bundle);
  diagnosis.proposedAction = {
    type: 'RUN_HEALTH_CHECK',
    target: bundle.incident.serviceId,
    reason: 'Collect a fresh health observation.',
    risk: 'Read-only.',
    reversible: true,
    parameters: {},
    evidenceIds: diagnosis.evidenceIds,
  };
  const saved = await cacheIncident(A, bundle);
  await cacheDiagnosis(saved, diagnosis);
  await mount();
  await act(async () => {
    state.confirmAction();
  });
  expect(native.alert).not.toHaveBeenCalled();
  expect(native.executeApprovedAction).not.toHaveBeenCalled();
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  native.fetchGatewayMode.mockResolvedValue('live');
  await act(async () => {
    await state.refresh();
  });
  expect(state.canExecute).toBe(true);
  native.executeApprovedAction.mockResolvedValue({ message: 'Fresh health collected.' });
  await act(async () => {
    state.confirmAction();
  });
  const approve = native.alert.mock.calls[0]![2].find(
    (button: { text: string }) => button.text === 'Approve',
  ).onPress;
  await act(async () => {
    approve();
  });
  await waitForIdle();
  expect(native.executeApprovedAction).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'RUN_HEALTH_CHECK',
      incidentId: bundle.incident.id,
      expectedVersion: bundle.serviceHealth.version,
    }),
  );
});

it('does not show or save an invalid model diagnosis', async () => {
  const bundle = createSampleIncident();
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  native.analyze.mockResolvedValue({
    ...createDeterministicDiagnosis(bundle),
    evidenceIds: ['invented'],
  } satisfies Diagnosis);
  await mount();
  await act(async () => {
    await state.analyze();
  });
  expect(state.diagnosis).toBeNull();
  expect(state.history[0]!.diagnosis).toBeNull();
  expect(state.message).toContain('Analysis rejected');
  expect(state.canExecute).toBe(false);
});

it('persists unknown health and only approves a fresh read-only check with a null release', async () => {
  const bundle = createSampleIncident();
  bundle.serviceHealth = { ...bundle.serviceHealth, status: 'unknown', version: null, checks: {} };
  bundle.evidence = [
    {
      id: 'health-unavailable',
      source: 'health',
      type: 'health_check_unavailable',
      timestamp: bundle.generatedAt,
      title: 'Health unavailable',
      excerpt: 'The probe timed out; current service health is unknown.',
      externalUrl: null,
      metadata: { serviceId: bundle.incident.serviceId },
    },
    {
      id: 'gateway-collection-failed',
      source: 'gateway',
      type: 'collection_failed',
      timestamp: bundle.generatedAt,
      title: 'Sentry collection unavailable',
      excerpt: 'Current provider evidence could not be collected.',
      externalUrl: null,
      metadata: {},
    },
  ];
  bundle.collection = [
    {
      source: 'Health',
      status: 'unavailable',
      message: 'The probe timed out.',
      checkedAt: bundle.generatedAt,
      evidenceIds: ['health-unavailable'],
    },
  ];
  native.fetchCurrentIncident.mockResolvedValue(bundle);
  native.fetchGatewayMode.mockResolvedValue('live');
  await mount();
  await act(async () => {
    await state.analyze();
  });
  const analysis = state.diagnosis;
  expect(analysis?.likelyCause).toBeNull();
  expect(analysis?.confidence).toBe('low');
  expect(analysis?.proposedAction?.type).toBe('RUN_HEALTH_CHECK');
  expect(state.canExecute).toBe(true);

  await unmount();
  native.fetchCurrentIncident.mockRejectedValue(new Error('Offline'));
  await mount();
  expect(state.connection).toBe('cached');
  expect(state.bundle).toEqual(bundle);
  expect(state.diagnosis).toEqual(analysis);
  expect(state.canExecute).toBe(false);
  await act(async () => state.confirmAction());
  expect(native.alert).not.toHaveBeenCalled();

  native.fetchCurrentIncident.mockResolvedValue(bundle);
  native.executeApprovedAction.mockResolvedValue({ message: 'Fresh probe completed.' });
  await act(async () => {
    await state.refresh();
  });
  await act(async () => state.confirmAction());
  const approve = native.alert.mock.calls[0]![2].find(
    (button: { text: string }) => button.text === 'Approve',
  ).onPress;
  await act(async () => approve());
  await waitForIdle();
  expect(native.executeApprovedAction).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'RUN_HEALTH_CHECK', expectedVersion: null }),
  );
});

it('keeps storage failures visible after a successful live refresh or analysis', async () => {
  native.fetchCurrentIncident.mockResolvedValue(createSampleIncident());
  disk.failWrite = 'throw';
  await mount();
  expect(state.connection).toBe('live');
  expect(state.historyNotice).toContain('could not be saved');
  disk.failWrite = 'throw';
  await act(async () => {
    await state.analyze();
  });
  expect(state.diagnosis).not.toBeNull();
  expect(state.historyNotice).toContain('session only');
});

it('clears all on-disk generations and the open offline analysis without recreating it', async () => {
  const bundle = createSampleIncident();
  const imported = await cacheOfflineIncident(bundle, 'imported-incident');
  await cacheDiagnosis(imported, createDeterministicDiagnosis(bundle));
  await mount();
  expect(state.connection).toBe('imported');
  await act(async () => {
    await state.clearCache();
  });
  expect(state.diagnosis).toBeNull();
  expect(state.history).toEqual([]);
  expect(state.totalSaved).toBe(0);
  expect(state.connection).toBe('sample');
  expect(disk.files.size).toBe(0);
  await unmount();
  await mount();
  expect(state.diagnosis).toBeNull();
  expect(state.totalSaved).toBe(0);
  expect(disk.files.size).toBe(0);
});
