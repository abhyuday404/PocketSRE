import { beforeEach, expect, it, vi } from 'vitest';
import { MODEL_CATALOG } from './catalog';
import { ModelDownloads, type ModelDownloadStorage } from './downloads';

const model = MODEL_CATALOG[0]!;
const path = 'file:///app/models/verified.gguf';
let storage: ModelDownloadStorage;
let manager: ModelDownloads;
let complete: Set<string>;
beforeEach(() => {
  complete = new Set();
  storage = {
    prepare: vi.fn(),
    path: () => path,
    installed: (item) => complete.has(item.id),
    discardPartial: vi.fn(),
    freeBytes: () => 10_000_000_000,
    download: vi.fn(async (_model, _signal, progress) => {
      progress(model.bytes);
    }),
    verify: vi.fn(async (_model, _signal, progress) => {
      progress(model.bytes);
    }),
    promote: vi.fn(async (item) => {
      complete.add(item.id);
    }),
    remove: vi.fn((item) => {
      complete.delete(item.id);
    }),
    remember: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    selected: vi.fn(async () => undefined),
  };
  manager = new ModelDownloads(storage);
});

it('downloads, verifies, then registers a model without changing the active selection', async () => {
  const phases: string[] = [];
  manager.subscribe(() => {
    if (manager.getSnapshot().active) phases.push(manager.getSnapshot().active!.phase);
  });
  await manager.download(model.id);
  expect(phases).toContain('downloading');
  expect(phases).toContain('verifying');
  expect(phases).toContain('saving');
  expect(vi.mocked(storage.verify).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(storage.promote).mock.invocationCallOrder[0]!,
  );
  expect(vi.mocked(storage.promote).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(storage.remember).mock.invocationCallOrder[0]!,
  );
  expect(manager.getSnapshot().installed[model.id]).toBe(path);
  expect(manager.getSnapshot().active).toBeUndefined();
  expect(storage.remember).toHaveBeenCalledWith(path, model.name);
  expect(storage.selected).not.toHaveBeenCalled();
});

it('retains progress without subscribers and rejects overlapping download attempts', async () => {
  let finish!: () => void;
  storage.download = vi.fn(
    (_model, _signal, progress) =>
      new Promise<void>((resolve) => {
        progress(123_000_000);
        finish = resolve;
      }),
  );
  const stop = manager.subscribe(vi.fn());
  const first = manager.download(model.id);
  await vi.waitFor(() => expect(storage.download).toHaveBeenCalledOnce());
  stop();
  await manager.download(MODEL_CATALOG[1]!.id);
  expect(manager.getSnapshot().active?.bytes).toBe(123_000_000);
  expect(storage.download).toHaveBeenCalledOnce();
  finish();
  await first;
  expect(manager.getSnapshot().installed[model.id]).toBe(path);
});

it('checks space before transferring and allows a fresh retry after storage is freed', async () => {
  storage.freeBytes = () => model.bytes;
  await manager.download(model.id);
  expect(storage.download).not.toHaveBeenCalled();
  expect(manager.getSnapshot().error).toMatch(/Free at least/);
  storage.freeBytes = () => model.bytes + 128 * 1024 * 1024;
  await manager.download(model.id);
  expect(manager.getSnapshot().error).toBe('');
  expect(storage.download).toHaveBeenCalledOnce();
});

it('cleans partial files on a failed transfer and retries without publishing a broken model', async () => {
  vi.mocked(storage.download).mockRejectedValueOnce(new Error('Network lost'));
  await manager.download(model.id);
  expect(manager.getSnapshot().error).toBe('Network lost');
  expect(storage.verify).not.toHaveBeenCalled();
  expect(storage.remember).not.toHaveBeenCalled();
  expect(storage.discardPartial).toHaveBeenLastCalledWith(model);
  expect(manager.getSnapshot().installed).toEqual({});
  await manager.download(model.id);
  expect(storage.download).toHaveBeenCalledTimes(2);
  expect(manager.getSnapshot().installed[model.id]).toBe(path);
});

