import * as SecureStore from 'expo-secure-store';
export async function loadModelPath(): Promise<string | undefined> {
  return (await SecureStore.getItemAsync('pocketsre.model-path')) ?? undefined;
}
export async function saveModelPath(path: string): Promise<void> {
  await SecureStore.setItemAsync('pocketsre.model-path', path);
}
