import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ChatCompletion } from '../ai/LocalTriageEngine';
vi.mock('react-native', () => ({ Text: 'Text', TextInput: 'TextInput', View: 'View' }));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', ui: {} }));
import { TempChat } from './TempChat';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const chat = vi.fn<ChatCompletion>();
let renderer: ReactTestRenderer | undefined;
const button = (label: string) => renderer!.root.findByProps({ label });
const input = () => renderer!.root.findByProps({ accessibilityLabel: 'Temporary chat message' });
async function mount(modelAvailable = true) {
  await act(async () => {
    renderer = create(
      <TempChat
        chat={chat}
        busy={false}
        modelAvailable={modelAvailable}
        onOpenSettings={vi.fn()}
      />,
    );
  });
}
async function send(value = 'Hello model') {
  await act(async () => input().props.onChangeText(value));
  await act(async () => button('Send message').props.onPress());
}
beforeEach(() => {
  vi.resetAllMocks();
  chat.mockResolvedValue({ text: 'Hello human', limited: false });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

it('supports follow-ups without a gateway and clears all temporary messages', async () => {
  await mount();
  await send();
  await send('Continue');
  expect(chat.mock.calls[1]![0]).toEqual([
    { role: 'user', content: 'Hello model' },
    { role: 'assistant', content: 'Hello human' },
    { role: 'user', content: 'Continue' },
  ]);
  await act(async () => button('Clear chat').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('Hello human');
  await send('Fresh');
  expect(chat.mock.calls[2]![0]).toEqual([{ role: 'user', content: 'Fresh' }]);
});

it('requires an imported model and a nonblank message', async () => {
  await mount(false);
  await act(async () => input().props.onChangeText('Hello'));
  expect(button('Send message').props.disabled).toBe(true);
  expect(button('Import a model in Settings')).toBeDefined();
  expect(chat).not.toHaveBeenCalled();
});

it('streams a partial response and supports stopping without duplicating sends', async () => {
  let finish!: () => void;
  chat.mockImplementationOnce(
    (_messages, token, signal) =>
      new Promise((resolve) => {
        token('Partial answer');
        finish = () => resolve({ text: 'Partial answer', limited: false });
        signal.addEventListener('abort', finish);
      }),
  );
  await mount();
  await send();
  expect(JSON.stringify(renderer!.toJSON())).toContain('Partial answer');
  await act(async () => button('Stop generating').props.onPress());
  expect(chat.mock.calls[0]![2].aborted).toBe(true);
  expect(button('Send message')).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain('Stopped.');
});

it('restores the input after failure and releases the send lock', async () => {
  chat.mockRejectedValueOnce(new Error('Model load failed'));
  await mount();
  await send();
  expect(input().props.value).toBe('Hello model');
  expect(JSON.stringify(renderer!.toJSON())).toContain('Model load failed');
  await act(async () => button('Send message').props.onPress());
  expect(chat).toHaveBeenCalledTimes(2);
  expect(chat.mock.calls[1]![0]).toHaveLength(1);
});

it('aborts an outstanding request on unmount and does not restore chat after remount', async () => {
  chat.mockImplementationOnce(
    (_messages, _token, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Stopped'))),
      ),
  );
  await mount();
  await send();
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(chat.mock.calls[0]![2].aborted).toBe(true);
  await mount();
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('Hello model');
});
