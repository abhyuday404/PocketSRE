import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  permission: vi.fn(),
  token: vi.fn(),
  channel: vi.fn(),
  subscribe: vi.fn(),
  listener: vi.fn(),
  remove: vi.fn(),
  last: vi.fn(),
  clear: vi.fn(),
  handler: vi.fn(),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mocks.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mocks.values.set(key, value);
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '90f85cd5-818c-4286-9714-9a890636765c' }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./api/gateway', () => ({
  getGatewayUrl: () => 'https://gateway.test',
  subscribeProjectNotifications: mocks.subscribe,
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: mocks.channel,
  requestPermissionsAsync: mocks.permission,
  getExpoPushTokenAsync: mocks.token,
  addNotificationResponseReceivedListener: mocks.listener,
  getLastNotificationResponseAsync: mocks.last,
  clearLastNotificationResponse: mocks.clear,
  setNotificationHandler: mocks.handler,
}));
import { enableProjectNotifications, listenForProjectNotifications } from './notifications';
const projectId = '984a8c1f-82cd-4d35-82d0-98c9a08fd7d5';
const response = (gatewayId: string) => ({
  notification: { request: { content: { data: { projectId, gatewayId } } } },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.values.clear();
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = 'eas-fixture';
  mocks.permission.mockResolvedValue({ status: 'granted' });
  mocks.token.mockResolvedValue({ data: 'ExpoPushToken[fixture]' });
  mocks.subscribe.mockResolvedValue({ gatewayId: 'gateway-fixture', enabled: true });
  mocks.listener.mockReturnValue({ remove: mocks.remove });
  mocks.last.mockResolvedValue(null);
});
it('registers only after OS permission and binds taps to the gateway that accepted this device', async () => {
  await enableProjectNotifications(projectId);
  expect(mocks.channel.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.token.mock.invocationCallOrder[0]!,
  );
  expect(mocks.subscribe).toHaveBeenCalledWith(
    projectId,
    '90f85cd5-818c-4286-9714-9a890636765c',
    'ExpoPushToken[fixture]',
  );
  mocks.last.mockResolvedValue(response('gateway-fixture'));
  const open = vi.fn();
  const stop = await listenForProjectNotifications(open);
  expect(open).toHaveBeenCalledWith(projectId);
  expect(mocks.clear).toHaveBeenCalledOnce();
  stop();
  expect(mocks.remove).toHaveBeenCalledOnce();
});
it('does not subscribe when permission or native push configuration is absent', async () => {
  mocks.permission.mockResolvedValue({ status: 'denied' });
  await expect(enableProjectNotifications(projectId)).rejects.toThrow(/disabled/);
  expect(mocks.subscribe).not.toHaveBeenCalled();
  delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  await expect(enableProjectNotifications(projectId)).rejects.toThrow(/EAS/);
  expect(mocks.token).not.toHaveBeenCalled();
});
it('ignores another gateway and cleans up the tap listener if cold-start lookup fails', async () => {
  await enableProjectNotifications(projectId);
  const open = vi.fn();
  mocks.last.mockResolvedValue(response('different-gateway'));
  (await listenForProjectNotifications(open))();
  expect(open).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
  mocks.last.mockRejectedValueOnce(new Error('Native unavailable'));
  await expect(listenForProjectNotifications(open)).rejects.toThrow(/Native/);
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});
