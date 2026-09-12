import * as SecureStore from 'expo-secure-store';
let libraryRevision = 0;
const libraryListeners = new Set<() => void>();
let pendingLibraryWrite: Promise<void> = Promise.resolve();
function writeLibrary(update: () => Promise<void>): Promise<void> {
  const result = pendingLibraryWrite.then(update);
  pendingLibraryWrite = result.catch(() => {});
  return result;
}
export const getModelLibraryRevision = () => libraryRevision;
export const subscribeModelLibrary = (listener: () => void) => {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
};
function libraryChanged() {
  libraryRevision++;
  libraryListeners.forEach((listener) => listener());
}
export async function loadModelPath(): Promise<string | undefined> {
  return (await SecureStore.getItemAsync('pocketsre.model-path')) ?? undefined;
}
export async function saveModelPath(path: string): Promise<void> {
  await SecureStore.setItemAsync('pocketsre.model-path', path);
}
export type SavedModel = { path: string; name: string };
export async function loadModels(): Promise<SavedModel[]> {
  const raw = await SecureStore.getItemAsync('pocketsre.model-library');
  let models: SavedModel[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value))
        models = value
          .filter(
            (item): item is SavedModel =>
              !!item && typeof item.path === 'string' && typeof item.name === 'string',
          )
          .slice(-8);
    } catch {
      /* A selected legacy model remains usable. */
    }
  }
  const path = await loadModelPath();
  if (path && !models.some((model) => model.path === path))
    models.push({ path, name: path.split('/').pop() ?? 'Imported model' });
  return models;
}
export async function rememberModel(path: string, name: string) {
  await writeLibrary(async () => {
    const models = (await loadModels()).filter((model) => model.path !== path);
    await SecureStore.setItemAsync(
      'pocketsre.model-library',
      JSON.stringify([...models, { path, name: name.slice(0, 100) }].slice(-8)),
    );
    libraryChanged();
  });
}

export async function forgetModel(path: string): Promise<void> {
  await writeLibrary(async () => {
    const models = (await loadModels()).filter((model) => model.path !== path);
    await SecureStore.setItemAsync('pocketsre.model-library', JSON.stringify(models));
    libraryChanged();
  });
}
