import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { GitMergeMethod, GitMergePreview } from '@pocketsre/contracts';
import { fetchMergePreview, mergeProjectPull, markProjectPullReady } from '../api/gateway';
import { useConfirmation } from './ConfirmationModal';
import { Button, Card, ui } from './ui';
import { colors } from '../theme';
const labels: Record<GitMergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create merge commit',
  rebase: 'Rebase and merge',
};
export function PullRequestMerge({
  projectId,
  number,
  reviewedSha,
  onMerged,
}: {
  projectId: string;
  number: number;
  reviewedSha: string;
  onMerged: () => void;
}) {
  const [preview, setPreview] = useState<GitMergePreview | null>(null);
  const [method, setMethod] = useState<GitMergeMethod>('squash');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const confirm = useConfirmation();
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPreview(null);
    setMessage('');
    try {
      const value = await fetchMergePreview(projectId, number);
      if (!mounted.current) return;
      if (value.sha !== reviewedSha) {
        value.ready = false;
        value.reasons.push(
          'New commits were pushed. Refresh the project and review the updated diff first.',
        );
      }
      setPreview(value);
      setMethod((old) => (value.methods.includes(old) ? old : (value.methods[0] ?? 'squash')));
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : 'Could not load merge status.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  function markReady() {
    if (!preview?.draft || !preview.canMarkReady || inFlight.current || preview.sha !== reviewedSha)
      return;
    const reviewed = preview;
    confirm(
      'Mark this PR ready for review?',
      `${reviewed.repository} · #${number}\n${reviewed.title}\nCommit ${reviewed.sha.slice(0, 12)}\n\nThis exits draft mode. Merging still requires a separate confirmation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark ready',
          onPress: () => {
            if (!mounted.current || inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            void (async () => {
              let refreshed = false;
              try {
                const result = await markProjectPullReady(projectId, number, {
                  requestId: randomUUID(),
                  approvedAt: new Date().toISOString(),
                  sha: reviewed.sha,
                });
                if (!mounted.current) return;
                setMessage(result.message);
                if (result.status === 'succeeded') {
                  inFlight.current = false;
                  refreshed = true;
                  await refresh();
                }
              } catch (e) {
                if (mounted.current)
                  setMessage(e instanceof Error ? e.message : 'Could not mark ready.');
              } finally {
                if (!refreshed) {
                  inFlight.current = false;
                  if (mounted.current) setBusy(false);
                }
              }
            })();
          },
        },
      ],
    );
  }
  function review() {
    if (!preview?.ready || inFlight.current || finished) return;
    const reviewed = preview;
    confirm(
      'Merge this pull request?',
      `${reviewed.repository} · #${number}\n${reviewed.title}\n\n${reviewed.headRef} → ${reviewed.baseRef}\nCommit ${reviewed.sha.slice(0, 12)}\n${labels[method]}\n\nThis changes ${reviewed.baseRef}. GitHub will check the PR again before merging.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: labels[method],
          onPress: () => {
            if (!mounted.current || inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setMessage('');
            void (async () => {
              try {
                const result = await mergeProjectPull(projectId, number, {
                  requestId: randomUUID(),
                  approvedAt: new Date().toISOString(),
                  sha: reviewed.sha,
                  baseSha: reviewed.baseSha,
                  baseRef: reviewed.baseRef,
                  method,
                });
                if (!mounted.current) return;
                setMessage(result.message);
                setPreview(null);
                if (result.status === 'succeeded') {
                  setFinished(true);
                  onMerged();
                }
                if (result.status === 'running') setFinished(true);
              } catch (e) {
                if (mounted.current) {
                  setPreview(null);
                  setMessage(
                    e instanceof Error
                      ? e.message
                      : 'Merge response unavailable. Refresh the PR to check the outcome.',
                  );
                }
              } finally {
                inFlight.current = false;
                if (mounted.current) setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }
  return (
    <Card>
      <Text style={ui.title}>Merge pull request</Text>
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {message ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {message}
        </Text>
      ) : null}
      {preview ? (
        <>
          <Text style={ui.body}>
            {preview.merged
              ? 'Already merged'
              : preview.ready
                ? 'Ready to merge'
                : 'Merge unavailable'}
          </Text>
          {preview.reasons.map((reason) => (
            <Text key={reason} style={ui.body}>
              {reason}
            </Text>
          ))}
          {preview.draft && preview.canMarkReady ? (
            <Button
              label="Mark ready for review"
              disabled={busy || preview.sha !== reviewedSha}
              onPress={markReady}
            />
          ) : null}
          <Text style={ui.label}>Checks ({preview.checks.length})</Text>
          {preview.checks.length ? (
            preview.checks.map((check, i) => (
              <Text key={`${check.name}:${i}`} style={ui.body}>
                {check.name} · {check.state.replaceAll('_', ' ')}
              </Text>
            ))
          ) : (
            <Text style={ui.body}>No checks reported for this commit.</Text>
          )}
          {preview.ready ? (
            <>
              <Text style={ui.label}>Merge method</Text>
              <View style={{ gap: 8 }}>
                {preview.methods.map((value) => (
                  <Button
                    key={value}
                    label={labels[value]}
                    variant={method === value ? 'primary' : 'outline'}
                    disabled={busy}
                    onPress={() => setMethod(value)}
                  />
                ))}
              </View>
              <Button label="Review merge" disabled={busy || finished} onPress={review} />
            </>
          ) : null}
        </>
      ) : null}
      {!finished ? (
        <Button
          label="Refresh merge status"
          variant="ghost"
          disabled={busy}
          onPress={() => void refresh()}
        />
      ) : null}
    </Card>
  );
}
