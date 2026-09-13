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
it('uses a public default address without bundling a credential', async () => {
  vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', 'https://pc.example/');
  const { resolveConnection } = await import('./connection');
  expect(resolveConnection()).toEqual({ url: 'https://pc.example', token: '' });
});
it('honors a changed tunnel address and its saved key after relaunch', async () => {
  vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', 'https://old-tunnel.example');
  const { resolveConnection } = await import('./connection');
  const saved = { url: 'https://new-tunnel.example', token: 'device-only-test-key' };
  expect(resolveConnection(saved)).toEqual(saved);
});
it('rejects URLs containing credentials or query strings', async () => {
  const { normalizeGatewayUrl } = await import('./connection');
  expect(() => normalizeGatewayUrl('https://user:secret@example.com')).toThrow();
  expect(() => normalizeGatewayUrl('https://example.com?key=secret')).toThrow();
});

it('migrates the explicitly configured USB address to the same PC tunnel', async () => {
  vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', 'https://pc.example');
  vi.stubEnv('EXPO_PUBLIC_MIGRATE_BACKEND_FROM', 'http://127.0.0.1:4100');
  const { resolveConnection } = await import('./connection');
  expect(resolveConnection({ url: 'http://127.0.0.1:4100', token: 'saved-device-key' })).toEqual({
    url: 'https://pc.example',
    token: 'saved-device-key',
  });
  const unrelated = { url: 'https://other.example', token: 'other' };
  expect(resolveConnection(unrelated)).toEqual(unrelated);
});
