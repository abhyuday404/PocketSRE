import {
  diagnosisJsonSchema,
  fixProposalJsonSchema,
  type FixContext,
  type FixProposal,
  type Diagnosis,
  type IncidentBundle,
} from '@pocketsre/contracts';
import {
  buildTriagePrompt,
  createDeterministicDiagnosis,
  validateDiagnosis,
  sanitizeBundle,
  buildFixPrompt,
  validateFix,
  validateFixResponse,
} from '@pocketsre/incident-engine';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatResult = { text: string; limited: boolean };
export type ChatCompletion = (
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
) => Promise<ChatResult>;

export interface LocalTriageEngine {
  readonly modeLabel: string;
  analyze(bundle: IncidentBundle): Promise<Diagnosis>;
  proposeFix?(context: FixContext): Promise<FixProposal>;
  chat?: ChatCompletion;
  release?(): Promise<void>;
}

export class DeterministicTriageEngine implements LocalTriageEngine {
  readonly modeLabel = 'Deterministic offline fallback';

  async analyze(bundle: IncidentBundle): Promise<Diagnosis> {
    return createDeterministicDiagnosis(sanitizeBundle(bundle));
  }
}

type LlamaContext = Awaited<ReturnType<(typeof import('llama.rn'))['initLlama']>>;

// llama.cpp rejects bounded string repetitions above 2,000. Keep output bounded
// by n_predict and enforce the complete string limits in validateFix on both ends.
function fixSamplingSchema(context: FixContext) {
  return JSON.parse(
    JSON.stringify(fixProposalJsonSchema, (key, value) => {
      if (key === 'maxLength') return undefined;
      if (key === 'evidenceIds')
        return {
          ...value,
          maxItems: 3,
          items: {
            type: 'string',
            enum: context.bundle.evidence.slice(-12).map((item) => item.id),
          },
        };
      if (key === 'path') return { ...value, enum: context.files.map((file) => file.path) };
      return value;
    }),
  ) as typeof fixProposalJsonSchema;
}

export class LlamaRnTriageEngine implements LocalTriageEngine {
  readonly modeLabel = 'On-device GGUF model';
  private context: LlamaContext | null = null;

  constructor(private readonly modelPath: string) {}

  private async getContext(): Promise<LlamaContext> {
    if (this.context) return this.context;
    const { initLlama } = await import('llama.rn');
    const accelerator = process.env.EXPO_PUBLIC_ACCELERATOR ?? 'cpu';
    this.context = await initLlama({
      model: this.modelPath,
      n_ctx: 8192,
      n_threads: 4,
      n_gpu_layers: accelerator === 'cpu' ? 0 : 99,
      ...(accelerator === 'npu' ? { devices: ['HTP0'] } : {}),
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__)
      console.info('PocketSRE model runtime', {
        requestedAccelerator: accelerator,
        requestedGpuLayers: accelerator === 'cpu' ? 0 : 99,
        gpu: this.context.gpu,
        devices: this.context.devices,
        reasonNoGPU: this.context.reasonNoGPU,
      });
    return this.context;
  }

  async analyze(bundle: IncidentBundle): Promise<Diagnosis> {
    const context = await this.getContext();
    await context.clearCache();
    const response = await context.completion({
      messages: [{ role: 'user', content: buildTriagePrompt(bundle) }],
      enable_thinking: false,
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: diagnosisJsonSchema },
      },
      n_predict: 1000,
      temperature: 0.1,
      stop: ['</s>', '<|eot_id|>', '<|im_end|>'],
    });
    const jsonStart = response.text.indexOf('{');
    const jsonEnd = response.text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('The local model returned no JSON.');

