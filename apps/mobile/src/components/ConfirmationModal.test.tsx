import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const keyboard = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('react-native', () => ({
  Keyboard: keyboard,
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('./ui', () => ({ Button: 'Button' }));
import { ConfirmationProvider, useConfirmation } from './ConfirmationModal';
import { colors } from '../theme';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer;
let confirm: ReturnType<typeof useConfirmation>;
const approve = vi.fn();
const cancel = vi.fn();
function Consumer() {
  confirm = useConfirmation();
  return null;
}
async function open() {
  await act(async () => {
    renderer = create(
      <ConfirmationProvider>
        <Consumer />
      </ConfirmationProvider>,
    );
  });
  await act(async () => {
    confirm('Remove this project?', 'Your GitHub repository will remain.', [
      { text: 'Cancel', style: 'cancel', onPress: cancel },
      { text: 'Remove project', style: 'destructive', onPress: approve },
    ]);
  });
}
const button = (label: string) =>
  renderer.root.findAll(
    (node) => node.type === ('Button' as never) && node.props.label === label,
  )[0]!;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.clearAllMocks();
});

it('shows the requested details and destructive styling, and approves only once', async () => {
  await open();
  expect(JSON.stringify(renderer.toJSON())).toContain('Your GitHub repository will remain.');
  expect(keyboard.dismiss).toHaveBeenCalledOnce();
  expect(approve).not.toHaveBeenCalled();
  expect(button('Remove project').props.style).toContainEqual({
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  });
  const press = button('Remove project').props.onPress;
  await act(async () => {
    press();
    press();
  });
  expect(approve).toHaveBeenCalledOnce();
  expect(cancel).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('Modal' as never)).toHaveLength(0);
});

it.each(['button', 'back', 'backdrop', 'accessibility escape'])(
  'cancels through %s without approving',
  async (method) => {
    await open();
    await act(async () => {
      if (method === 'button') button('Cancel').props.onPress();
      else if (method === 'back') renderer.root.findByType('Modal' as never).props.onRequestClose();
      else if (method === 'backdrop')
        renderer.root.findByProps({ testID: 'confirmation-backdrop' }).props.onPress();
      else
        renderer.root.findByProps({ accessibilityViewIsModal: true }).props.onAccessibilityEscape();
    });
    expect(approve).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType('Modal' as never)).toHaveLength(0);
  },
);

it('invalidates pending approval when its originating screen unmounts', async () => {
  await open();
  const press = button('Remove project').props.onPress;
  await act(async () => {
    renderer.update(<ConfirmationProvider />);
  });
  await act(async () => press());
  expect(approve).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('Modal' as never)).toHaveLength(0);
});
