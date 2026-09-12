import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { ActionResult, FixContext, FixDraft, FixProposal } from '@pocketsre/contracts';
import { fetchFixConfig, fetchFixContext, prepareFix, publishFix } from '../api/gateway';
import { Badge, Button, Card, ui } from './ui';

export function FixHarness({
  incidentId,
  connected,
  busy,
  generate,
}: {
  incidentId: string;
  connected: boolean;
  busy: boolean;
  generate: (context: FixContext) => Promise<FixProposal>;
}) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof fetchFixConfig>> | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [draft, setDraft] = useState<FixDraft | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const approval = useRef<{ draftId: string; requestId: string; approvedAt: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    if (connected)
      void fetchFixConfig()
        .then((value) => {
          if (mounted.current) setConfig(value);
        })
        .catch(() => {
          if (mounted.current) setMessage('Could not read GitHub fix configuration.');
        });
    return () => {
      mounted.current = false;
    };
  }, [connected]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    try {
      await work();
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'The fix operation failed.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  const disabled = busy || working || !connected;
  const awaitingResult = !result || result.status === 'running' || result.status === 'accepted';
  function publish() {
    if (!draft || disabled) return;
    Alert.alert(
      'Create this draft pull request?',
      `Repository: ${draft.repository}\nBase: ${draft.baseBranch} at ${draft.baseCommit.slice(0, 12)}\nFiles: ${draft.changes.map((change) => change.path).join(', ')}\n\nThe exact changes shown below will be published. Tests have not been run. Repository CI may run; PocketSRE will not merge or deploy the PR.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create draft PR',
          onPress: () => {
            if (!approval.current)
              approval.current = {
                draftId: draft.id,
                requestId: randomUUID(),
                approvedAt: new Date().toISOString(),
              };
            void run(async () => {
              setMessage('Publishing the approved patch…');
              const published = await publishFix(approval.current!);
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
      <Card>
        <Text style={ui.title}>Local AI → GitHub pull request</Text>
        <Text style={ui.body}>
          Read a few relevant files, draft a fix on your phone, review the exact changes, then
          create a draft PR.
        </Text>
        {!connected ? (
          <Text style={ui.body}>Connect to a live gateway to work with your repository.</Text>
        ) : !config?.enabled ? (
          <Text style={ui.body}>
            Enable GitHub fixes on your gateway and choose which source files PocketSRE can read and
            edit. Import a GGUF model in Settings to generate patches.
          </Text>
        ) : (
          <>
            <Badge>{config.repository}</Badge>
            <Text style={ui.label}>
              Select up to three small source files relevant to this incident.
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
              <Button
                label={working ? 'Preparing fix…' : 'Draft fix on this phone'}
                disabled={disabled || !paths.length}
                onPress={() =>
                  void run(async () => {
                    setMessage('Reading repository source…');
                    const context = await fetchFixContext(incidentId, paths);
                    if (!mounted.current) return;
                    setMessage('Generating an untested patch with the local model…');
                    const proposal = await generate(context);
                    if (!mounted.current) return;
                    const prepared = await prepareFix(context.id, proposal);
                    if (mounted.current) {
                      setDraft(prepared);
                      setMessage(
                        'Review every changed line before publishing. Evidence references are validated; correctness still needs review and tests.',
                      );
                    }
                  })
                }
              />
            ) : null}
          </>
        )}
      </Card>
      {draft ? (
        <Card>
          <Text style={ui.title}>Review proposed fix</Text>
          <Text style={ui.body}>{draft.proposal.summary}</Text>
          <Text selectable style={ui.label}>
            {draft.repository} · {draft.baseBranch} · {draft.baseCommit.slice(0, 12)}
          </Text>
          <Text selectable style={ui.label}>
            Evidence: {draft.proposal.evidenceIds.join(', ')}
          </Text>
          <Badge>Tests not run</Badge>
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
          {awaitingResult ? (
            <Button
              label={approval.current ? 'Check publication result' : 'Create draft pull request'}
              disabled={disabled}
              onPress={
                approval.current
                  ? () =>
                      void run(async () => {
                        const published = await publishFix(approval.current!);
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
            label="Discard local draft"
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
