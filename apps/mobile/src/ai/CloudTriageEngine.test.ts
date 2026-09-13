import { afterEach, expect, it, vi } from 'vitest';
import type { FixContext } from '@pocketsre/contracts';
import { createDeterministicDiagnosis, validateDiagnosis } from '@pocketsre/incident-engine';
import { CloudTriageEngine } from './CloudTriageEngine';
import { normalizeCloudModel, type ProviderId } from './providers';
import { createSampleIncident } from '../data/sampleIncident';

function envelope(provider: ProviderId, text: string, limited = false) {
  if (provider === 'openai')
    return {
      status: limited ? 'incomplete' : 'completed',
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text }] },
      ],
    };
  if (provider === 'anthropic')
    return { content: [{ type: 'text', text }], stop_reason: limited ? 'max_tokens' : 'end_turn' };
  if (provider === 'gemini')
    return {
      candidates: [
        {
          content: { parts: [{ thought: true, text: 'hidden reasoning' }, { text }] },
          finishReason: limited ? 'MAX_TOKENS' : 'STOP',
        },
      ],
    };
  return { choices: [{ message: { content: text }, finish_reason: limited ? 'length' : 'stop' }] };
}
function setup(provider: ProviderId = 'openai', text = 'Hello') {
  const model = normalizeCloudModel({
    provider,
    model: 'test-model',
    baseUrl: 'https://custom.example/v1',
  });
  const credential = vi.fn(async () => ({ ...model, apiKey: 'test-only-provider-key' }));
  const fetcher = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(envelope(provider, text))),
  );
  const engine = new CloudTriageEngine(model, credential, fetcher);
  return { engine, credential, fetcher };
}
afterEach(() => vi.useRealTimers());
it.each([
  ['openai', 'https://api.openai.com/v1/responses', 'authorization'],
  ['anthropic', 'https://api.anthropic.com/v1/messages', 'x-api-key'],
  [
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
    'x-goog-api-key',
  ],
  ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'authorization'],
  ['compatible', 'https://custom.example/v1/chat/completions', 'authorization'],
] as const)(
  'supports %s authentication and response format without putting the key in prompts or URLs',
  async (provider, url, header) => {
    const { engine, fetcher } = setup(provider);
    const token = vi.fn();
    const result = await engine.chat(
      [
        { role: 'user', content: 'password=private-value Hello' },
        { role: 'assistant', content: 'Previous response' },
        { role: 'user', content: 'Continue' },
      ],
      token,
      new AbortController().signal,
    );
    expect(result).toEqual({ text: 'Hello', limited: false });
    expect(token).toHaveBeenCalledWith('Hello');
    const [target, request] = fetcher.mock.calls[0]!;
    expect(target).toBe(url);
    expect(request.redirect).toBe('error');
    expect(request.credentials).toBe('omit');
    expect(request.headers).toHaveProperty(
      header,
      expect.stringContaining('test-only-provider-key'),
    );
    expect(request.body).not.toContain('test-only-provider-key');
    expect(request.body).not.toContain('private-value');
    const body = JSON.parse(request.body as string);
    if (provider === 'openai')
      expect(body).toMatchObject({ store: false, max_output_tokens: 8192 });
    if (provider === 'anthropic')
      expect(request.headers).toHaveProperty('anthropic-version', '2023-06-01');
    if (provider === 'gemini') expect(body.contents[1].role).toBe('model');
  },
);
it('persists honest cloud provenance and retains shared diagnosis validation', async () => {
  const bundle = createSampleIncident();
  const answer = createDeterministicDiagnosis(bundle);
  const { engine, fetcher } = setup('openai', JSON.stringify(answer));
  const result = await engine.analyze(bundle);
  expect(result.mode).toBe('cloud-llm');
  expect(validateDiagnosis(result, bundle).success).toBe(true);
  expect(engine.modeLabel).toContain('(cloud)');
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify(envelope('openai', JSON.stringify({ ...answer, evidenceIds: ['invented'] }))),
    ),
  );
  expect((await engine.analyze(bundle)).mode).toBe('deterministic');
  expect(engine.modeLabel).toContain('fallback');
});
it('validates exact patches and never substitutes a fabricated fallback fix', async () => {
  const bundle = createSampleIncident();
  const context = {
    bundle,
    files: [{ path: 'app.ts', content: 'const port = 3001;', mode: '100644' }],
  } as FixContext;
  const proposal = {
    summary: 'Port hypothesis',
    evidenceIds: [bundle.evidence[0]!.id],
    edits: [
      {
        path: 'app.ts',
        before: '3001',
        after: '3000',
        reason: 'Expected port',
        evidenceIds: [bundle.evidence[0]!.id],
      },
    ],
  };
  const { engine, fetcher } = setup('anthropic', JSON.stringify(proposal));
  expect(await engine.proposeFix(context)).toEqual(proposal);
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify(
        envelope(
          'anthropic',
          JSON.stringify({ ...proposal, edits: [{ ...proposal.edits[0], path: 'secret.ts' }] }),
        ),
      ),
    ),
  );
  await expect(engine.proposeFix(context)).rejects.toThrow('outside');
});
it.each([401, 403, 429, 500])(
  'handles HTTP %s without exposing the provider response or retrying',
  async (status) => {
    const { engine, fetcher } = setup();
    fetcher.mockResolvedValue(new Response('test-only-provider-key private prompt', { status }));
    const result = engine.chat(
      [{ role: 'user', content: 'Hello' }],
      vi.fn(),
      new AbortController().signal,
    );
    await expect(result).rejects.toThrow(`API request failed (${status})`);
    await expect(result).rejects.not.toThrow('test-only-provider-key');
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it('stops active requests, prevents requests after release, and handles a timeout', async () => {
  vi.useFakeTimers();
  const { engine, fetcher } = setup();
  fetcher.mockImplementation(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  );
  const first = engine.chat(
    [{ role: 'user', content: 'Hello' }],
    vi.fn(),
    new AbortController().signal,
  );
  const timedOut = expect(first).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(120_000);
  await timedOut;
  const signal = new AbortController();
  const token = vi.fn();
  const second = engine.chat([{ role: 'user', content: 'Hello' }], token, signal.signal);
  const stopped = expect(second).rejects.toThrow('stopped');
  await vi.advanceTimersByTimeAsync(0);
  signal.abort();
  await stopped;
  expect(token).not.toHaveBeenCalled();
  await engine.release();
  await expect(engine.chat([], token, new AbortController().signal)).rejects.toThrow('stopped');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects oversized replies and invalid JSON, and reports truncated chats', async () => {
  const { engine, fetcher } = setup();
  fetcher.mockResolvedValueOnce(new Response('x'.repeat(2_000_001)));
  await expect(engine.chat([], vi.fn(), new AbortController().signal)).rejects.toThrow('too large');
  fetcher.mockResolvedValueOnce(new Response('not-json'));
  await expect(engine.chat([], vi.fn(), new AbortController().signal)).rejects.toThrow(
    'Could not complete',
  );
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(envelope('openai', 'partial', true))));
  expect(await engine.chat([], vi.fn(), new AbortController().signal)).toEqual({
    text: 'partial',
    limited: true,
  });
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(envelope('openai', '{}', true))));
  expect((await engine.analyze(createSampleIncident())).mode).toBe('deterministic');
});
it('does not fetch if credentials have been removed or local mode has been selected', async () => {
  const { engine, credential, fetcher } = setup();
  credential.mockRejectedValue(new Error('Settings changed'));
  await expect(engine.chat([], vi.fn(), new AbortController().signal)).rejects.toThrow(
    'AI settings',
  );
  expect(fetcher).not.toHaveBeenCalled();
});
