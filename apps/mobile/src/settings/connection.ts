import * as SecureStore from 'expo-secure-store';

export type ConnectionSettings = { url: string; token: string };
const KEY = 'pocketsre.gateway';
export function normalizeGatewayUrl(input: string): string {
  const parsed = new URL(input.trim());
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Enter an HTTP(S) gateway URL without credentials or query parameters.');
  }
  return parsed.toString().replace(/\/$/, '');
}
export async function loadConnection(): Promise<ConnectionSettings> {
  const stored = await SecureStore.getItemAsync(KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ConnectionSettings;
      if (typeof parsed.token === 'string')
        return { url: normalizeGatewayUrl(parsed.url), token: parsed.token };
    } catch {
      /* Fall back to development configuration. */
    }
  }
  return { url: process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:4100', token: '' };
}
export async function saveConnection(settings: ConnectionSettings): Promise<ConnectionSettings> {
  const normalized = { url: normalizeGatewayUrl(settings.url), token: settings.token.trim() };
  await SecureStore.setItemAsync(KEY, JSON.stringify(normalized), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return normalized;
}
