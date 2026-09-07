import type { Diagnosis, IncidentBundle } from '@pocketsre/contracts';
import {
  buildTriagePrompt,
  createDeterministicDiagnosis,
  validateDiagnosis,
} from '@pocketsre/incident-engine';

export interface LocalTriageEngine {
  readonly modeLabel: string;
  analyze(bundle: IncidentBundle): Promise<Diagnosis>;
  release?(): Promise<void>;
}

export class DeterministicTriageEngine implements LocalTriageEngine {
  readonly modeLabel = 'Deterministic offline fallback';

  async analyze(bundle: IncidentBundle): Promise<Diagnosis> {
    return createDeterministicDiagnosis(bundle);
  }
}

type LlamaContext = Awaited<ReturnType<(typeof import('llama.rn'))['initLlama']>>;

export class LlamaRnTriageEngine implements LocalTriageEngine {
  readonly modeLabel = 'On-device GGUF model';
  private context: LlamaContext | null = null;

  constructor(private readonly modelPath: string) {}

  private async getContext(): Promise<LlamaContext> {
    if (this.context) return this.context;
    const { initLlama } = await import('llama.rn');
    this.context = await initLlama({
      model: this.modelPath,
      n_ctx: 3072,
      n_gpu_layers: 99,
      devices: ['HTP0'],
      use_mlock: true,
    });
    return this.context;
  }

  async analyze(bundle: IncidentBundle): Promise<Diagnosis> {
    const context = await this.getContext();
    const response = await context.completion({
      prompt: buildTriagePrompt(bundle),
      n_predict: 700,
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
    await this.context?.release();
    this.context = null;
  }
}

export function createTriageEngine(): LocalTriageEngine {
  const modelPath = process.env.EXPO_PUBLIC_MODEL_PATH?.trim();
  return modelPath ? new LlamaRnTriageEngine(modelPath) : new DeterministicTriageEngine();
}
