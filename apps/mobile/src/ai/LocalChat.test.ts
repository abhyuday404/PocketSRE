import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  init: vi.fn(),
  getFormattedChat: vi.fn(),
  tokenize: vi.fn(),
  clearCache: vi.fn(),
  completion: vi.fn(),
  stopCompletion: vi.fn(),
  release: vi.fn(),
}));
vi.mock('llama.rn', () => ({ initLlama: native.init }));
import { LlamaRnTriageEngine, ResilientTriageEngine, type ChatMessage } from './LocalTriageEngine';

const messages: ChatMessage[] = [{ role: 'user', content: 'Write a short story about a cat.' }];
beforeEach(() => {
  vi.resetAllMocks();
  native.init.mockResolvedValue(native);
  native.getFormattedChat.mockResolvedValue({
    type: 'jinja',
    prompt: '<user>Write a short story about a cat.</user><assistant>',
    additional_stops: ['<end>'],
  });
  native.tokenize.mockResolvedValue({ tokens: [1, 2] });
  native.stopCompletion.mockResolvedValue(undefined);
  native.completion.mockResolvedValue({ text: 'Once upon a time…', stopped_limit: 0 });
});

it('passes only conversation through the model template and returns unconstrained text', async () => {
  const engine = new LlamaRnTriageEngine('file:///model.gguf');
  const stream = vi.fn();
  native.completion.mockImplementationOnce(async (_params, callback) => {
    callback({ token: 'Once ' });
    callback({ token: 'upon a time…' });
    return { text: 'Once upon a time…', stopped_limit: 0 };
  });
  expect(await engine.chat(messages, stream, new AbortController().signal)).toEqual({
    text: 'Once upon a time…',
    limited: false,
  });
  expect(native.getFormattedChat).toHaveBeenCalledWith(messages, undefined, {
    enable_thinking: false,
  });
  const params = native.completion.mock.calls[0]![0];
  expect(params.prompt).toContain('Write a short story');
  for (const field of ['grammar', 'response_format', 'json_schema', 'tools', 'messages'])
    expect(params).not.toHaveProperty(field);
  expect(stream.mock.calls).toEqual([['Once '], ['upon a time…']]);
  expect(native.clearCache).toHaveBeenCalledOnce();
});

it('stops only the current completion and removes the cancellation listener afterward', async () => {
  const engine = new LlamaRnTriageEngine('file:///model.gguf');
  const abort = new AbortController();
  native.completion.mockImplementationOnce(async () => {
    abort.abort();
    return { text: 'Partial', stopped_limit: 0 };
  });
  await engine.chat(messages, vi.fn(), abort.signal);
  expect(native.stopCompletion).toHaveBeenCalledOnce();
  native.stopCompletion.mockClear();
  const completed = new AbortController();
  await engine.chat(messages, vi.fn(), completed.signal);
  completed.abort();
  expect(native.stopCompletion).not.toHaveBeenCalled();
});

it('honors cancellation during model load without starting generation', async () => {
  const abort = new AbortController();
  native.init.mockImplementationOnce(async () => {
    abort.abort();
    return native;
  });
  await expect(
    new LlamaRnTriageEngine('file:///model.gguf').chat(messages, vi.fn(), abort.signal),
  ).rejects.toThrow();
  expect(native.completion).not.toHaveBeenCalled();
});

it('rejects context overflow and reports a reply that reached its output limit', async () => {
  const engine = new LlamaRnTriageEngine('file:///model.gguf');
  native.tokenize.mockResolvedValueOnce({ tokens: Array(6017).fill(1) });
  await expect(engine.chat(messages, vi.fn(), new AbortController().signal)).rejects.toThrow(
    /context/,
  );
  expect(native.completion).not.toHaveBeenCalled();
  native.completion.mockResolvedValueOnce({ text: 'Long answer', stopped_limit: 1 });
  expect((await engine.chat(messages, vi.fn(), new AbortController().signal)).limited).toBe(true);
});

it('surfaces chat model failures without returning incident fallback text', async () => {
  const primary = {
    modeLabel: 'test',
    analyze: vi.fn(),
    chat: vi.fn().mockRejectedValue(new Error('Model failed')),
  };
  await expect(
    new ResilientTriageEngine(primary).chat(messages, vi.fn(), new AbortController().signal),
  ).rejects.toThrow('Model failed');
  expect(primary.analyze).not.toHaveBeenCalled();
});
