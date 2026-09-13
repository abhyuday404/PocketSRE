import { expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  TextInput: 'TextInput',
  Switch: 'Switch',
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Icon: 'Icon', ui: {} }));
import { Connections } from './Connections';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
it('keeps fields collapsed and reuses a key for a changed address only when explicitly selected', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <Connections
        settings={{ url: 'https://old.example', token: 'saved-fixture' }}
        busy={false}
        onSave={save}
      />,
    );
  });
  try {
    expect(view.root.findAllByProps({ accessibilityLabel: 'Server URL' })).toHaveLength(0);
    await act(async () => {
      view.root.findByProps({ label: 'Server connection' }).props.onPress();
    });
    await act(async () => {
      view.root
        .findByProps({ accessibilityLabel: 'Server URL' })
        .props.onChangeText('https://new.example');
    });
    await act(async () => {
      view.root.findByProps({ label: 'Save connection' }).props.onPress();
    });
    expect(save).toHaveBeenLastCalledWith({ url: 'https://new.example', token: '' });
    await act(async () => {
      view.root
        .findByProps({ accessibilityLabel: 'Use saved key for the same PC' })
        .props.onValueChange(true);
    });
    await act(async () => {
      view.root.findByProps({ label: 'Save connection' }).props.onPress();
    });
    expect(save).toHaveBeenLastCalledWith({ url: 'https://new.example', token: 'saved-fixture' });
    await act(async () => {
      view.root
        .findByProps({ accessibilityLabel: 'Server URL' })
        .props.onChangeText('https://different.example');
    });
    expect(
      view.root.findByProps({ accessibilityLabel: 'Use saved key for the same PC' }).props.value,
    ).toBe(false);
  } finally {
    await act(async () => {
      view.unmount();
    });
  }
});
