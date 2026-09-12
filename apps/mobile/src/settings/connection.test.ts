import { afterEach, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it('uses the hosted HTTPS address and migrates only the explicitly named previous server', async () => {
  vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://pocketsre.example/');
  vi.stubEnv('EXPO_PUBLIC_MIGRATE_BACKEND_FROM', 'http://127.0.0.1:4100');
  const { resolveConnection } = await import('./connection');
  expect(resolveConnection({ url: 'http://127.0.0.1:4100', token: 'private-device-key' })).toEqual({
    url: 'https://pocketsre.example',
    token: 'private-device-key',
  });
  expect(
    resolveConnection({ url: 'https://unrelated.example', token: 'different-key' }).token,
  ).toBe('');
  expect(resolveConnection().token).toBe('');
});
it('retains an existing hosted credential and rejects insecure hosted URLs', async () => {
  vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://pocketsre.example');
  const { resolveConnection } = await import('./connection');
  expect(resolveConnection({ url: 'https://pocketsre.example', token: 'saved' }).token).toBe(
    'saved',
  );
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'http://pocketsre.example');
  const insecure = await import('./connection');
  expect(() => insecure.resolveConnection()).toThrow('HTTPS');
});
it('preserves local development configuration when no hosted address is compiled in', async () => {
  vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', '');
  const { resolveConnection } = await import('./connection');
  const saved = { url: 'http://localhost:4100', token: 'local' };
  expect(resolveConnection(saved)).toEqual(saved);
});
