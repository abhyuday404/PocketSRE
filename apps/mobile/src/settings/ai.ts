import * as SecureStore from 'expo-secure-store';
import {
  isProviderId,
  normalizeCloudModel,
  type CloudCredential,
  type CloudModel,
  type ProviderId,
} from '../ai/providers';

const KEY = 'pocketsre.ai-settings';
type StoredSettings = {
  source: 'local' | 'cloud';
  provider: ProviderId;
  profiles: Partial<Record<ProviderId, CloudCredential>>;
};
export type AISettings = {
  source: 'local' | 'cloud';
  provider: ProviderId;
  profiles: Partial<Record<ProviderId, CloudModel & { hasKey: boolean }>>;
};
export const DEFAULT_AI_SETTINGS: AISettings = {
  source: 'local',
  provider: 'openai',
  profiles: {},
};

async function read(): Promise<StoredSettings> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY);
  } catch {
    throw new Error('Secure storage is unavailable. Unlock the phone and try again.');
  }
  if (!raw) return { ...DEFAULT_AI_SETTINGS, profiles: {} };
  try {
    const parsed = JSON.parse(raw) as { provider?: unknown; source?: unknown; profiles?: object };
    const provider = parsed.provider;
    const source = parsed.source;
    if (!isProviderId(provider) || (source !== 'local' && source !== 'cloud')) throw new Error();
    const profiles: StoredSettings['profiles'] = {};
    for (const [id, value] of Object.entries(parsed.profiles ?? {})) {
      if (!isProviderId(id) || !value || typeof value !== 'object') continue;
      const profile = value as CloudCredential;
      if (typeof profile.apiKey !== 'string') continue;
      profiles[id] = {
        ...normalizeCloudModel({ ...profile, provider: id }),
        apiKey: profile.apiKey,
      };
    }
    return {
      provider,
      source: profiles[provider]?.apiKey ? source : 'local',
      profiles,
    };
  } catch {
    // Corrupt metadata must never opt the user into a cloud request.
    return { ...DEFAULT_AI_SETTINGS, profiles: {} };
  }
}
function publicSettings(value: StoredSettings): AISettings {
  return {
    source: value.source,
    provider: value.provider,
    profiles: Object.fromEntries(
      Object.entries(value.profiles).map(([id, profile]) => {
        const { apiKey, ...model } = profile!;
        return [id, { ...model, hasKey: !!apiKey }];
      }),
    ),
  };
}
export async function loadAISettings(): Promise<AISettings> {
  return publicSettings(await read());
}
let writes: Promise<unknown> = Promise.resolve();
function update(change: (settings: StoredSettings) => void): Promise<AISettings> {
  const result = writes.then(async () => {
    const value = await read();
    change(value);
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(value), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      throw new Error('Could not save AI settings securely. Try again.');
    }
    return publicSettings(value);
  });
  writes = result.catch(() => {});
  return result;
}
export function useLocalAI(): Promise<AISettings> {
  return update((settings) => {
    settings.source = 'local';
  });
}
export function saveCloudAI(input: CloudModel, enteredKey: string): Promise<AISettings> {
  const model = normalizeCloudModel(input);
  return update((settings) => {
    const previous = settings.profiles[model.provider];
    const apiKey =
      enteredKey.trim() || (previous?.baseUrl === model.baseUrl ? previous.apiKey : '');
    if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey))
      throw new Error('Enter an API key for this provider and endpoint.');
    settings.profiles[model.provider] = { ...model, apiKey };
    settings.provider = model.provider;
    settings.source = 'cloud';
  });
}
export function removeCloudKey(provider: ProviderId): Promise<AISettings> {
  return update((settings) => {
    const profile = settings.profiles[provider];
    if (profile) profile.apiKey = '';
    if (settings.provider === provider) settings.source = 'local';
  });
}
/** Credentials are read only for an explicit request, never returned to UI state. */
export async function loadCloudCredential(model: CloudModel): Promise<CloudCredential> {
  const normalized = normalizeCloudModel(model);
  const settings = await read();
  const profile = settings.profiles[normalized.provider];
  if (
    settings.source !== 'cloud' ||
    settings.provider !== normalized.provider ||
    !profile?.apiKey ||
    profile.baseUrl !== normalized.baseUrl ||
    profile.model !== normalized.model
  )
    throw new Error('AI settings changed. Select and save the API model again.');
  return profile;
}