    const candidate = JSON.parse(response.text.slice(jsonStart, jsonEnd + 1)) as unknown;
    if (candidate && typeof candidate === 'object') {
      (candidate as Record<string, unknown>).mode = 'on-device-llm';
    }
    const validation = validateDiagnosis(candidate, bundle);
    if (!validation.success) throw new Error(validation.errors.join(' '));
    return validation.diagnosis;
  }

  async release(): Promise<void> {
    await this.context?.stopCompletion?.();
    await this.context?.release();
    this.context = null;
  }

  /** Temporary model playground: no incident prompt, schema, citations, or tools. */
  chat: ChatCompletion = async (messages, onToken, signal) => {
    const checkStopped = () => {
      if (signal.aborted) throw new Error('Chat stopped.');
    };
    checkStopped();
    const context = await this.getContext();
    checkStopped();
    const formatted = await context.getFormattedChat(messages, undefined, {
      enable_thinking: false,
    });
    const prompt = formatted.prompt ?? '';
    const { tokens } = await context.tokenize(prompt);
    if (tokens.length > 6016)
      throw new Error(
        'This conversation fills the model context. Clear chat or shorten your message.',
      );
    checkStopped();
    await context.clearCache();
    checkStopped();
    const stop = () => {
      void context.stopCompletion().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      // Use the formatted prompt directly so cancellation cannot race a second async template pass.
      const response = await context.completion(
        {
          prompt,
          n_predict: 2048,
          temperature: 0.7,
          stop: [
            '</s>',
            '<|eot_id|>',
            '<|im_end|>',
            ...('additional_stops' in formatted ? (formatted.additional_stops ?? []) : []),
          ],
        },
        ({ token }) => {
          if (!signal.aborted) onToken(token);
        },
      );
      return { text: response.text, limited: !!(response.stopped_limit || response.context_full) };
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };

  async proposeFix(source: FixContext): Promise<FixProposal> {
    const context = await this.getContext();
    const prompt = buildFixPrompt(source);
    const tokenized = await context.tokenize(prompt);
    if (tokenized.tokens.length > 5500)
      throw new Error('Source exceeds the local model context. Select fewer or smaller files.');
    // Hybrid models retain recurrent state; each incident/source snapshot starts fresh.
    await context.clearCache();
    const response = await context.completion({
      messages: [{ role: 'user', content: prompt }],
      enable_thinking: false,
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: fixSamplingSchema(source) },
      },
      n_predict: 2400,
      temperature: 0.1,
      stop: ['</s>', '<|eot_id|>', '<|im_end|>'],
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__)
      console.info('PocketSRE fix inference timings', response.timings);
    const start = response.text.indexOf('{');
    const end = response.text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The local model returned no fix.');
    const proposal = validateFixResponse(source, JSON.parse(response.text.slice(start, end + 1)));
    if (source.task && !proposal.edits.length) return proposal;
    return validateFix(source, proposal).proposal;
  }
}

export function createTriageEngine(
  configuredPath = process.env.EXPO_PUBLIC_MODEL_PATH,
): LocalTriageEngine {
  const modelPath = configuredPath?.trim();
  return modelPath
    ? new ResilientTriageEngine(new LlamaRnTriageEngine(modelPath))
    : new DeterministicTriageEngine();
}

export class ResilientTriageEngine implements LocalTriageEngine {
  modeLabel = 'On-device model';
  constructor(private readonly primary: LocalTriageEngine) {}
  async analyze(raw: IncidentBundle): Promise<Diagnosis> {
    const bundle = sanitizeBundle(raw);
    try {
      const result = await this.primary.analyze(bundle);
      const validated = validateDiagnosis(result, bundle);
      if (!validated.success) throw new Error('Unverified diagnosis');
      this.modeLabel = this.primary.modeLabel;
      return validated.diagnosis;
    } catch {
      this.modeLabel = 'Model unavailable or unverified; local rule-based fallback';
      return createDeterministicDiagnosis(bundle);
    }
  }
  async release() {
    await this.primary.release?.();
  }
  chat: ChatCompletion = async (messages, onToken, signal) => {
    if (!this.primary.chat)
      throw new Error('Import a GGUF model in Settings to use temporary chat.');
    return this.primary.chat(messages, onToken, signal);
  };
  async proposeFix(context: FixContext): Promise<FixProposal> {
    if (!this.primary.proposeFix)
      throw new Error('Select a local model in Settings to draft a code fix.');
    // Rule-based diagnosis remains available, but never fabricates a replacement patch.
    return this.primary.proposeFix(context);
  }
}
