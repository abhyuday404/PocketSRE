import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { DownloadState } from '../models/downloads';
import { MODEL_CATALOG } from '../models/catalog';

const mocks = vi.hoisted(() => ({
  snapshot: { ready: true, installed: {}, message: '', error: '' } as DownloadState,
  listeners: new Set<() => void>(),
  initialize: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  remember: vi.fn(),
  save: vi.fn(),
  installed: vi.fn(),
  picker: vi.fn(),
  move: vi.fn(),
  openUrl: vi.fn(),
  loadModels: vi.fn(),
}));
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Linking: { openURL: mocks.openUrl },
}));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', ui: {} }));
vi.mock('./ModelPicker', () => ({ ModelPicker: 'ModelPicker' }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.picker }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///app' },
  File: class {
    uri: string;
    exists = true;
    size = 123;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    open() {
      return { readBytes: () => new Uint8Array([71, 71, 85, 70]), close: vi.fn() };
    }
    move = mocks.move;
  },
}));
vi.mock('../settings/model', () => ({
  rememberModel: mocks.remember,
  saveModelPath: mocks.save,
  loadModels: mocks.loadModels,
  getModelLibraryRevision: () => 0,
  subscribeModelLibrary: () => () => {},
}));
vi.mock('../models/deviceDownloads', () => ({
  modelDownloads: {
    initialize: mocks.initialize,
    download: mocks.download,
    cancel: mocks.cancel,
    remove: mocks.remove,
    getSnapshot: () => mocks.snapshot,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  },
  deviceModelStorage: { installed: mocks.installed, path: () => 'file:///downloaded.gguf' },
}));
import { LocalModel } from './LocalModel';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: ReactTestRenderer | undefined;
const model = MODEL_CATALOG[0]!;
const button = (label: string) =>
  renderer!.root.findAll(
    (node) =>
      (node.type === ('Button' as never) && node.props.label === label) ||
      (node.type === ('Pressable' as never) && node.props.accessibilityLabel === label),
  )[0]!;
const pick = async (name: string) => {
  await act(async () => {
    button('Choose on-device model').props.onPress();
  });
  await act(async () => {
    button(name).props.onPress();
  });
};
const text = () => JSON.stringify(renderer!.toJSON());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot = { ready: true, installed: {}, message: '', error: '' };
  mocks.installed.mockReturnValue(true);
  mocks.save.mockResolvedValue(undefined);
  mocks.remember.mockResolvedValue(undefined);
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.loadModels.mockResolvedValue([]);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});

