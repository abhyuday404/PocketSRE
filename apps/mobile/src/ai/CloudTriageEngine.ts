import type { Diagnosis, FixContext, FixProposal, IncidentBundle } from '@pocketsre/contracts';
import {
  buildFixPrompt,
  buildTriagePrompt,
  createDeterministicDiagnosis,
  redactText,
  sanitizeBundle,
  validateDiagnosis,
  validateFix,
  validateFixResponse,
} from '@pocketsre/incident-engine';
import type {
  ChatCompletion,
  ChatMessage,
  ChatResult,
  LocalTriageEngine,
} from './LocalTriageEngine';
import {
  AI_PROVIDERS,
  normalizeCloudModel,
  type CloudCredential,
  type CloudModel,
} from './providers';
const loadCloudCredential = async (model: CloudModel) =>
  (await import('../settings/ai')).loadCloudCredential(model);

type Fetcher = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'body'>>;
const nativeFetch: Fetcher = async (url, init) => (await import('expo/fetch')).fetch(url, init);
type Block = { type?: string; text?: string; thought?: boolean };
type ProviderResponse = {
  error?: unknown;
  status?: string;
  output?: { type?: string; content?: Block[] }[];
  content?: Block[];
  stop_reason?: string;
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  candidates?: { content?: { parts?: Block[] }; finishReason?: string }[];
};
class CloudRequestError extends Error {}
function requestError(status: number): CloudRequestError {
  const reason =
    status === 401 || status === 403
      ? 'Check the API key and model permissions in Settings.'
      : status === 429
        ? 'The provider’s rate or spending limit was reached. Try again later.'
        : status === 400 || status === 404
          ? 'Check the model ID and API endpoint in Settings.'
          : 'The provider is unavailable. Try again later.';
  return new CloudRequestError(`API request failed (${status}). ${reason}`);
}
function extractResponse(value: unknown, protocol: string): ChatResult {
  if (!value || typeof value !== 'object') throw new Error();
  const data = value as ProviderResponse;
  if (data.error) throw new CloudRequestError('The provider could not complete the request.');
  let text = '';
  let limited = false;
  if (protocol === 'responses') {
    if (data.status !== 'completed' && data.status !== 'incomplete') throw new Error();
    text = (data.output ?? [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((block) => block.type === 'output_text')
      .map((block) => block.text ?? '')
      .join('');
    limited = data.status === 'incomplete';
  } else if (protocol === 'messages') {
    text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    limited = data.stop_reason === 'max_tokens';
  } else if (protocol === 'gemini') {
    const candidate = data.candidates?.[0];
    if (!['STOP', 'MAX_TOKENS'].includes(candidate?.finishReason ?? '')) throw new Error();
    text = (candidate?.content?.parts ?? [])
      .filter((block) => !block.thought)
      .map((block) => block.text ?? '')
      .join('');
    limited = candidate?.finishReason === 'MAX_TOKENS';
  } else {
    const choice = data.choices?.[0];
    if (!['stop', 'length'].includes(choice?.finish_reason ?? '')) throw new Error();
    text = choice?.message?.content ?? '';
    limited = choice?.finish_reason === 'length';
  }
  if (typeof text !== 'string' || !text.trim())
    throw new CloudRequestError(
      'The provider returned no usable text. Try another model or a shorter request.',
    );
  return { text, limited };
}

/** Direct device-to-provider requests. No key or prompt passes through the gateway. */
export class CloudTriageEngine implements LocalTriageEngine {
  modeLabel: string;
  private readonly model: CloudModel;
  private readonly requests = new Set<AbortController>();
  private released = false;
  constructor(
    model: CloudModel,
    private readonly credential: (
      model: CloudModel,
    ) => Promise<CloudCredential> = loadCloudCredential,
    private readonly fetcher: Fetcher = nativeFetch,
  ) {
    this.model = normalizeCloudModel(model);
    this.modeLabel = `${AI_PROVIDERS[model.provider].name} · ${model.model} (cloud)`;
  }
  private async complete(
    messages: ChatMessage[],
    maxTokens: number,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    if (this.released || signal?.aborted) throw new CloudRequestError('API request stopped.');
    if (messages.reduce((size, item) => size + item.content.length, 0) > 160_000)
      throw new CloudRequestError(
        'This request is too large. Select fewer files or shorten the conversation.',
      );
    const controller = new AbortController();
    this.requests.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    try {
      const { apiKey } = await this.credential(this.model);
      if (controller.signal.aborted) throw new Error();
      const { provider, model, baseUrl } = this.model;
      const { protocol } = AI_PROVIDERS[provider];
      const clean = messages.map((message) => ({
        ...message,
        content: redactText(message.content),
      }));
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      let path: string;
      let body: object;
      if (protocol === 'messages') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        path = '/messages';
        body = { model, messages: clean, max_tokens: maxTokens };
      } else if (protocol === 'gemini') {
        headers['x-goog-api-key'] = apiKey;
        path = `/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
        body = {
          contents: clean.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: { maxOutputTokens: maxTokens },
        };
      } else {
        headers.authorization = `Bearer ${apiKey}`;
        path = protocol === 'responses' ? '/responses' : '/chat/completions';
        body =
          protocol === 'responses'
            ? { model, input: clean, max_output_tokens: maxTokens, store: false }
            : { model, messages: clean, max_tokens: maxTokens, stream: false };
      }
      const response = await this.fetcher(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw requestError(response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted) throw new Error();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2_000_000)
            throw new CloudRequestError('The provider response was too large.');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
      return extractResponse(JSON.parse(text), protocol);
    } catch (error) {
      if (timedOut)
        throw new CloudRequestError(
          'The API request timed out. Try again or choose another model.',
        );
      if (controller.signal.aborted || this.released)
        throw new CloudRequestError('API request stopped.');
      if (error instanceof CloudRequestError) throw error;
      // Never display raw provider bodies or native errors, which can contain credentials/prompts.
      throw new CloudRequestError(
        'Could not complete the API request. Check connectivity and AI settings.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.requests.delete(controller);
    }
  }
  private async json(prompt: string): Promise<unknown> {
    const result = await this.complete([{ role: 'user', content: prompt }], 8192);
    if (result.limited)
      throw new CloudRequestError('The model reached its output limit. Shorten the request.');
    try {
      const start = result.text.indexOf('{');
      const end = result.text.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error();
      return JSON.parse(result.text.slice(start, end + 1));
    } catch {
      throw new CloudRequestError(
        'The model returned an invalid structured answer. Try another model.',
      );
    }
  }
  async analyze(raw: IncidentBundle): Promise<Diagnosis> {
    const bundle = sanitizeBundle(raw);
    try {
      const candidate = await this.json(buildTriagePrompt(bundle, 'cloud-llm'));
      const value =
        candidate && typeof candidate === 'object'
          ? { ...candidate, mode: 'cloud-llm' }
          : candidate;
      const validated = validateDiagnosis(value, bundle);
      if (!validated.success)
        throw new CloudRequestError('The model’s conclusions could not be validated.');
      this.modeLabel = `${AI_PROVIDERS[this.model.provider].name} · ${this.model.model} (cloud)`;
      return validated.diagnosis;
    } catch (error) {
      if (this.released) throw new CloudRequestError('API request stopped.');
      this.modeLabel = `${error instanceof CloudRequestError ? error.message : 'Cloud analysis unavailable.'} Local rule-based fallback`;
      return createDeterministicDiagnosis(bundle);
    }
  }
  async proposeFix(context: FixContext): Promise<FixProposal> {
    const proposal = validateFixResponse(context, await this.json(buildFixPrompt(context)));
    if (context.task && !proposal.edits.length) return proposal;
    return validateFix(context, proposal).proposal;
  }
  chat: ChatCompletion = async (messages, onToken, signal) => {
    const result = await this.complete(messages, 8192, signal);
    if (signal.aborted) throw new CloudRequestError('API request stopped.');
    onToken(result.text);
    return result;
  };
  async testConnection(): Promise<void> {
    await this.complete([{ role: 'user', content: 'Reply with OK.' }], 128);
  }
  async release(): Promise<void> {
    this.released = true;
    for (const request of this.requests) request.abort();
  }
}