it('never promotes or registers a file which fails verification', async () => {
  vi.mocked(storage.verify).mockRejectedValueOnce(new Error('Checksum mismatch'));
  await manager.download(model.id);
  expect(storage.promote).not.toHaveBeenCalled();
  expect(storage.remember).not.toHaveBeenCalled();
  expect(manager.getSnapshot().error).toBe('Checksum mismatch');
  expect(storage.discardPartial).toHaveBeenLastCalledWith(model);
});

it('cancels an active transfer, waits for native completion, cleans up, and permits retry', async () => {
  vi.mocked(storage.download).mockImplementationOnce(
    (_model, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('native cancelled')), {
          once: true,
        });
      }),
  );
  const first = manager.download(model.id);
  await vi.waitFor(() => expect(storage.download).toHaveBeenCalledOnce());
  manager.cancel();
  await first;
  expect(manager.getSnapshot().message).toMatch(/cancelled/);
  expect(manager.getSnapshot().active).toBeUndefined();
  expect(storage.promote).not.toHaveBeenCalled();
  await manager.download(model.id);
  expect(manager.getSnapshot().installed[model.id]).toBe(path);
});

it('cancels before the first transfer and during verification', async () => {
  const first = manager.download(model.id);
  manager.cancel();
  await first;
  expect(storage.download).not.toHaveBeenCalled();
  storage.verify = vi.fn(async () => {
    manager.cancel();
  });
  await manager.download(model.id);
  expect(storage.promote).not.toHaveBeenCalled();
  expect(manager.getSnapshot().installed).toEqual({});
});

it('times out a stalled connection and makes the error recoverable', async () => {
  vi.useFakeTimers();
  try {
    storage.download = vi.fn(
      (_model, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stalled')), { once: true });
        }),
    );
    const pending = manager.download(model.id);
    await vi.advanceTimersByTimeAsync(90_001);
    await pending;
    expect(manager.getSnapshot().error).toMatch(/stopped responding/);
    expect(storage.promote).not.toHaveBeenCalled();
    expect(manager.getSnapshot().active).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it('reuses an already verified download when saving the library failed', async () => {
  vi.mocked(storage.remember).mockRejectedValueOnce(new Error('secure store failure'));
  await manager.download(model.id);
  expect(manager.getSnapshot().installed[model.id]).toBe(path);
  expect(manager.getSnapshot().error).toMatch(/library entry/);
  await manager.download(model.id);
  expect(storage.download).toHaveBeenCalledOnce();
  expect(storage.remember).toHaveBeenCalledTimes(2);
  expect(manager.getSnapshot().error).toBe('');
});

it('recovers installed files after process restart while clearing unfinished downloads', async () => {
  complete.add(model.id);
  await manager.initialize();
  expect(manager.getSnapshot().installed).toEqual({ [model.id]: path });
  expect(storage.discardPartial).toHaveBeenCalledTimes(MODEL_CATALOG.length);
  expect(storage.download).not.toHaveBeenCalled();
  expect(storage.remember).not.toHaveBeenCalled();
});

it('can retry initialization after inaccessible storage', async () => {
  vi.mocked(storage.prepare).mockImplementationOnce(() => {
    throw new Error('storage locked');
  });
  await manager.initialize();
  expect(manager.getSnapshot().ready).toBe(false);
  await manager.initialize();
  expect(manager.getSnapshot().ready).toBe(true);
});

it('refuses deletion of selected or configured models and removes only an unused catalog file', async () => {
  complete.add(model.id);
  await manager.initialize();
  await manager.remove(model.id, path);
  expect(storage.remove).not.toHaveBeenCalled();
  vi.mocked(storage.selected).mockResolvedValueOnce(path);
  await manager.remove(model.id);
  expect(storage.remove).not.toHaveBeenCalled();
  await manager.remove(model.id);
  expect(storage.forget).toHaveBeenCalledWith(path);
  expect(storage.remove).toHaveBeenCalledWith(model);
  expect(manager.getSnapshot().installed).toEqual({});
});
