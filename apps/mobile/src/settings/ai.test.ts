import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async (key: string) => storage.values.get(key) ?? null,
  setItemAsync: storage.write,
}));
import { loadAISettings, loadCloudCredential, removeCloudKey, saveCloudAI, useLocalAI } from './ai';
import { normalizeCloudModel } from '../ai/providers';
const openai = normalizeCloudModel({ provider: 'openai', model: 'test-model', baseUrl: '' });
const anthropic = normalizeCloudModel({ provider: 'anthropic', model: 'test-claude', baseUrl: '' });
beforeEach(() => {
  storage.values.clear();
  storage.write
    .mockReset()
    .mockImplementation(async (key, value) => storage.values.set(key, value));
});
it('defaults to local and keeps provider keys out of public settings and local model storage', async () => {
  storage.values.set('pocketsre.model-path', 'file:///existing.gguf');
  expect((await loadAISettings()).source).toBe('local');
  const saved = await saveCloudAI(openai, 'test-only-openai-key');
  expect(saved.profiles.openai?.hasKey).toBe(true);
  expect(JSON.stringify(saved)).not.toContain('test-only-openai-key');
  expect(JSON.stringify(await loadAISettings())).not.toContain('apiKey');
  expect(storage.write).toHaveBeenLastCalledWith('pocketsre.ai-settings', expect.any(String), {
    keychainAccessible: 'device-only',
  });
  expect(storage.values.get('pocketsre.model-path')).toBe('file:///existing.gguf');
});
it('retains separate profiles across provider and local switches, and revokes removed keys', async () => {
  await saveCloudAI(openai, 'test-only-openai-key');
  await saveCloudAI(anthropic, 'test-only-anthropic-key');
  expect((await loadCloudCredential(anthropic)).apiKey).toBe('test-only-anthropic-key');
  await expect(loadCloudCredential(openai)).rejects.toThrow('changed');
  await saveCloudAI(openai, '');
  expect((await loadCloudCredential(openai)).apiKey).toBe('test-only-openai-key');
  await useLocalAI();
  await expect(loadCloudCredential(openai)).rejects.toThrow('changed');
  await saveCloudAI(openai, '');
  const removed = await removeCloudKey('openai');
  expect(removed.source).toBe('local');
  expect(removed.profiles.anthropic?.hasKey).toBe(true);
  expect(removed.profiles.openai?.hasKey).toBe(false);
  expect(storage.values.get('pocketsre.ai-settings')).not.toContain('test-only-openai-key');
});
it('never reuses a key for another custom endpoint or provider', async () => {
  const first = normalizeCloudModel({
    provider: 'compatible',
    baseUrl: 'https://one.example/v1/',
    model: 'test',
  });
  await saveCloudAI(first, 'test-only-custom-key');
  const second = { ...first, baseUrl: 'https://two.example/v1' };
  await expect(saveCloudAI(second, '')).rejects.toThrow('API key');
  await expect(saveCloudAI(anthropic, '')).rejects.toThrow('API key');
  await expect(loadCloudCredential(second)).rejects.toThrow('changed');
  expect((await loadCloudCredential(first)).apiKey).toBe('test-only-custom-key');
});
it.each([
  'http://provider.example/v1',
  'https://key@provider.example',
  'https://provider.example?key=bad',
  'https://provider.example#key',
])('rejects unsafe endpoints: %s', (baseUrl) => {
  expect(() => normalizeCloudModel({ provider: 'compatible', baseUrl, model: 'test' })).toThrow(
    'HTTPS',
  );
});
it('serializes profile updates and does not activate cloud mode after a failed write', async () => {
  await Promise.all([saveCloudAI(openai, 'test-a'), saveCloudAI(anthropic, 'test-b')]);
  expect(Object.keys((await loadAISettings()).profiles)).toHaveLength(2);
  await useLocalAI();
  storage.write.mockRejectedValueOnce(new Error('native error with test-a'));
  await expect(saveCloudAI(openai, '')).rejects.toThrow('Could not save AI settings securely');
  expect((await loadAISettings()).source).toBe('local');
});
it('recovers corrupt settings into local mode without making a cloud selection', async () => {
  storage.values.set('pocketsre.ai-settings', '{broken');
  expect((await loadAISettings()).source).toBe('local');
  await saveCloudAI(openai, 'test-a');
  expect((await loadAISettings()).source).toBe('cloud');
});
