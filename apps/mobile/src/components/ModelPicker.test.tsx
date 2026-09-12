import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const values = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
}));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View' }));
vi.mock('./ui', () => ({ Button: 'Button', ui: {} }));
import { rememberModel, forgetModel } from '../settings/model';
import { ModelPicker } from './ModelPicker';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer | undefined;
const buttons = () => renderer!.root.findAll((node) => node.type === ('Button' as never));
beforeEach(() => values.clear());
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});

it('refreshes a mounted picker when another screen downloads or removes a model', async () => {
  await act(async () => {
    renderer = create(<ModelPicker busy={false} onChange={vi.fn()} />);
  });
  await act(async () => {
    buttons()[0]!.props.onPress();
  });
  await act(async () => {
    await rememberModel('file:///download.gguf', 'New download');
  });
  expect(buttons().map((button) => button.props.label)).toContain('New download');
  await act(async () => {
    await forgetModel('file:///download.gguf');
  });
  expect(buttons().map((button) => button.props.label)).not.toContain('New download');
});
