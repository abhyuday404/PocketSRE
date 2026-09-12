import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleIncident } from './data/sampleIncident';
import { createDeterministicDiagnosis } from '@pocketsre/incident-engine';

const mocks = vi.hoisted(() => ({ state: null, get: vi.fn(), set: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: mocks.get, setItemAsync: mocks.set }));
vi.mock('./hooks/useIncident', () => ({ useIncident: () => mocks.state }));
vi.mock('./storage/incidents', () => ({ HISTORY_LIMITS: { perIncident: 5, perScope: 30 } }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
import App from './App';

let rendered;
let savedTheme;
const visibleText = () =>
  rendered.root
    .findAllByType('Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join(' ');
const control = (label) =>
  rendered.root
    .findAllByType('Pressable')
    .find(
      (node) =>
        node.props.accessibilityLabel === label ||
        node.findAllByType('Text').some((text) => text.children.join('') === label),
    );
const press = async (label) => {
  const node = control(label);
  expect(node, label).toBeDefined();
  await act(async () => node.props.onPress());
};
const mount = async () => {
  await act(async () => {
    rendered = create(React.createElement(App));
  });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  savedTheme = null;
  mocks.get.mockReset().mockImplementation(async () => savedTheme);
  mocks.set.mockReset().mockImplementation(async (_key, value) => {
    savedTheme = value;
  });
  const bundle = createSampleIncident();
  mocks.state = {
    bundle,
    diagnosis: null,
    busy: false,
    connection: 'sample',
    mode: null,
    message: 'Sample ready',
    settings: { url: 'http://127.0.0.1:4100', token: '' },
    history: [],
    totalSaved: 0,
    historyNotice: null,
    capturedAt: null,
    analyzedAt: null,
    audit: [],
    canExecute: false,
    ...Object.fromEntries(
      [
        'refresh',
        'analyze',
        'breakDemo',
        'restoreDemo',
        'confirmAction',
        'shareBundle',
        'importFile',
        'selectHistory',
        'updateConnection',
        'clearCache',
      ].map((name) => [name, vi.fn(async () => {})]),
    ),
  };
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
});

describe('mobile interaction flows', () => {
  it('filters evidence, clears an empty search, and expands the original evidence details', async () => {
    await mount();
    await press('Activity');
    const search = rendered.root.findByType('TextInput');
    await act(async () => search.props.onChangeText('no-such-signal-123'));
    expect(visibleText()).toContain('No matching signals');
    expect(visibleText()).toContain('0 of ');
    await press('Clear');
    expect(visibleText()).not.toContain('No matching signals');
    const event = mocks.state.bundle.evidence[0];
    await act(async () => search.props.onChangeText(event.id.toUpperCase()));
    expect(visibleText()).toContain('1 of ');
    await press('Expand ' + event.title);
    expect(visibleText()).toContain('Evidence ID: ' + event.id);
    expect(control('Collapse ' + event.title).props.accessibilityState.expanded).toBe(true);
  });

  it('limits evidence to citations and resets filters when opening the timeline from overview', async () => {
    const event = mocks.state.bundle.evidence[0];
    mocks.state.diagnosis = {
      ...createDeterministicDiagnosis(mocks.state.bundle),
      evidenceIds: [event.id],
      alternativeCauses: [],
      proposedAction: undefined,
    };
    await mount();
    await press('Activity');
    await press('Show only cited evidence');
    expect(visibleText()).toContain('1 of ');
    expect(control('Show only cited evidence').props.accessibilityState.checked).toBe(true);
    await act(async () => rendered.root.findByType('TextInput').props.onChangeText('missing'));
    await press('Overview');
    await press('Timeline');
    expect(rendered.root.findByType('TextInput').props.value).toBe('');
    expect(control('Show only cited evidence').props.accessibilityState.checked).toBe(false);
    expect(visibleText()).not.toContain('No matching signals');
  });

  it('applies themes across navigation and restores the saved choice on remount', async () => {
    await mount();
    await press('Settings');
    await press('Lavender theme');
    await press('Dusk theme');
    expect(control('Dusk theme').props.accessibilityState.checked).toBe(true);
    expect(rendered.root.findByType('StatusBar').props.style).toBe('light');
    await press('Activity');
    expect(rendered.root.findByType('StatusBar').props.style).toBe('light');
    await act(async () => rendered.unmount());
    await mount();
    await press('Settings');
    expect(control('Dusk theme').props.accessibilityState.checked).toBe(true);
    expect(savedTheme).toBe('dusk');
    await press('Sage theme');
    expect(rendered.root.findByType('StatusBar').props.style).toBe('dark');
  });

  it('keeps a theme usable when saving fails and ignores invalid stored preferences', async () => {
    savedTheme = 'unknown-theme';
    mocks.set.mockRejectedValue(new Error('Storage unavailable'));
    await mount();
    await press('Settings');
    expect(control('Sage theme').props.accessibilityState.checked).toBe(true);
    await press('Dusk theme');
    expect(control('Dusk theme').props.accessibilityState.checked).toBe(true);
    expect(visibleText()).toContain('could not be saved');
  });

  it('keeps analysis accessible from overview and explains empty activity tabs', async () => {
    await mount();
    await press('Analyze incident');
    expect(mocks.state.analyze).toHaveBeenCalledOnce();
    await press('Activity');
    await press('Actions');
    expect(visibleText()).toContain('Action history needs a live connection');
    await press('Saved');
    expect(visibleText()).toContain('Nothing saved here yet');
    await press('Overview');
    expect(visibleText()).toContain('Snapshot health');
  });

  it('opens the new saved snapshot format while keeping the chosen theme', async () => {
    const item = {
      id: 'saved-snapshot',
      source: 'gateway',
      gateway: mocks.state.settings.url,
      capturedAt: mocks.state.bundle.generatedAt,
      bundle: mocks.state.bundle,
      diagnosis: {
        snapshotId: 'saved-snapshot',
        analyzedAt: mocks.state.bundle.generatedAt,
        value: createDeterministicDiagnosis(mocks.state.bundle),
      },
    };
    mocks.state.history = [item];
    mocks.state.totalSaved = 1;
    await mount();
    await press('Settings');
    await press('Dusk theme');
    expect(visibleText()).toContain('1 snapshots');
    await press('Activity');
    await press('Saved');
    expect(visibleText()).toContain('Reopen analysis from');
    await press('Open Saved gateway: ' + item.bundle.incident.title + ', with saved analysis');
    expect(mocks.state.selectHistory).toHaveBeenCalledWith(item);
    expect(control('Overview').props.accessibilityState.selected).toBe(true);
    expect(rendered.root.findByType('StatusBar').props.style).toBe('light');
  });
});
