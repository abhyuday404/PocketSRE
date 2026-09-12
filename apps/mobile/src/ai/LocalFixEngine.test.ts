import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FixContext, FixProposal } from '@pocketsre/contracts';
const native = vi.hoisted(() => ({
  completion: vi.fn(),
  tokenize: vi.fn(),
  release: vi.fn(),
  clearCache: vi.fn(),
}));
vi.mock('llama.rn', () => ({ initLlama: async () => native }));
import { LlamaRnTriageEngine, ResilientTriageEngine } from './LocalTriageEngine';
import { createSampleIncident } from '../data/sampleIncident';

const bundle = createSampleIncident();
const context: FixContext = {
  id: 'eb8b4e8f-c6c7-45cf-aafe-126bc17a3371',
  repository: 'owner/service',
  baseBranch: 'main',
  baseCommit: 'a'.repeat(40),
  baseTree: 'b'.repeat(40),
  expiresAt: '2099-01-01T00:00:00.000Z',
  bundle,
  files: [
    { path: 'server.ts', sha: 'c'.repeat(40), mode: '100644', content: 'const port = 3001;' },
  ],
};
const proposal: FixProposal = {
  summary: 'An untested port hypothesis.',
  evidenceIds: [bundle.evidence[0]!.id],
  edits: [
    {
      path: 'server.ts',
      before: '3001',
      after: '3000',
      reason: 'Use the expected port.',
      evidenceIds: [bundle.evidence[0]!.id],
    },
  ],
};
afterEach(() => vi.clearAllMocks());
describe('local model fix generation', () => {
  it('answers a repository question without preparing a patch and validates answer citations', async () => {
    native.tokenize.mockResolvedValue({ tokens: [1, 2] });
    const taskContext = { ...context, task: { request: 'Explain the port setting.', history: [] } };
    const answer = { ...proposal, summary: 'The selected source sets port 3001.', edits: [] };
    native.completion.mockResolvedValueOnce({ text: JSON.stringify(answer) });
    const engine = new LlamaRnTriageEngine('file:///model.gguf');
    expect(await engine.proposeFix(taskContext)).toEqual(answer);
    expect(native.completion.mock.calls[0]![0].messages[0].content).toContain(
      'Explain the port setting.',
    );
    native.completion.mockResolvedValueOnce({
      text: JSON.stringify({ ...answer, evidenceIds: ['invented'] }),
    });
    await expect(engine.proposeFix(taskContext)).rejects.toThrow(/evidence/);
  });
  it('validates native output against the supplied source and evidence', async () => {
    native.tokenize.mockResolvedValue({ tokens: [1, 2, 3] });
    native.completion.mockResolvedValueOnce({ text: JSON.stringify(proposal) });
    const engine = new LlamaRnTriageEngine('file:///model.gguf');
    expect(await engine.proposeFix(context)).toEqual(proposal);
    expect(JSON.stringify(native.completion.mock.calls[0]![0].response_format)).not.toContain(
      'maxLength',
    );
    const schema = native.completion.mock.calls[0]![0].response_format.json_schema.schema;
    expect(schema.properties.evidenceIds.maxItems).toBe(3);
    expect(schema.properties.evidenceIds.items.enum).toEqual(
      bundle.evidence.slice(-12).map((item) => item.id),
    );
    expect(schema.properties.edits.items.properties.path.enum).toEqual(['server.ts']);
    expect(native.clearCache).toHaveBeenCalledOnce();
    native.completion.mockResolvedValueOnce({
      text: JSON.stringify({ ...proposal, evidenceIds: ['invented'] }),
    });
    await expect(engine.proposeFix(context)).rejects.toThrow(/evidence/);
    native.completion.mockResolvedValueOnce({
      text: JSON.stringify({
        ...proposal,
        edits: [{ ...proposal.edits[0], after: 'x'.repeat(6001) }],
      }),
    });
    await expect(engine.proposeFix(context)).rejects.toThrow();
    await engine.release();
    expect(native.release).toHaveBeenCalledOnce();
  });
  it('refuses oversized input before requesting completion', async () => {
    native.tokenize.mockResolvedValue({ tokens: Array(5501).fill(1) });
    await expect(new LlamaRnTriageEngine('file:///model.gguf').proposeFix(context)).rejects.toThrow(
      /fewer/,
    );
    expect(native.completion).not.toHaveBeenCalled();
  });
  it('does not turn a model error into an invented fallback patch', async () => {
    const engine = new ResilientTriageEngine({
      modeLabel: 'test',
      analyze: vi.fn(),
      proposeFix: async () => {
        throw new Error('Model unavailable');
      },
    });
    await expect(engine.proposeFix(context)).rejects.toThrow('Model unavailable');
  });
});
