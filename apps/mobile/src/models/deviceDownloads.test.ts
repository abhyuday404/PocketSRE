import { beforeEach, expect, it, vi } from 'vitest';
import { MODEL_CATALOG, modelDownloadUrl } from './catalog';

const native = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  downloadFileAsync: vi.fn(),
  close: vi.fn(),
  remember: vi.fn(),
  selected: vi.fn(),
  forget: vi.fn(),
}));
vi.mock('expo-file-system', () => {
  const uriOf = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  return {
    Paths: { document: 'file:///app', availableDiskSpace: 10_000_000_000 },
    Directory: class {
      uri: string;
      constructor(...parts: (string | { uri: string })[]) {
        this.uri = uriOf(parts);
      }
      create() {}
    },
    File: class {
      uri: string;
      static downloadFileAsync = native.downloadFileAsync;
      constructor(...parts: (string | { uri: string })[]) {
        this.uri = uriOf(parts);
      }
      get exists() {
        return native.files.has(this.uri);
      }
      get size() {
        return native.files.get(this.uri)?.length ?? 0;
      }
      delete() {
        native.files.delete(this.uri);
      }
      async move(destination: { uri: string }) {
        await Promise.resolve();
        const data = native.files.get(this.uri);
        if (!data) throw new Error('source missing');
        native.files.set(destination.uri, data);
        native.files.delete(this.uri);
        this.uri = destination.uri;
      }
      open() {
        const data = native.files.get(this.uri)!;
        let offset = 0;
        return {
          readBytes(length: number) {
            const chunk = data.slice(offset, offset + length);
            offset += chunk.length;
            return chunk;
          },
          close: native.close,
        };
      }
    },
  };
});
vi.mock('../settings/model', () => ({
  rememberModel: native.remember,
  loadModelPath: native.selected,
  forgetModel: native.forget,
}));
import { deviceModelStorage as storage } from './deviceDownloads';

const model = {
  ...MODEL_CATALOG[0]!,
  bytes: 16,
  sha256: '1ef5107f394ec3b832bbcf48f4723c94100a3fe3da695bce60392a882777b7ff',
};
const partial = () => storage.path(model).replace(/\.gguf$/, '.part');
const bytes = () => {
  const data = new Uint8Array(16);
  data.set([71, 71, 85, 70, 3, 0, 0, 0]);
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  native.files.clear();
});

it('uses the pinned public URL and streams to a partial file before verification and promotion', async () => {
  native.downloadFileAsync.mockImplementation(async (_url, destination, options) => {
    native.files.set(destination.uri, bytes());
    options.onProgress({ bytesWritten: 16, totalBytes: -1 });
    return destination;
  });
  const controller = new AbortController();
  const progress = vi.fn();
  await storage.download(model, controller.signal, progress);
  expect(native.downloadFileAsync).toHaveBeenCalledWith(
    modelDownloadUrl(model),
    expect.objectContaining({ uri: partial() }),
    expect.objectContaining({ signal: controller.signal }),
  );
  expect(progress).toHaveBeenCalledWith(16);
  expect(storage.installed(model)).toBe(false);
  await storage.verify(model, controller.signal, vi.fn());
  await storage.promote(model);
  expect(storage.installed(model)).toBe(true);
  expect(native.files.has(partial())).toBe(false);
  expect(native.close).toHaveBeenCalledTimes(2);
});

it('does not expose signed CDN URLs from native HTTP failures', async () => {
  native.downloadFileAsync.mockRejectedValue(
    new Error('HTTP 403 https://cdn.example/?Signature=secret'),
  );
  await expect(storage.download(model, new AbortController().signal, vi.fn())).rejects.toThrow(
    'Check your connection',
  );
  expect(storage.installed(model)).toBe(false);
});

it('rejects wrong-size and corrupted native files and always closes verification handles', async () => {
  native.files.set(partial(), new Uint8Array(5));
  await expect(storage.verify(model, new AbortController().signal, vi.fn())).rejects.toThrow(
    /incomplete/,
  );
  expect(native.close).not.toHaveBeenCalled();
  native.files.set(partial(), new Uint8Array(16));
  await expect(storage.verify(model, new AbortController().signal, vi.fn())).rejects.toThrow(
    /GGUF/,
  );
  expect(native.close).toHaveBeenCalledOnce();
  expect(storage.installed(model)).toBe(false);
});

it('limits cleanup to catalog-owned partial files and preserves imported models', () => {
  native.files.set('file:///app/imported.gguf', bytes());
  native.files.set(storage.path(model), bytes());
  native.files.set(partial(), bytes());
  storage.discardPartial(model);
  expect(native.files.has(partial())).toBe(false);
  expect(native.files.has(storage.path(model))).toBe(true);
  expect(native.files.has('file:///app/imported.gguf')).toBe(true);
  storage.remove(model);
  expect(native.files.has(storage.path(model))).toBe(false);
  expect(native.files.has('file:///app/imported.gguf')).toBe(true);
});
