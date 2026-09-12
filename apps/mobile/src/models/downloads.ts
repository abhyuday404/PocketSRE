import { MODEL_CATALOG, formatBytes, type DownloadableModel } from './catalog';

export type DownloadPhase = 'preparing' | 'downloading' | 'verifying' | 'saving' | 'cancelling';
export type DownloadState = {
  ready: boolean;
  installed: Record<string, string>;
  active?: { id: string; phase: DownloadPhase; bytes: number };
  removing?: string;
  message: string;
  error: string;
  outcomeId?: string;
};

// The lifecycle is independent of React screens, so changing tabs doesn't lose
// progress, start a second transfer, or select a model during inference.
export interface ModelDownloadStorage {
  prepare(): void;
  path(model: DownloadableModel): string;
  installed(model: DownloadableModel): boolean;
  discardPartial(model: DownloadableModel): void;
  freeBytes(): number;
  download(
    model: DownloadableModel,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ): Promise<void>;
  verify(
    model: DownloadableModel,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ): Promise<void>;
  promote(model: DownloadableModel): Promise<void>;
  remove(model: DownloadableModel): void;
  remember(path: string, name: string): Promise<void>;
  forget(path: string): Promise<void>;
  selected(): Promise<string | undefined>;
}

export class ModelDownloads {
  private state: DownloadState = { ready: false, installed: {}, message: '', error: '' };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private controller?: AbortController;
  private locked = false;

  constructor(
    private storage: ModelDownloadStorage,
    private catalog = MODEL_CATALOG,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<DownloadState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  initialize = (): Promise<void> => {
    if (!this.initialization) {
      this.initialization = this.scan().catch(() => {
        this.initialization = undefined;
        this.update({ error: 'Could not open model storage. Free some space and try again.' });
      });
    }
    return this.initialization;
  };
  private async scan() {
    this.storage.prepare();
    const installed: Record<string, string> = {};
    for (const model of this.catalog) {
      // A process killed before verification leaves only a partial file. Never
      // advertise it as installed; reclaim it before the next fresh attempt.
      this.storage.discardPartial(model);
      if (this.storage.installed(model)) installed[model.id] = this.storage.path(model);
    }
    this.update({ ready: true, installed, error: '' });
  }

  cancel = () => {
    if (!this.controller || this.state.active?.phase === 'saving') return;
    this.update({ active: this.state.active && { ...this.state.active, phase: 'cancelling' } });
    this.controller.abort();
  };

  download = async (id: string): Promise<void> => {
    if (this.locked) return;
    const model = this.catalog.find((item) => item.id === id);
    if (!model) return;
    this.locked = true;
    const controller = new AbortController();
    this.controller = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let promoted = false;
    let lastBytes = 0;
    const checkCancelled = () => {
      if (controller.signal.aborted) throw new Error('Download cancelled.');
    };
    const progress = (phase: DownloadPhase, bytes = 0) => {
      if (!controller.signal.aborted)
        this.update({ active: { id, phase, bytes: Math.max(0, Math.min(model.bytes, bytes)) } });
    };
    const watchConnection = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 90_000);
    };
    this.update({
      active: { id, phase: 'preparing', bytes: 0 },
      message: '',
      error: '',
      outcomeId: id,
    });
    try {
      await this.initialize();
      if (!this.state.ready) throw new Error('Model storage is unavailable. Try again.');
      checkCancelled();
      if (!this.storage.installed(model)) {
        this.storage.discardPartial(model);
        const required = model.bytes + 128 * 1024 * 1024;
        const free = this.storage.freeBytes();
        if (!Number.isFinite(free) || free < required)
          throw new Error(`Free at least ${formatBytes(required)} of storage, then retry.`);
        progress('downloading');
        watchConnection();
        await this.storage.download(model, controller.signal, (bytes) => {
          if (
            this.controller !== controller ||
            controller.signal.aborted ||
            this.state.active?.phase !== 'downloading'
          )
            return;
          if (bytes > lastBytes) {
            lastBytes = bytes;
            watchConnection();
          }
          progress('downloading', bytes);
        });
        clearTimeout(timeout);
        checkCancelled();
        progress('verifying');
        await this.storage.verify(model, controller.signal, (bytes) =>
          progress('verifying', bytes),
        );
        checkCancelled();
        // Cancellation ends before commit: once saving starts the verified file
        // is retained even if persisting its library entry needs a later retry.
        progress('saving', model.bytes);
        await this.storage.promote(model);
      }
      promoted = true;
      const path = this.storage.path(model);
      this.update({ installed: { ...this.state.installed, [id]: path } });
      await this.storage.remember(path, model.name);
      this.update({
        installed: { ...this.state.installed },
        message: `${model.name} is ready. Choose Use model to select it.`,
      });
    } catch (error) {
      const message = timedOut
        ? 'The download stopped responding. Check your connection and retry.'
        : controller.signal.aborted
          ? 'Download cancelled. You can start it again at any time.'
          : promoted
            ? 'The model is downloaded, but its library entry could not be saved. Choose Use model to retry.'
            : error instanceof Error
              ? error.message
              : 'Could not download the model. Check your connection and retry.';
      this.update(controller.signal.aborted && !timedOut ? { message } : { error: message });
    } finally {
      clearTimeout(timeout);
      try {
        this.storage.discardPartial(model);
      } catch {
        this.update({
          error: 'Could not clear the unfinished download. Restart the app and retry.',
        });
      }
      this.controller = undefined;
      this.locked = false;
      this.update({ active: undefined });
    }
  };

  remove = async (id: string, currentPath?: string): Promise<void> => {
    if (this.locked) return;
    const model = this.catalog.find((item) => item.id === id);
    if (!model) return;
    this.locked = true;
    this.update({ removing: id, error: '', message: '', outcomeId: id });
    try {
      const path = this.storage.path(model);
      if (path === currentPath || path === (await this.storage.selected()))
        throw new Error('Select local rules or another model before removing this model.');
      await this.storage.forget(path);
      this.storage.remove(model);
      const installed = { ...this.state.installed };
      delete installed[id];
      this.update({ installed, message: `${model.name} removed from this phone.` });
    } catch {
      this.update({ error: 'Could not remove the model. Select local rules first, then retry.' });
    } finally {
      this.locked = false;
      this.update({ removing: undefined });
    }
  };
}
