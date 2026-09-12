import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type {
  ActionResult,
  AgentTask,
  FixContext,
  FixDraft,
  FixProposal,
} from '@pocketsre/contracts';
import { fetchFixConfig, fetchFixContext, prepareFix, publishFix } from '../api/gateway';
import { Badge, Button, Card, ui } from './ui';
import { colors } from '../theme';

export function FixHarness({
  incidentId,
  connected,
  busy,
  generate,
  mode = 'fix',
  modelAvailable = true,
  onOpenSettings,
  projectId,
}: {
  incidentId: string;
  connected: boolean;
  busy: boolean;
  generate: (context: FixContext) => Promise<FixProposal>;
  mode?: 'fix' | 'agent';
  modelAvailable?: boolean;
  onOpenSettings?: () => void;
  projectId?: string;
}) {
  const agent = mode === 'agent';
  const api = {
    config: () => (projectId ? fetchFixConfig(projectId) : fetchFixConfig()),
    context: (incidentId: string, paths: string[], task?: AgentTask) =>
      projectId
        ? fetchFixContext(incidentId, paths, task, projectId)
        : fetchFixContext(incidentId, paths, task),
    prepare: (contextId: string, proposal: FixProposal) =>
      projectId ? prepareFix(contextId, proposal, projectId) : prepareFix(contextId, proposal),
    publish: (approval: { draftId: string; requestId: string; approvedAt: string }) =>
      projectId ? publishFix(approval, projectId) : publishFix(approval),
  };
  const [request, setRequest] = useState('');
  const [conversation, setConversation] = useState<AgentTask['history']>([]);
  const [activeRequest, setActiveRequest] = useState('');
  const [config, setConfig] = useState<Awaited<ReturnType<typeof fetchFixConfig>> | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [draft, setDraft] = useState<FixDraft | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const activeScope = useRef({ connected, draftId: draft?.id });
  activeScope.current = { connected, draftId: draft?.id };
  const approval = useRef<{ draftId: string; requestId: string; approvedAt: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    if (connected)
      void api
        .config()
        .then((value) => {
          if (mounted.current) setConfig(value);
        })
        .catch(() => {
          if (mounted.current) setMessage('Could not read GitHub fix configuration.');
        });
    return () => {
      mounted.current = false;
    };
  }, [connected, projectId]);
  async function run(work: () => Promise<void>) {
    if (lock.current || !mounted.current) return;
    lock.current = true;
    setWorking(true);
    try {
      await work();
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'The fix operation failed.');
    } finally {
      lock.current = false;
      if (mounted.current) {
        setWorking(false);
        setActiveRequest('');
      }
    }
  }
  const disabled = busy || working || !connected;
  const localDemo = (draft?.delivery ?? config?.delivery) === 'local-demo';
  const awaitingResult = !result || result.status === 'running' || result.status === 'accepted';
  function publish() {
    if (!draft || disabled) return;
    Alert.alert(
      localDemo ? 'Deploy this fix to the local demo?' : 'Create this draft pull request?',
      `Repository: ${draft.repository}\nBase: ${draft.baseBranch} at ${draft.baseCommit.slice(0, 12)}\nFiles: ${draft.changes.map((change) => change.path).join(', ')}\n\n${localDemo ? 'The gateway will test this exact patch, replace checkout.mjs in the isolated running demo, and verify live HTTP health and checkout results. This does not deploy to a cloud service.' : 'The exact changes shown below will be published. Tests have not been run. Repository CI may run; PocketSRE will not merge or deploy the PR.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: localDemo ? 'Test and deploy' : 'Create draft PR',
          onPress: () => {
            if (
              !mounted.current ||
              !activeScope.current.connected ||
              activeScope.current.draftId !== draft.id
            )
              return;
            if (!approval.current)
              approval.current = {
                draftId: draft.id,
                requestId: randomUUID(),
                approvedAt: new Date().toISOString(),
              };
            void run(async () => {
              setMessage(
                localDemo
                  ? 'Testing, deploying and verifying the demo fix…'
                  : 'Publishing the approved patch…',
              );
              const published = await api.publish(approval.current!);
              if (mounted.current) {
                setResult(published);
                setMessage(published.message);
              }
            });
          },
        },
      ],
    );
  }
  return (
    <>
      {agent && (conversation.length || activeRequest) ? (
        <Card>
          <Text style={ui.title}>Conversation</Text>
          {conversation.map((turn, index) => (
            <View
              key={index}
              style={{
                gap: 8,
                padding: 14,
                borderRadius: 16,
                alignSelf: turn.role === 'user' ? 'flex-end' : 'stretch',
                maxWidth: turn.role === 'user' ? '90%' : '100%',
                backgroundColor: turn.role === 'user' ? colors.muted : 'transparent',
              }}
            >
              <Badge tone={turn.role === 'user' ? 'neutral' : 'warning'}>
                {turn.role === 'user' ? 'You' : 'Local agent'}
              </Badge>
              <Text selectable style={ui.body}>
                {turn.content}
              </Text>
            </View>
          ))}
          {activeRequest ? <Text style={ui.body}>You: {activeRequest}</Text> : null}
          <Text style={ui.label}>
            Kept for this app session. The latest two exchanges accompany follow-ups; proposed edits
            are not applied until merged through GitHub.
          </Text>
          <Button
            label="New conversation"
            variant="ghost"
            disabled={disabled || !!draft}
            onPress={() => {
              setConversation([]);
              setRequest('');
              setMessage('');
            }}
          />
        </Card>
      ) : null}
      <Card>
        <Text style={ui.title}>
          {localDemo
            ? 'Local AI → running demo fix'
            : agent
              ? 'Your repository assistant'
              : 'Local AI → GitHub pull request'}
        </Text>
        <Text style={ui.body}>
          {localDemo
            ? 'Draft a patch on your phone, review the changed line, then test and deploy it to the isolated checkout demo on your laptop.'
            : agent
              ? 'Ask about your code, request a feature, or improve an existing flow. The model runs on this phone and prepares changes for your review.'
              : 'Read a few relevant files, draft a fix on your phone, review the exact changes, then create a draft PR.'}
        </Text>
        {agent && !localDemo ? (
          <Text style={ui.label}>
            Works with up to three selected existing files. Reads and PRs need a connection. Code is
            not executed or tested here.
          </Text>
        ) : null}
        {!modelAvailable ? (
          <>
            <Text style={ui.body}>Download or import a model in Settings to use the agent.</Text>
            {onOpenSettings ? (
              <Button
                label="Open model settings"
                variant="outline"
                onPress={onOpenSettings}
                disabled={busy || working}
              />
            ) : null}
          </>
        ) : null}
        {!connected ? (
          <Text style={ui.body}>Connect to a live gateway to work with your repository.</Text>
        ) : !config?.enabled ? (
          <>
            <Text style={ui.body}>
              Enable GitHub fixes on your gateway and choose which source files PocketSRE can read
              and edit. Download or import a model in Settings to generate patches.
            </Text>
            <Button
              label="Refresh repository access"
              variant="outline"
              disabled={disabled}
              onPress={() =>
                void run(async () => {
                  const value = await api.config();
                  if (mounted.current) {
                    setConfig(value);
                    setMessage(
                      value.enabled
                        ? 'Repository access ready.'
                        : 'GitHub fixes are still disabled on this gateway.',
                    );
                  }
                })
              }
            />
          </>
        ) : (
          <>
            <Badge>{config.repository}</Badge>
            <Text style={ui.label}>
              {agent
                ? 'Choose the files the agent should read and edit.'
                : 'Select up to three small source files relevant to this incident.'}
            </Text>
            {config.paths.map((path) => (
              <Button
                key={path}
                label={`${paths.includes(path) ? '✓ ' : ''}${path}`}
                variant={paths.includes(path) ? 'outline' : 'ghost'}
                disabled={disabled || !!draft}
                onPress={() =>
                  setPaths((previous) =>
                    previous.includes(path)
                      ? previous.filter((item) => item !== path)
                      : previous.length < 3
                        ? [...previous, path]
                        : previous,
                  )
                }
              />
            ))}
            {!draft ? (
              <>
                {agent ? (
                  <>
                    <Text style={ui.label}>Your request</Text>
                    <TextInput
                      accessibilityLabel="Agent request"
                      placeholder="Ask about this project or describe a change…"
                      placeholderTextColor={colors.textMuted}
                      multiline
                      textAlignVertical="top"
                      maxLength={2000}
                      editable={!disabled}
                      value={request}
                      onChangeText={setRequest}
                      style={{
                        minHeight: 120,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 12,
                        backgroundColor: colors.muted,
                        color: colors.text,
                        padding: 14,
                        fontSize: 14,
                      }}
                    />
                    <Text style={ui.label}>
                      {request.length}/2000 · Keep credentials out of requests.
                    </Text>
                  </>
                ) : null}
                <Button
                  label={
                    working
                      ? agent
                        ? 'Agent working…'
                        : 'Preparing fix…'
                      : agent
                        ? 'Send to local agent'
                        : 'Draft fix on this phone'
                  }
                  disabled={
                    disabled || !paths.length || !modelAvailable || (agent && !request.trim())
                  }
                  onPress={() =>
                    void run(async () => {
                      const userRequest = request.trim();
                      if (agent) setActiveRequest(userRequest);
                      setResult(null);
                      setMessage('Reading repository source…');
                      const context = await api.context(
                        incidentId,
                        paths,
                        agent
                          ? { request: userRequest, history: conversation.slice(-4) }
                          : undefined,
                      );
                      if (!mounted.current) return;
                      setMessage(
                        agent
                          ? 'The local model is reading your request and selected source…'
                          : 'Generating an untested patch with the local model…',
                      );
                      const proposal = await generate(context);
                      if (!mounted.current) return;
                      const prepared = proposal.edits.length
                        ? await api.prepare(context.id, proposal)
                        : null;
                      if (mounted.current) {
                        setDraft(prepared);
                        if (agent) {
                          setConversation((previous) =>
                            [
                              ...previous,
                              { role: 'user' as const, content: userRequest },
                              {
                                role: 'assistant' as const,
                                content:
                                  `${proposal.summary}\nEvidence: ${proposal.evidenceIds.join(', ')}${proposal.edits.length ? `\nProposed changes (not applied): ${proposal.edits.map((edit) => `${edit.path}: ${edit.reason}`).join('; ')}` : ''}`.slice(
                                    0,
                                    2000,
                                  ),
                              },
                            ].slice(-12),
                          );
                          setRequest('');
                        }
                        setMessage(
                          prepared
                            ? 'Review every changed line before publishing. Evidence references are validated; correctness still needs review and tests.'
                            : 'Answered on this phone. You can ask a follow-up in Your request.',
                        );
                      }
                    })
                  }
                />
              </>
            ) : null}
          </>
        )}
      </Card>
      {draft ? (
        <Card>
          <Text style={ui.title}>{agent ? 'Review proposed changes' : 'Review proposed fix'}</Text>
          <Text style={ui.body}>{draft.proposal.summary}</Text>
          <Text selectable style={ui.label}>
            {draft.repository} · {draft.baseBranch} · {draft.baseCommit.slice(0, 12)}
          </Text>
          <Text selectable style={ui.label}>
            Evidence: {draft.proposal.evidenceIds.join(', ')}
          </Text>
          <Badge>
            {result?.status === 'succeeded' && localDemo
              ? 'Tests and live probes passed'
              : 'Tests not run'}
          </Badge>
          {draft.proposal.edits.map((edit, index) => (
            <View key={index} style={{ gap: 8 }}>
              <Text selectable style={ui.title}>
                {edit.path}
              </Text>
              <Text style={ui.body}>{edit.reason}</Text>
              <Text selectable style={ui.label}>
                Evidence: {edit.evidenceIds.join(', ')}
              </Text>
              <Text style={ui.label}>Remove</Text>
              <Text selectable style={ui.mono}>
                {edit.before}
              </Text>
              <Text style={ui.label}>Insert</Text>
              <Text selectable style={ui.mono}>
                {edit.after || '(empty)'}
              </Text>
            </View>
          ))}
          {config?.canPublish === false ? (
            <Text style={ui.body}>
              This project has read-only source access. The patch is ready for review; a separate PR
              credential is required to publish it.
            </Text>
          ) : null}
          {awaitingResult && config?.canPublish !== false ? (
            <Button
              label={
                approval.current
                  ? localDemo
                    ? 'Check deployment result'
                    : 'Check publication result'
                  : localDemo
                    ? 'Deploy demo fix'
                    : 'Create draft pull request'
              }
              disabled={disabled}
              onPress={
                approval.current
                  ? () =>
                      void run(async () => {
                        const published = await api.publish(approval.current!);
                        if (mounted.current) {
                          setResult(published);
                          setMessage(published.message);
                        }
                      })
                  : publish
              }
            />
          ) : null}
          {result?.pullRequestUrl ? (
            <Button
              label="Open pull request"
              disabled={working}
              onPress={() => {
                void Linking.openURL(result.pullRequestUrl!).catch(() =>
                  setMessage('Could not open GitHub.'),
                );
              }}
            />
          ) : null}
          <Button
            label={agent ? 'Continue conversation / clear draft' : 'Discard local draft'}
            variant="ghost"
            disabled={disabled || (!!approval.current && awaitingResult)}
            onPress={() => {
              setDraft(null);
              setResult(null);
              approval.current = null;
              setMessage('');
            }}
          />
        </Card>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {message}
        </Text>
      ) : null}
    </>
  );
}
