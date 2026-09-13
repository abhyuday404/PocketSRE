import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getGatewayUrl, subscribeProjectNotifications } from './api/gateway';

async function deviceId() {
  let id = await SecureStore.getItemAsync('pocketsre.push-device');
  if (!id) {
    id = randomUUID();
    await SecureStore.setItemAsync('pocketsre.push-device', id);
  }
  return id;
}
export async function enableProjectNotifications(projectId: string) {
  const easProjectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId;
  if (!easProjectId)
    throw new Error(
      'Push notifications need an EAS project ID and Android push credentials in a new app build.',
    );
  const notifications = await import('expo-notifications');
  if (Platform.OS === 'android')
    await notifications.setNotificationChannelAsync('project-health', {
      name: 'Project health',
      importance: notifications.AndroidImportance.HIGH,
    });
  const permission = await notifications.requestPermissionsAsync();
  if (permission.status !== 'granted')
    throw new Error(
      'Notifications are disabled. Enable them in your phone settings to receive alerts.',
    );
  const token = (await notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data;
  const url = getGatewayUrl();
  const result = await subscribeProjectNotifications(projectId, await deviceId(), token);
  await SecureStore.setItemAsync(
    'pocketsre.push-gateway',
    JSON.stringify({ url, gatewayId: result.gatewayId }),
  );
}
export async function disableProjectNotifications(projectId: string) {
  await subscribeProjectNotifications(projectId, await deviceId(), null);
}
export async function listenForProjectNotifications(open: (projectId: string) => void) {
  const notifications = await import('expo-notifications');
  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  const handle = async (
    response: Awaited<ReturnType<typeof notifications.getLastNotificationResponseAsync>>,
  ) => {
    const data = response?.notification.request.content.data;
    if (!data || typeof data.projectId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.projectId))
      return;
    const saved = await SecureStore.getItemAsync('pocketsre.push-gateway');
    if (!saved) return;
    const binding = JSON.parse(saved);
    if (binding.url === getGatewayUrl() && binding.gatewayId === data.gatewayId) {
      open(data.projectId);
      notifications.clearLastNotificationResponse();
    }
  };
  const subscription = notifications.addNotificationResponseReceivedListener((value) => {
    void handle(value).catch(() => {});
  });
  try {
    await handle(await notifications.getLastNotificationResponseAsync());
  } catch (error) {
    subscription.remove();
    throw error;
  }
  return () => subscription.remove();
}
