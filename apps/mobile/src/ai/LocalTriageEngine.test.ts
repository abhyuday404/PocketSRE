import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTriageEngine,
  DeterministicTriageEngine,
  ResilientTriageEngine,
} from './LocalTriageEngine';
import { createSampleIncident } from '../data/sampleIncident';
import { createDeterministicDiagnosis, validateDiagnosis } from '@pocketsre/incident-engine';

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

  it('validates the deterministic engine and fallback even with no evidence', async () => {
    const bundle = createSampleIncident();
    bundle.evidence = [];
    const engine = new ResilientTriageEngine({
      modeLabel: 'unavailable',
      analyze: async () => {
        throw new Error('offline');
      },
    });
    for (const candidate of [new DeterministicTriageEngine(), engine]) {
      const result = await candidate.analyze(bundle);
      expect(result.likelyCause).toBeNull();
      expect(result.proposedAction).toBeNull();
      expect(result.evidenceIds).toEqual([]);
      expect(validateDiagnosis(result, bundle).success).toBe(true);
    }
  });

  it('falls back conservatively when a model overstates an unrelated failure', async () => {
    const bundle = createSampleIncident();
    bundle.evidence.find((event) => event.type === 'configuration_changed')!.excerpt =
      'Changed cache TTL.';
    bundle.evidence.find((event) => event.type === 'exception')!.excerpt =
      'AuthenticationError: invalid token audience.';
    const engine = new ResilientTriageEngine({
      modeLabel: 'native',
      analyze: async () => ({
        ...createDeterministicDiagnosis(bundle),
        mode: 'on-device-llm',
        confidence: 'high',
        likelyCause: 'A database configuration mismatch caused the incident.',
      }),
    });
    const result = await engine.analyze(bundle);
    expect(result.mode).toBe('deterministic');
    expect(result.likelyCause).toBeNull();
    expect(result.proposedAction?.type).not.toBe('TRIGGER_ROLLBACK_WORKFLOW');
    expect(validateDiagnosis(result, bundle).success).toBe(true);
  });

  it('keeps a structurally valid model paraphrase and rejects an unsupported rollback', async () => {
    const bundle = createSampleIncident();
    const diagnosis = createDeterministicDiagnosis(bundle);
    const engine = new ResilientTriageEngine({
      modeLabel: 'native',
      analyze: async () => ({
        ...diagnosis,
        mode: 'on-device-llm',
        likelyCause: 'The environment may lack the database setting expected by this release.',
      }),
    });
    expect((await engine.analyze(bundle)).mode).toBe('on-device-llm');
    diagnosis.proposedAction!.parameters.targetRelease = 'invented-release';
    const result = await engine.analyze(bundle);
    expect(result.mode).toBe('deterministic');
    expect(result.proposedAction?.parameters.targetRelease).toBe('rel-2026.09.1');
    expect(validateDiagnosis(result, bundle).success).toBe(true);
  });
});
