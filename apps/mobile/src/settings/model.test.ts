import { beforeEach, expect, it, vi } from 'vitest';
const values = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
}));
import {
  forgetModel,
  getModelLibraryRevision,
  subscribeModelLibrary,
  loadModels,
  rememberModel,
  saveModelPath,
} from './model';
beforeEach(() => values.clear());
it('preserves the previously imported model when upgrading or recovering a corrupt library', async () => {
  await saveModelPath('file:///models/existing.gguf');
  values.set('pocketsre.model-library', '{broken');
  expect(await loadModels()).toEqual([
    { path: 'file:///models/existing.gguf', name: 'existing.gguf' },
  ]);
  await rememberModel('file:///models/new.gguf', 'New model');
  expect(await loadModels()).toHaveLength(2);
  expect(values.get('pocketsre.model-path')).toBe('file:///models/existing.gguf');
});
it('deduplicates reimports and bounds the saved library without storing model data', async () => {
  for (let i = 0; i < 10; i++) await rememberModel(`file:///models/${i}.gguf`, `Model ${i}`);
  await rememberModel('file:///models/9.gguf', 'Renamed');
  const library = await loadModels();
  expect(library).toHaveLength(8);
  expect(library.at(-1)).toEqual({ path: 'file:///models/9.gguf', name: 'Renamed' });
});

it('notifies every mounted picker when models are added or removed', async () => {
  const listener = vi.fn();
  const unsubscribe = subscribeModelLibrary(listener);
  const before = getModelLibraryRevision();
  await rememberModel('file:///models/download.gguf', 'Downloaded');
  await forgetModel('file:///models/download.gguf');
  expect(getModelLibraryRevision()).toBe(before + 2);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(await loadModels()).toEqual([]);
  unsubscribe();
});

it('does not lose a download when an import finishes at the same time', async () => {
  await Promise.all([
    rememberModel('file:///models/download.gguf', 'Downloaded'),
    rememberModel('file:///models/import.gguf', 'Imported'),
  ]);
  expect((await loadModels()).map((model) => model.name)).toEqual(['Downloaded', 'Imported']);
});
