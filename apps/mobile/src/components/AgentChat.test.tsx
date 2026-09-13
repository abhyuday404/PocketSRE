import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('./ui', () => ({ Button: 'Button', Icon: 'Icon', ui: {} }));
import { AgentChat } from './AgentChat';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
it('attaches a suggested repository file, enables sending, and removes its reference', async () => {
  const send = vi.fn();
  let view!: ReactTestRenderer;
  function Harness() {
    const [request, setRequest] = useState('Explain @src');
    const [paths, setPaths] = useState<string[]>([]);
    return (
      <AgentChat
        files={{
          paths: ['src/app.ts', 'docs/readme.md'],
          loading: false,
          error: '',
          truncated: false,
          refresh: vi.fn(),
          prepare: vi.fn(),
        }}
        request={request}
        onRequest={setRequest}
        paths={paths}
        onPaths={setPaths}
        conversation={[]}
        activeRequest=""
        working={false}
        disabled={false}
        modelAvailable
        review={null}
        hasDraft={false}
        message=""
        onSend={() => send({ request, paths })}
        onNew={vi.fn()}
      />
    );
  }
  await act(async () => {
    view = create(<Harness />);
  });
  try {
    expect(
      view.root.findByProps({ accessibilityLabel: 'Send to agent' }).props.disabled,
    ).toBe(true);
    await act(async () => {
      view.root.findByProps({ accessibilityLabel: 'Attach src/app.ts' }).props.onPress();
    });
    expect(view.root.findByProps({ accessibilityLabel: 'Agent request' }).props.value).toBe(
      'Explain @src/app.ts ',
    );
    await act(async () => {
      view.root.findByProps({ accessibilityLabel: 'Send to agent' }).props.onPress();
    });
    expect(send).toHaveBeenCalledWith({ request: 'Explain @src/app.ts ', paths: ['src/app.ts'] });
    await act(async () => {
      view.root.findByProps({ accessibilityLabel: 'Remove attachment src/app.ts' }).props.onPress();
    });
    expect(view.root.findByProps({ accessibilityLabel: 'Agent request' }).props.value).toBe(
      'Explain  ',
    );
    expect(
      view.root.findByProps({ accessibilityLabel: 'Send to agent' }).props.disabled,
    ).toBe(true);
  } finally {
    await act(async () => view.unmount());
  }
});
