export const AI_PROVIDERS = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'responses' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', protocol: 'messages' },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'gemini',
  },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'chat' },
  compatible: { name: 'OpenAI-compatible', baseUrl: '', protocol: 'chat' },
} as const;

export type ProviderId = keyof typeof AI_PROVIDERS;
export const providerIds = Object.keys(AI_PROVIDERS) as ProviderId[];
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.hasOwn(AI_PROVIDERS, value);
}
export type CloudModel = { provider: ProviderId; model: string; baseUrl: string };
export type CloudCredential = CloudModel & { apiKey: string };

export function normalizeCloudModel(input: CloudModel): CloudModel {
  if (!isProviderId(input.provider)) throw new Error('Choose a supported API provider.');
  const model = input.model.trim();
  if (!model || model.length > 200 || /[\s?#]/.test(model))
    throw new Error('Enter the model ID from your provider, without spaces.');
  let url: URL;
  try {
    url = new URL(
      input.provider === 'compatible' ? input.baseUrl.trim() : AI_PROVIDERS[input.provider].baseUrl,
    );
  } catch {
    throw new Error('Enter the provider’s HTTPS API base URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTPS API base URL without credentials, queries, or fragments.');
  return { provider: input.provider, model, baseUrl: url.toString().replace(/\/+$/, '') };
}
