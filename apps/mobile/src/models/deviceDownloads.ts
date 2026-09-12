import { Directory, File, Paths } from 'expo-file-system';
import { forgetModel, loadModelPath, rememberModel } from '../settings/model';
import { modelDownloadUrl, type DownloadableModel } from './catalog';
import { ModelDownloads, type ModelDownloadStorage } from './downloads';
import { isGgufHeader, verifyModelBytes } from './verify';

const directory = () => new Directory(Paths.document, 'pocketsre-models');
const file = (model: DownloadableModel, partial = false) =>
  new File(directory(), `${model.id}-${model.sha256.slice(0, 12)}.${partial ? 'part' : 'gguf'}`);

export const deviceModelStorage: ModelDownloadStorage = {
  prepare() {
    directory().create({ intermediates: true, idempotent: true });
  },
  path: (model) => file(model).uri,
  installed(model) {
    const saved = file(model);
    if (!saved.exists || saved.size !== model.bytes) return false;
    const handle = saved.open();
    try {
      return isGgufHeader(handle.readBytes(8));
    } finally {
      handle.close();
    }
  },
  discardPartial(model) {
    const partial = file(model, true);
    if (partial.exists) partial.delete();
  },
  freeBytes: () => Paths.availableDiskSpace,
  async download(model, signal, progress) {
    try {
      // The direct API closes streams and settles cancellation before returning.
      // SDK 57's resumable-task Android loop has a cancellation branch that can
      // return without settling its promise. We do not need pause/resume here.
      await File.downloadFileAsync(modelDownloadUrl(model), file(model, true), {
        signal,
        onProgress: ({ bytesWritten }) => progress(bytesWritten),
      });
    } catch {
      // Native errors can contain signed CDN redirects. Keep those out of UI/logs.
      throw new Error(
        'Could not download the model. Check your connection and free storage, then retry.',
      );
    }
  },
  async verify(model, signal, progress) {
    const partial = file(model, true);
    if (!partial.exists || partial.size !== model.bytes)
      throw new Error('The model download is incomplete. Please retry.');
    const handle = partial.open();
    try {
      await verifyModelBytes(handle, model, signal, progress);
    } finally {
      handle.close();
    }
  },
  async promote(model) {
    const saved = file(model);
    if (saved.exists) saved.delete();
    await file(model, true).move(saved);
  },
  remove(model) {
    const saved = file(model);
    if (saved.exists) saved.delete();
  },
  remember: rememberModel,
  forget: forgetModel,
  selected: loadModelPath,
};

export const modelDownloads = new ModelDownloads(deviceModelStorage);
