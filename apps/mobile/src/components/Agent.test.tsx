import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { FixContext, FixDraft, FixProposal } from '@pocketsre/contracts';
import { createSampleIncident } from '../data/sampleIncident';

const api = vi.hoisted(() => ({
  config: vi.fn(),
  context: vi.fn(),
  prepare: vi.fn(),
  publish: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('./ConfirmationModal', () => ({ useConfirmation: () => api.confirm }));
vi.mock('react-native', () => ({
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Linking: { openURL: vi.fn() },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '88d56694-ce10-44cb-b5e9-67a5abed06a1' }));
vi.mock('./ui', () => ({ Button: 'Button', Card: 'Card', Badge: 'Badge', ui: {} }));
vi.mock('../api/gateway', () => ({
  fetchFixConfig: api.config,
  fetchFixContext: api.context,
  prepareFix: api.prepare,
  publishFix: api.publish,
}));
import { FixHarness } from './FixHarness';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const context: FixContext = {
  id: 'e4598293-f63f-46f0-99b1-4b6c9e213f08',
  repository: 'owner/repo',
  baseBranch: 'main',
  baseCommit: 'a'.repeat(40),
  baseTree: 'b'.repeat(40),
  expiresAt: '2099-01-01T00:00:00.000Z',
  bundle: createSampleIncident(),
  files: [
    { path: 'src/server.ts', sha: 'c'.repeat(40), mode: '100644', content: 'const port = 3001;' },
  ],
};
const answer: FixProposal = {
  summary: 'The selected file sets the port.',
  evidenceIds: [context.bundle.evidence[0]!.id],
  edits: [],
};
const proposal: FixProposal = {
  ...answer,
  summary: 'Make the port configurable.',
  edits: [
    {
      path: 'src/server.ts',
      before: '3001',
      after: 'Number(process.env.PORT ?? 3001)',
      reason: 'Allow a configurable port.',
      evidenceIds: answer.evidenceIds,
    },
  ],
};
const draft: FixDraft = {
  id: '44c4c8c2-549c-488c-b627-e57a4a800a4a',
  contextId: context.id,
  repository: context.repository,
  baseBranch: context.baseBranch,
  baseCommit: context.baseCommit,
  expiresAt: context.expiresAt,
  proposal,
  changes: [
    {
      path: 'src/server.ts',
      before: context.files[0]!.content,
      after: 'const port = Number(process.env.PORT ?? 3001);',
      mode: '100644',
    },
  ],
};
let renderer: ReactTestRenderer | undefined;
const generate = vi.fn<(context: FixContext) => Promise<FixProposal>>();
const button = (label: string) => renderer!.root.findByProps({ label });
async function mount(props: { modelAvailable?: boolean; connected?: boolean } = {}) {
  await act(async () => {
    renderer = create(
      <FixHarness
        mode="agent"
        incidentId="incident"
        connected
        busy={false}
        modelAvailable
        generate={generate}
        {...props}
      />,
    );
  });
}
async function compose(request = 'Explain the port setting.') {
  await act(async () => {
    button('src/server.ts').props.onPress();
    renderer!.root.findByProps({ accessibilityLabel: 'Agent request' }).props.onChangeText(request);
  });
}
async function send() {
  await act(async () => {
    button('Send to agent').props.onPress();
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  api.config.mockResolvedValue({
    enabled: true,
    repository: 'owner/repo',
    paths: ['src/server.ts'],
  });
  api.context.mockResolvedValue(context);
  api.prepare.mockResolvedValue(draft);
  generate.mockResolvedValue(answer);
  api.publish.mockResolvedValue({
    status: 'succeeded',
    message: 'Draft PR created.',
    pullRequestUrl: 'https://github.com/owner/repo/pull/1',
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

it('requires a model, selected files and a nonblank request', async () => {
  await mount({ modelAvailable: false });
  await compose();
  expect(button('Send to agent').props.disabled).toBe(true);
  expect(generate).not.toHaveBeenCalled();
  await act(async () => renderer!.unmount());
  await mount();
  expect(button('Send to agent').props.disabled).toBe(true);
  await compose('   ');
  expect(button('Send to agent').props.disabled).toBe(true);
});

it('refreshes access after GitHub fixes are enabled on the gateway', async () => {
  api.config.mockResolvedValueOnce({ enabled: false, repository: null, paths: [] });
  await mount();
  await act(async () => button('Refresh repository access').props.onPress());
  expect(button('src/server.ts')).toBeDefined();
  expect(api.config).toHaveBeenCalledTimes(2);
});

it('keeps grounded answers as conversation and sends follow-ups without publishing', async () => {
  await mount();
  await compose();
  await send();
  expect(api.context).toHaveBeenLastCalledWith('incident', ['src/server.ts'], {
    request: 'Explain the port setting.',
    history: [],
  });
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.publish).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain(answer.summary);
  await act(async () =>
    renderer!.root
      .findByProps({ accessibilityLabel: 'Agent request' })
      .props.onChangeText('Make it configurable.'),
  );
  await send();
  expect(api.context.mock.calls[1]![2]).toMatchObject({
    request: 'Make it configurable.',
    history: [{ role: 'user', content: 'Explain the port setting.' }, { role: 'assistant' }],
  });
  await act(async () => button('New conversation').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).not.toContain(answer.summary);
});

it('shows exact edits, then requires the separate approval before publishing', async () => {
  generate.mockResolvedValue(proposal);
  await mount();
  await compose('Make the port configurable.');
  await send();
  expect(api.prepare).toHaveBeenCalledWith(context.id, proposal);
  expect(api.publish).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain(proposal.edits[0]!.after);
  await act(async () => button('Create draft pull request').props.onPress());
  expect(api.publish).not.toHaveBeenCalled();
  const approve = api.confirm.mock.calls[0]![2][1].onPress;
  await act(async () => approve());
  expect(api.publish).toHaveBeenCalledWith(expect.objectContaining({ draftId: draft.id }));
  expect(button('Open pull request')).toBeDefined();
});

it('labels and approves isolated demo deployment without claiming a GitHub PR', async () => {
  api.config.mockResolvedValue({
    enabled: true,
    repository: 'local-demo/reviewer-checkout',
    paths: ['src/server.ts'],
    delivery: 'local-demo',
  });
  api.prepare.mockResolvedValue({ ...draft, delivery: 'local-demo' });
  api.publish.mockResolvedValue({ status: 'succeeded', message: 'Demo fix deployed.' });
  generate.mockResolvedValue(proposal);
  await mount();
  await compose();
  await send();
  expect(api.publish).not.toHaveBeenCalled();
  await act(async () => button('Deploy demo fix').props.onPress());
  expect(api.confirm.mock.calls[0]![0]).toBe('Deploy this fix to the local demo?');
  expect(api.confirm.mock.calls[0]![2][1].text).toBe('Test and deploy');
  await act(async () => api.confirm.mock.calls[0]![2][1].onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('Tests and live probes passed');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('Open pull request');
});

it('invalidates an open approval dialog when its reviewed draft is cleared', async () => {
  generate.mockResolvedValue(proposal);
  await mount();
  await compose();
  await send();
  await act(async () => button('Create draft pull request').props.onPress());
  const approve = api.confirm.mock.calls[0]![2][1].onPress;
  await act(async () => button('Continue conversation / clear draft').props.onPress());
  await act(async () => approve());
  expect(api.publish).not.toHaveBeenCalled();
});

it('retains the request on model failure so it can be retried', async () => {
  generate.mockRejectedValueOnce(new Error('Model unavailable'));
  await mount();
  await compose();
  await send();
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Agent request' }).props.value).toBe(
    'Explain the port setting.',
  );
  expect(JSON.stringify(renderer!.toJSON())).toContain('Model unavailable');
  expect(api.prepare).not.toHaveBeenCalled();
  await send();
  expect(generate).toHaveBeenCalledTimes(2);
});

it('drops a source response after leaving the gateway scope', async () => {
  let resolve!: (value: FixContext) => void;
  api.context.mockImplementation(
    () =>
      new Promise<FixContext>((done) => {
        resolve = done;
      }),
  );
  await mount();
  await compose();
  await send();
  await act(async () => renderer!.unmount());
  renderer = undefined;
  await act(async () => resolve(context));
  expect(generate).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.publish).not.toHaveBeenCalled();
});

it('restores a saved chat, retains its full transcript and only sends the latest context window', async () => {
  const history = Array.from({ length: 16 }, (_, i) => ({
    role: 'user' as const,
    content: `Older message ${i}`,
  }));
  const onChange = vi.fn();
  await act(async () => {
    renderer = create(
      <FixHarness
        mode="agent"
        incidentId="incident"
        connected
        busy={false}
        generate={generate}
        chatSession={{
          initial: {
            conversation: history,
            request: 'Continue explaining',
            paths: ['src/server.ts'],
          },
          onChange,
          onNew: vi.fn(),
        }}
      />,
    );
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Older message 0');
  await send();
  expect(api.context).toHaveBeenLastCalledWith('incident', ['src/server.ts'], {
    request: 'Continue explaining',
    history: history.slice(-4),
  });
  expect(onChange.mock.calls.at(-1)?.[0].conversation).toHaveLength(18);
  expect(api.publish).not.toHaveBeenCalled();
});
