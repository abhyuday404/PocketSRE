import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'pocketsre.connector.';

export async function saveConnectorSecret(connector: string, secret: string): Promise<void> {
  await SecureStore.setItemAsync(`${KEY_PREFIX}${connector}`, secret, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadConnectorSecret(connector: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${KEY_PREFIX}${connector}`);
}

export async function removeConnectorSecret(connector: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${KEY_PREFIX}${connector}`);
}
