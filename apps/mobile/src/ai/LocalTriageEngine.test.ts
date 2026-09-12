import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTriageEngine,
  DeterministicTriageEngine,
  ResilientTriageEngine,
} from './LocalTriageEngine';
import { createSampleIncident } from '../data/sampleIncident';
import { createDeterministicDiagnosis } from '@pocketsre/incident-engine';

describe('on-device resilience', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, '', '   '])(
    'starts without native model access for model path %s',
    async (modelPath) => {
      vi.stubEnv('EXPO_PUBLIC_MODEL_PATH', modelPath);
      const fetch = vi.fn(() => {
        throw new Error('First launch must not download a model');
      });
      vi.stubGlobal('fetch', fetch);
      try {
        const engine = createTriageEngine();
        expect(engine).toBeInstanceOf(DeterministicTriageEngine);
        const bundle = createSampleIncident();
        const diagnosis = await engine.analyze(bundle);
        expect(diagnosis.mode).toBe('deterministic');
        const evidenceIds = new Set(bundle.evidence.map((evidence) => evidence.id));
        expect(diagnosis.evidenceIds.length).toBeGreaterThan(0);
        expect(diagnosis.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
  it('falls back when the native model cannot load', async () => {
    const engine = new ResilientTriageEngine({
      modeLabel: 'native',
      analyze: async () => {
        throw new Error('No native model');
      },
    });
    const result = await engine.analyze(createSampleIncident());
    expect(result.mode).toBe('deterministic');
    expect(result.evidenceIds.length).toBeGreaterThan(0);
    expect(engine.modeLabel).toContain('fallback');
  });
  it('rejects invented evidence even when a model returns valid JSON', async () => {
    const bundle = createSampleIncident();
    const engine = new ResilientTriageEngine({
      modeLabel: 'native',
      analyze: async () => ({
        ...createDeterministicDiagnosis(bundle),
        mode: 'on-device-llm',
        evidenceIds: ['invented'],
      }),
    });
    const result = await engine.analyze(bundle);
    expect(result.mode).toBe('deterministic');
    expect(result.evidenceIds).not.toContain('invented');
  });
});
