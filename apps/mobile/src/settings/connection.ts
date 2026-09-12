import * as SecureStore from 'expo-secure-store';

export type ConnectionSettings = { url: string; token: string };
const KEY = 'pocketsre.gateway';
// Only the public address belongs in the app bundle. Credentials stay in SecureStore.
export const hostedBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
export function resolveConnection(stored?: ConnectionSettings): ConnectionSettings {
  if (hostedBackendUrl) {
    const url = normalizeGatewayUrl(hostedBackendUrl);
    if (!url.startsWith('https://')) throw new Error('The hosted service requires HTTPS.');
    const previousUrl = process.env.EXPO_PUBLIC_MIGRATE_BACKEND_FROM;
    const reuse =
      stored &&
      (stored.url === url || (previousUrl && stored.url === normalizeGatewayUrl(previousUrl)));
    return { url, token: reuse ? stored.token : '' };
  }
  return (
    stored ?? { url: process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:4100', token: '' }
  );
}
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
        return resolveConnection({ url: normalizeGatewayUrl(parsed.url), token: parsed.token });
    } catch {
      /* Fall back to development configuration. */
    }
  }
  return resolveConnection();
}
export async function saveConnection(settings: ConnectionSettings): Promise<ConnectionSettings> {
  const normalized = { url: normalizeGatewayUrl(settings.url), token: settings.token.trim() };
  await SecureStore.setItemAsync(KEY, JSON.stringify(normalized), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return normalized;
}