it('keeps every model and import in one dropdown, showing only the chosen model details', async () => {
  await act(async () => {
    renderer = create(<LocalModel busy={false} onChange={vi.fn()} />);
  });
  expect(text()).not.toContain('Download Qwen');
  expect(text()).not.toContain('Import GGUF model');
  await act(async () => {
    button('Choose on-device model').props.onPress();
  });
  for (const item of MODEL_CATALOG) expect(button(item.name)).toBeDefined();
  expect(button('Import GGUF model')).toBeDefined();
  expect(button('Use local rules')).toBeDefined();
  await act(async () => {
    button('Qwen3 4B').props.onPress();
  });
  expect(button('Download Qwen3 4B')).toBeDefined();
  expect(text()).not.toContain('Download Qwen3 0.6B');
  expect(text()).not.toContain('Import GGUF model');
  expect(text()).toContain('2.50 GB');
  expect(mocks.download).not.toHaveBeenCalled();
  await act(async () => {
    button('Download Qwen3 4B').props.onPress();
  });
  expect(mocks.download).toHaveBeenCalledWith('qwen3-4b-q4');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('shows download progress, prevents competing operations, and keeps cancellation available during inference', async () => {
  mocks.snapshot.active = { id: model.id, phase: 'downloading', bytes: model.bytes / 2 };
  await act(async () => {
    renderer = create(<LocalModel busy onChange={vi.fn()} />);
  });
  expect(text()).toContain('Downloading 50%');
  const progressbar = () => renderer!.root.findByProps({ accessibilityRole: 'progressbar' });
  expect(progressbar().props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
  expect(progressbar().findAllByType('View' as never)[1]!.props.style.width).toBe('50%');
  await act(async () => {
    mocks.snapshot = {
      ...mocks.snapshot,
      active: { id: model.id, phase: 'verifying', bytes: model.bytes / 4 },
    };
    mocks.listeners.forEach((listener) => listener());
  });
  expect(text()).toContain('Verifying download 25%');
  expect(progressbar().props.accessibilityValue.now).toBe(25);
  expect(progressbar().findAllByType('View' as never)[1]!.props.style.width).toBe('25%');
  expect(button('Choose on-device model').props.disabled).toBe(true);
  expect(button('Cancel download').props.disabled).toBe(false);
  await act(async () => {
    button('Cancel download').props.onPress();
  });
  expect(mocks.cancel).toHaveBeenCalledOnce();
});

it('uses a downloaded model only on explicit selection, persists it, and does not redownload', async () => {
  mocks.snapshot.installed = { [model.id]: 'file:///downloaded.gguf' };
  const changed = vi.fn();
  await act(async () => {
    renderer = create(<LocalModel busy={false} onChange={changed} />);
  });
  expect(changed).not.toHaveBeenCalled();
  await pick(model.name);
  await act(async () => {
    button(`Use ${model.name}`).props.onPress();
  });
  expect(mocks.remember).toHaveBeenCalledWith('file:///downloaded.gguf', model.name);
  expect(mocks.save).toHaveBeenCalledWith('file:///downloaded.gguf');
  expect(changed).toHaveBeenCalledWith('file:///downloaded.gguf');
  expect(mocks.download).not.toHaveBeenCalled();
});

it('does not switch the runtime when saving the selection fails', async () => {
  mocks.snapshot.installed = { [model.id]: 'file:///downloaded.gguf' };
  mocks.save.mockRejectedValueOnce(new Error('Unable to save model setting'));
  const changed = vi.fn();
  await act(async () => {
    renderer = create(<LocalModel busy={false} onChange={changed} />);
  });
  await pick(model.name);
  await act(async () => {
    button(`Use ${model.name}`).props.onPress();
  });
  expect(changed).not.toHaveBeenCalled();
  expect(text()).toContain('Unable to save model setting');
  expect(button(`Use ${model.name}`).props.disabled).toBe(false);
});

it('protects the selected model from removal and lets users return to local rules', async () => {
  mocks.snapshot.installed = { [model.id]: 'file:///downloaded.gguf' };
  const changed = vi.fn();
  await act(async () => {
    renderer = create(
      <LocalModel path="file:///downloaded.gguf" busy={false} onChange={changed} />,
    );
  });
  expect(button(`Remove ${model.name}`).props.disabled).toBe(true);
  await pick('Use local rules');
  expect(mocks.save).toHaveBeenCalledWith('');
  expect(changed).toHaveBeenCalledWith('');
});

it('waits for imported files to finish moving before publishing the model path', async () => {
  let finish!: () => void;
  mocks.move.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/model.gguf', name: 'mine.gguf' }],
  });
  const changed = vi.fn();
  await act(async () => {
    renderer = create(<LocalModel busy={false} onChange={changed} />);
  });
  await pick('Import GGUF model');
  expect(mocks.move).toHaveBeenCalledOnce();
  expect(mocks.remember).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  await act(async () => {
    finish();
  });
  expect(mocks.remember).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce();
});

it('recovers after a failed import move without saving a broken path', async () => {
  mocks.move.mockRejectedValueOnce(new Error('Not enough storage'));
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/model.gguf', name: 'mine.gguf' }],
  });
  await act(async () => {
    renderer = create(<LocalModel busy={false} onChange={vi.fn()} />);
  });
  await pick('Import GGUF model');
  expect(mocks.remember).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(text()).toContain('Not enough storage');
  expect(button('Choose on-device model').props.disabled).toBe(false);
});
it('selects an existing imported model from the same dropdown', async () => {
  mocks.loadModels.mockResolvedValue([{ path: 'file:///saved.gguf', name: 'My model' }]);
  const changed = vi.fn();
  await act(async () => {
    renderer = create(<LocalModel busy={false} onChange={changed} />);
  });
  await pick('My model');
  expect(mocks.save).toHaveBeenCalledWith('file:///saved.gguf');
  expect(changed).toHaveBeenCalledWith('file:///saved.gguf');
  expect(mocks.picker).not.toHaveBeenCalled();
});
