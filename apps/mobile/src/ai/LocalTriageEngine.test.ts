import { describe, expect, it } from 'vitest';
import { ResilientTriageEngine } from './LocalTriageEngine';
import { createSampleIncident } from '../data/sampleIncident';
import { createDeterministicDiagnosis } from '@pocketsre/incident-engine';

describe('on-device resilience', () => {
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
