import * as SecureStore from 'expo-secure-store';

export type ConnectionSettings = { url: string; token: string };
const KEY = 'pocketsre.gateway';
// A saved address always wins, so a restarted tunnel can be changed in Settings.
export function resolveConnection(stored?: ConnectionSettings): ConnectionSettings {
  const url = normalizeGatewayUrl(process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:4100');
  // Explicit opt-in for this PC's USB-to-tunnel migration. Other saved addresses win.
  const previousUrl = process.env.EXPO_PUBLIC_MIGRATE_BACKEND_FROM;
  if (stored && previousUrl && stored.url === normalizeGatewayUrl(previousUrl)) {
    if (!url.startsWith('https://')) throw new Error('Wireless migration requires HTTPS.');
    return { url, token: stored.token };
  }
  return stored ?? { url, token: '' };
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
    throw new Error('Enter an HTTP(S) server URL without credentials or query parameters.');
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
