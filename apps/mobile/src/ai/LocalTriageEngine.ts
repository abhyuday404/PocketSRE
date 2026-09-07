import { diagnosisJsonSchema, type Diagnosis, type IncidentBundle } from '@pocketsre/contracts';
import {
  buildTriagePrompt,
  createDeterministicDiagnosis,
  validateDiagnosis,
  sanitizeBundle,
} from '@pocketsre/incident-engine';

export interface LocalTriageEngine {
  readonly modeLabel: string;
  analyze(bundle: IncidentBundle): Promise<Diagnosis>;
  release?(): Promise<void>;
}

export class DeterministicTriageEngine implements LocalTriageEngine {
  readonly modeLabel = 'Deterministic offline fallback';

  async analyze(bundle: IncidentBundle): Promise<Diagnosis> {
    return createDeterministicDiagnosis(sanitizeBundle(bundle));
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
    const accelerator = process.env.EXPO_PUBLIC_ACCELERATOR ?? 'cpu';
    this.context = await initLlama({
      model: this.modelPath,
      n_ctx: 8192,
      n_gpu_layers: accelerator === 'cpu' ? 0 : 99,
      ...(accelerator === 'npu' ? { devices: ['HTP0'] } : {}),
    });
    return this.context;
  }

  async analyze(bundle: IncidentBundle): Promise<Diagnosis> {
    const context = await this.getContext();
    const response = await context.completion({
      messages: [{ role: 'user', content: buildTriagePrompt(bundle) }],
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
    await this.context?.release();
    this.context = null;
  }
}

export function createTriageEngine(): LocalTriageEngine {
  const modelPath = process.env.EXPO_PUBLIC_MODEL_PATH?.trim();
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
}
