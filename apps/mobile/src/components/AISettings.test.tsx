import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const api = vi.hoisted(() => ({ save: vi.fn(), local: vi.fn(), remove: vi.fn() }));
vi.mock('react-native', () => ({ Text: 'Text', TextInput: 'TextInput', View: 'View' }));
vi.mock('./ui', () => ({ Badge: 'Badge', Button: 'Button', Card: 'Card', ui: {} }));
vi.mock('./LocalModel', () => ({ LocalModel: 'LocalModel' }));
vi.mock('../ai/CloudTriageEngine', () => ({ CloudTriageEngine: class {} }));
vi.mock('../settings/ai', () => ({
  saveCloudAI: api.save,
  useLocalAI: api.local,
  removeCloudKey: api.remove,
}));
import { AISettings } from './AISettings';
import type { AISettings as Settings } from '../settings/ai';
const local: Settings = { source: 'local', provider: 'openai', profiles: {} };
const cloud: Settings = {
  source: 'cloud',
  provider: 'openai',
  profiles: {
    openai: {
      provider: 'openai',
      model: 'test-model',
      baseUrl: 'https://api.openai.com/v1',
      hasKey: true,
    },
  },
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer;
function Harness({ initial = local }: { initial?: Settings }) {
  const [settings, setSettings] = useState(initial);
  return (
    <AISettings
      settings={settings}
      path="file:///existing.gguf"
      busy={false}
      onChange={setSettings}
      onModelChange={vi.fn()}
    />
  );
}
const button = (label: string) =>
  renderer.root.findAll(
    (node) => node.type === ('Button' as never) && node.props.label === label,
  )[0]!;
const field = (label: string) => renderer.root.findByProps({ accessibilityLabel: label });
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.clearAllMocks();
});
it('keeps the local picker and does not enable cloud merely by opening its settings', async () => {
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(renderer.root.findByType('LocalModel' as never).props.path).toBe('file:///existing.gguf');
  await act(async () => button('Use an API key').props.onPress());
  expect(api.save).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('API charges');
  expect(field('AI provider API key').props.secureTextEntry).toBe(true);
  await act(async () => {
    field('API model ID').props.onChangeText('test-model');
    field('AI provider API key').props.onChangeText('test-only-entered-key');
  });
  api.save.mockResolvedValue(cloud);
  await act(async () => button('Save and use API model').props.onPress());
  expect(api.save).toHaveBeenCalledWith(
    { provider: 'openai', model: 'test-model', baseUrl: 'https://api.openai.com/v1' },
    'test-only-entered-key',
  );
  expect(field('AI provider API key').props.value).toBe('');
  expect(JSON.stringify(renderer.toJSON())).toContain('Active: OpenAI');
});
it('clears unsaved keys on provider switches and keeps the local selection when returning', async () => {
  await act(async () => {
    renderer = create(<Harness initial={cloud} />);
  });
  await act(async () => field('AI provider API key').props.onChangeText('test-only-unsaved'));
  await act(async () => button('Anthropic').props.onPress());
  expect(field('AI provider API key').props.value).toBe('');
  expect(field('API model ID').props.value).toBe('');
  await act(async () => button('On-device models').props.onPress());
  expect(renderer.root.findByType('LocalModel' as never).props.busy).toBe(true);
  api.local.mockResolvedValue({ ...cloud, source: 'local' });
  await act(async () => button('Switch to on-device').props.onPress());
  expect(renderer.root.findByType('LocalModel' as never).props).toMatchObject({
    path: 'file:///existing.gguf',
    busy: false,
  });
});
it('shows save failures without changing the active model', async () => {
  await act(async () => {
    renderer = create(<Harness />);
  });
  await act(async () => button('Use an API key').props.onPress());
  api.save.mockRejectedValue(new Error('Could not save AI settings securely.'));
  await act(async () => button('Save and use API model').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('Could not save AI settings securely.');
  expect(JSON.stringify(renderer.toJSON())).toContain('Active: your selected local model');
});
