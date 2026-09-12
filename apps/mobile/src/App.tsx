import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { EvidenceEvent } from '@pocketsre/contracts';
import { chronologicalEvidence } from '@pocketsre/incident-engine';
import { useIncident } from './hooks/useIncident';
import { Connections } from './components/Connections';
import { FixHarness } from './components/FixHarness';
import { TempChat } from './components/TempChat';
import { LocalModel } from './components/LocalModel';
import { loadModelPath } from './settings/model';
import { Aurora, Badge, Button, Card, Icon, ui, type IconName } from './components/ui';
import { colors } from './theme';
import { HISTORY_LIMITS, type SnapshotSource } from './storage/incidents';

type Tab = 'Overview' | 'Activity' | 'Fixes' | 'Agent' | 'Settings';
type ActivityTab = 'Evidence' | 'Actions' | 'Saved';
const navigation: { label: Tab; icon: IconName }[] = [
  { label: 'Overview', icon: 'server' },
  { label: 'Activity', icon: 'activity' },
  { label: 'Fixes', icon: 'terminal' },
  { label: 'Agent', icon: 'terminal' },
  { label: 'Settings', icon: 'settings' },
];
const sourceLabels: Record<string, string> = {
  github: 'GitHub',
  deployment: 'Deployment',
  sentry: 'Sentry',
  health: 'Health',
  database: 'Database',
  investigator: 'Investigation',
  gateway: 'Gateway',
};
const snapshotLabels: Record<SnapshotSource, string> = {
  gateway: 'Saved gateway',
  'imported-incident': 'Imported incident · offline',
  'imported-investigation': 'Imported investigation · offline',
  sample: 'Sample · offline',
};
const dateLabel = (timestamp: string) => new Date(timestamp).toLocaleString();
const healthLabel = (status: string) =>
  status === 'healthy'
    ? 'Healthy'
    : status === 'down'
      ? 'Down'
      : status === 'degraded'
        ? 'Degraded'
        : 'Unknown';
const retentionLabel = `Keeps the newest ${HISTORY_LIMITS.perIncident} snapshots per incident, up to ${HISTORY_LIMITS.perScope} per gateway. Imports and samples each have a separate ${HISTORY_LIMITS.perScope}-snapshot limit. Older snapshots and their analyses expire together.`;
const timeLabel = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const actionLabel = (action: string) =>
  action === 'TRIGGER_ROLLBACK_WORKFLOW'
    ? 'Rollback'
    : action === 'RUN_HEALTH_CHECK'
      ? 'Health check'
      : action === 'CREATE_GITHUB_PULL_REQUEST'
        ? 'GitHub pull request'
        : 'Issue creation';

function EvidenceItem({
  event,
  index,
  cited,
}: {
  event: EvidenceEvent;
  index: number;
  cited: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.evidenceRow}>
      <Text style={styles.eventNumber}>{String(index + 1).padStart(2, '0')}</Text>
      <View style={{ flex: 1, gap: 8 }}>
        <View style={ui.between}>
          <Text style={ui.label}>{sourceLabels[event.source]}</Text>
          <Text style={ui.mono}>{timeLabel(event.timestamp)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={(expanded ? 'Collapse ' : 'Expand ') + event.title}
          onPress={() => setExpanded(!expanded)}
          style={[ui.between, { minHeight: 44 }]}
        >
          <Text style={[ui.title, { flex: 1, fontSize: 14 }]}>{event.title}</Text>
          <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
            <Icon name="chevron" size={14} color={colors.textMuted} />
          </View>
        </Pressable>
        <Text selectable style={ui.body} numberOfLines={expanded ? undefined : 2}>
          {event.excerpt}
        </Text>
        {cited ? (
          <View style={ui.row}>
            <Icon name="check" size={12} color={colors.success} />
            <Text style={[ui.label, { color: colors.success }]}>Cited in analysis</Text>
          </View>
        ) : null}
        {expanded ? (
          <View style={styles.codeBlock}>
            <Text selectable style={ui.mono}>
              {'Evidence ID: ' + event.id}
            </Text>
            {Object.entries(event.metadata).map(([key, value]) => (
              <Text selectable key={key} style={ui.mono}>
                {key + ': ' + value}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.iconTile}>
        <Icon name="clock" color={colors.textMuted} />
      </View>
      <Text style={ui.title}>{title}</Text>
      <Text style={[ui.body, { textAlign: 'center' }]}>{description}</Text>
    </View>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [modelPath, setModelPath] = useState<string | undefined>(undefined);
  useEffect(() => {
    void loadModelPath()
      .then(setModelPath)
      .catch(() => {});
  }, []);
  const state = useIncident(modelPath);
  const {
    bundle,
    diagnosis,
    busy,
    connection,
    mode,
    message,
    settings,
    history,
    totalSaved,
    historyNotice,
    capturedAt,
    analyzedAt,
    audit,
    canExecute,
    refresh,
    analyze,
    breakDemo,
    restoreDemo,
    confirmAction,
    shareBundle,
    importFile,
    selectHistory,
    updateConnection,
    clearCache,
  } = state;
  const [tab, setTab] = useState<Tab>('Overview');
  const [activityTab, setActivityTab] = useState<ActivityTab>('Evidence');
  const [agentMode, setAgentMode] = useState<'repository' | 'chat'>('repository');
  const evidence = chronologicalEvidence(bundle);
  const cited = new Set([
    ...(diagnosis?.evidenceIds ?? []),
    ...(diagnosis?.alternativeCauses.flatMap((cause) => cause.evidenceIds) ?? []),
    ...(diagnosis?.proposedAction?.evidenceIds ?? []),
  ]);
  const healthy = bundle.serviceHealth.status === 'healthy';
  const live = connection === 'live';
  const demo = live && mode === 'demo';
  const snapshot = !live;
  const originLabel = live
    ? mode === 'demo'
      ? 'Demo'
      : 'Live'
    : connection === 'cached'
      ? 'Saved · offline'
      : connection === 'imported'
        ? 'Imported'
        : 'Sample';
  const showEvidence = () => {
    setActivityTab('Evidence');
    setTab('Activity');
  };
  const openIncidents = bundle.incident.status === 'resolved' ? 0 : 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.ambientLight}>
        <Aurora subtle />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          key={tab}
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={busy}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.muted}
            />
          }
        >
          <View style={styles.pageHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={ui.between}>
                <Text style={styles.eyebrow}>
                  {tab === 'Overview'
                    ? 'OPERATIONS / 01'
                    : tab === 'Activity'
                      ? 'INCIDENT LOG / 02'
                      : tab === 'Fixes'
                        ? 'CODE FIXES / 03'
                        : tab === 'Agent'
                          ? 'LOCAL AGENT / 04'
                          : 'WORKSPACE / 05'}
                </Text>
                <Badge dot tone={live ? 'neutral' : 'warning'}>
                  {originLabel}
                </Badge>
              </View>
              <Text accessibilityRole="header" style={styles.pageTitle}>
                {tab}
              </Text>
              <Text style={ui.body}>
                {tab === 'Overview'
                  ? 'Service health. Clear next steps.'
                  : tab === 'Activity'
                    ? 'Evidence, actions and saved incidents.'
                    : tab === 'Fixes'
                      ? 'Review a local AI patch before opening a PR.'
                      : tab === 'Agent'
                        ? 'Ask your model. Shape your repository.'
                        : 'Connections and device storage.'}
              </Text>
            </View>
            {tab === 'Overview' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh service health"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void refresh()}
                style={({ pressed }) => [styles.iconButton, { opacity: busy || pressed ? 0.4 : 1 }]}
              >
                <Icon name="refresh" size={18} />
              </Pressable>
            ) : null}
          </View>

          {snapshot ? (
            <View style={styles.notice}>
              <Text style={[ui.body, { color: colors.warning }]}>
                {originLabel +
                  ' snapshot · Health may have changed. Refresh live data before taking action.'}
              </Text>
            </View>
          ) : null}
          {tab !== 'Settings' ? (
            <View style={{ gap: 4 }}>
              <Text style={ui.label}>{'Evidence generated ' + dateLabel(bundle.generatedAt)}</Text>
              <Text style={ui.label}>
                {capturedAt
                  ? 'Captured on this phone ' + dateLabel(capturedAt)
                  : connection === 'sample'
                    ? 'Development sample'
                    : 'Capture time unavailable in the older cache'}
              </Text>
            </View>
          ) : null}
          {historyNotice ? (
            <View style={styles.notice}>
              <Text accessibilityLiveRegion="polite" style={ui.body}>
                {historyNotice}
              </Text>
            </View>
          ) : null}

          {tab === 'Overview' ? (
            <>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={ui.label}>Services connected</Text>
                  <Text style={styles.statValue}>{live ? '1' : '0'}</Text>
                </View>
                <View style={styles.statRule} />
                <View style={styles.stat}>
                  <Text style={ui.label}>{snapshot ? 'Snapshot incidents' : 'Open incidents'}</Text>
                  <View style={[ui.row, { flexWrap: 'wrap' }]}>
                    <Text style={styles.statValue}>{openIncidents}</Text>
                    {openIncidents ? (
                      <View style={[styles.dot, { backgroundColor: colors.danger }]} />
                    ) : null}
                  </View>
                </View>
              </View>

              <Card aurora style={styles.serviceCard}>
                <View style={ui.between}>
                  <Text style={styles.eyebrow}>SERVICE STATUS</Text>
                  <Icon name="activity" size={20} color={colors.primary} />
                </View>
                <Text style={styles.healthTitle}>
                  {healthy
                    ? 'All systems normal.'
                    : bundle.serviceHealth.status === 'down'
                      ? 'Service interrupted.'
                      : 'Attention required.'}
                </Text>
                <View style={ui.between}>
                  <View style={[ui.row, { flex: 1 }]}>
                    <View style={styles.iconTile}>
                      <Icon name="server" size={20} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={ui.title}>{bundle.serviceHealth.serviceName}</Text>
                      <Text style={ui.mono}>
                        {bundle.serviceHealth.version ?? 'Unknown release'}
                      </Text>
                    </View>
                  </View>
                  <Badge
                    tone={
                      healthy
                        ? 'success'
                        : healthLabel(bundle.serviceHealth.status) === 'Unknown'
                          ? 'warning'
                          : 'danger'
                    }
                    dot
                  >
                    {healthLabel(bundle.serviceHealth.status)}
                  </Badge>
                </View>
                <View style={ui.divider} />
                <View style={styles.checks}>
                  {Object.entries(bundle.serviceHealth.checks).map(([name, status]) => (
                    <View key={name} style={styles.check}>
                      <View
                        style={[
                          styles.dot,
                          {
                            backgroundColor: status === 'healthy' ? colors.success : colors.danger,
                          },
                        ]}
                      />
                      <Text accessibilityLabel={name + ': ' + status} style={ui.label}>
                        {name === 'api' ? 'API' : name.charAt(0).toUpperCase() + name.slice(1)}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.small}>
                  {'Checked at ' +
                    timeLabel(bundle.serviceHealth.checkedAt) +
                    ' · Pull down to refresh'}
                </Text>
              </Card>

              {!healthy ? (
                <View style={styles.incident}>
                  <View style={ui.between}>
                    <Text style={ui.title}>Active incident</Text>
                    <Badge tone={bundle.incident.severity === 'critical' ? 'danger' : 'warning'}>
                      {bundle.incident.severity}
                    </Badge>
                  </View>
                  <Text style={styles.incidentTitle}>{bundle.incident.title}</Text>
                  <Text style={ui.label}>
                    {'Started ' +
                      timeLabel(bundle.incident.startedAt) +
                      ' · ' +
                      evidence.length +
                      ' evidence items'}
                  </Text>
                </View>
              ) : null}

              <Card style={styles.reviewCard}>
                <View style={ui.between}>
                  <View style={ui.row}>
                    <Icon name="terminal" size={18} />
                    <Text style={ui.title}>Incident review</Text>
                  </View>
                  <Badge>
                    {diagnosis
                      ? diagnosis.mode === 'deterministic'
                        ? 'Rule-based'
                        : 'On-device'
                      : 'On your phone'}
                  </Badge>
                </View>
                {diagnosis ? (
                  <>
                    {analyzedAt ? (
                      <Text style={ui.label}>
                        {'Analyzed ' + dateLabel(analyzedAt) + ' · tied to this evidence snapshot'}
                      </Text>
                    ) : null}
                    <Text selectable style={styles.finding}>
                      {diagnosis.likelyCause ??
                        (healthy ? 'No active incident detected.' : 'More evidence is needed.')}
                    </Text>
                    <Text selectable style={ui.body}>
                      {diagnosis.summary}
                    </Text>
                    <View style={ui.row}>
                      <Badge>{diagnosis.confidence + ' confidence'}</Badge>
                      <Text style={ui.label}>{cited.size + ' cited items'}</Text>
                    </View>
                    {diagnosis.nextDiagnosticStep ? (
                      <View style={styles.codeBlock}>
                        <Text style={ui.title}>Next check</Text>
                        <Text style={ui.body}>{diagnosis.nextDiagnosticStep}</Text>
                      </View>
                    ) : null}
                    {diagnosis.alternativeCauses.map((cause, index) => (
                      <View key={index} style={{ gap: 4 }}>
                        <Text style={ui.label}>
                          {'Alternative · ' + cause.confidence + ' confidence'}
                        </Text>
                        <Text style={ui.body}>{cause.statement}</Text>
                      </View>
                    ))}
                    <View style={ui.row}>
                      <Button
                        label="View evidence"
                        onPress={showEvidence}
                        variant="outline"
                        style={{ flex: 1 }}
                      />
                      <Button
                        label="Reanalyze"
                        onPress={() => void analyze()}
                        disabled={busy}
                        variant="ghost"
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={ui.body}>
                      {healthy
                        ? 'Review recent changes and health checks on this device.'
                        : 'Review the timeline to identify a likely cause and the next check.'}
                    </Text>
                    <Button
                      label={busy ? 'Working…' : 'Analyze incident'}
                      onPress={() => void analyze()}
                      disabled={busy}
                      icon="terminal"
                    />
                    <Text style={styles.small}>Works offline with a built-in rules engine.</Text>
                  </>
                )}
              </Card>

              {diagnosis?.proposedAction ? (
                <Card style={styles.recoveryCard}>
                  <View style={ui.between}>
                    <Text style={ui.title}>Recovery plan</Text>
                    <Badge tone="warning">Approval required</Badge>
                  </View>
                  <Text style={styles.finding}>
                    {diagnosis.proposedAction.type === 'TRIGGER_ROLLBACK_WORKFLOW'
                      ? 'Rollback to ' + diagnosis.proposedAction.parameters.targetRelease
                      : 'Run a fresh health check'}
                  </Text>
                  <Text style={ui.body}>{diagnosis.proposedAction.reason}</Text>
                  <Text style={ui.body}>{'Risk: ' + diagnosis.proposedAction.risk}</Text>
                  <Button
                    label="Review action"
                    icon="arrow"
                    onPress={confirmAction}
                    disabled={!canExecute}
                  />
                  {!canExecute ? (
                    <Text style={ui.label}>
                      {busy
                        ? 'Wait for the current operation to finish.'
                        : 'Refresh live data to enable actions.'}
                    </Text>
                  ) : null}
                </Card>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open incident evidence"
                onPress={showEvidence}
                style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={ui.row}>
                  <Icon name="activity" color={colors.textMuted} />
                  <View>
                    <Text style={ui.title}>Incident timeline</Text>
                    <Text style={ui.label}>
                      {evidence.length +
                        (evidence.length === 1 ? ' signal collected' : ' signals collected')}
                    </Text>
                  </View>
                </View>
                <Icon name="chevron" size={16} color={colors.textMuted} />
              </Pressable>

              {demo ? (
                <View style={styles.demoPanel}>
                  <View style={ui.between}>
                    <Text style={ui.title}>Recovery demo</Text>
                    <Badge>Isolated</Badge>
                  </View>
                  <Text style={ui.body}>Simulate a checkout failure to try the recovery flow.</Text>
                  <View style={ui.row}>
                    <Button
                      label="Simulate failure"
                      variant="outline"
                      onPress={() => void breakDemo()}
                      disabled={busy || !healthy}
                      style={{ flex: 1 }}
                    />
                    <Button
                      label="Reset"
                      variant="ghost"
                      onPress={() => void restoreDemo()}
                      disabled={busy}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}

          {tab === 'Activity' ? (
            <>
              <View accessibilityRole="tablist" style={styles.segmented}>
                {(['Evidence', 'Actions', 'Saved'] as const).map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: activityTab === item }}
                    onPress={() => setActivityTab(item)}
                    style={[styles.segment, activityTab === item && styles.segmentSelected]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        activityTab === item && { color: colors.primary },
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {activityTab === 'Evidence' ? (
                <>
                  <View style={ui.between}>
                    <Text style={ui.label}>{evidence.length + ' events · oldest first'}</Text>
                    <Badge>{cited.size + ' cited'}</Badge>
                  </View>
                  <View style={styles.evidenceList}>
                    {evidence.length ? (
                      evidence.map((event, index) => (
                        <EvidenceItem
                          key={event.id}
                          event={event}
                          index={index}
                          cited={cited.has(event.id)}
                        />
                      ))
                    ) : (
                      <EmptyState
                        title="No evidence yet"
                        description="Refresh the service to collect the latest signals."
                      />
                    )}
                  </View>
                  <View style={ui.row}>
                    <Button
                      label="Export bundle"
                      icon="upload"
                      variant="outline"
                      disabled={busy}
                      onPress={() => void shareBundle()}
                      style={{ flex: 1 }}
                    />
                    <Button
                      label="Import JSON"
                      icon="download"
                      variant="outline"
                      disabled={busy}
                      onPress={() => void importFile()}
                      style={{ flex: 1 }}
                    />
                  </View>
                  <Text style={ui.label}>
                    Exports are sanitized. Review the file before sharing.
                  </Text>
                </>
              ) : null}
              {activityTab === 'Actions' ? (
                audit.length ? (
                  audit.map((entry) => (
                    <Card key={entry.requestId}>
                      <View style={ui.between}>
                        <Text style={ui.title}>{actionLabel(entry.action)}</Text>
                        <Badge
                          tone={
                            entry.result.status === 'succeeded'
                              ? 'success'
                              : entry.result.status === 'failed'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {entry.result.status}
                        </Badge>
                      </View>
                      <Text style={ui.body}>{entry.result.message}</Text>
                      {entry.result.pullRequestUrl ? (
                        <Button
                          label="Open pull request"
                          variant="outline"
                          onPress={() => {
                            void Linking.openURL(entry.result.pullRequestUrl!).catch(() => {});
                          }}
                        />
                      ) : null}
                      <Text style={ui.mono}>
                        {timeLabel(entry.result.startedAt) + ' · ' + entry.serviceId}
                      </Text>
                    </Card>
                  ))
                ) : (
                  <EmptyState
                    title={live ? 'No actions yet' : 'Action history needs a live connection'}
                    description={
                      live
                        ? 'Approved health checks and recovery actions will appear here.'
                        : 'Refresh the gateway to load its action history. Reopen offline analyses under Saved.'
                    }
                  />
                )
              ) : null}
              {activityTab === 'Saved' ? (
                <>
                  <Text style={ui.body}>
                    Saved gateway evidence for the current connection, plus offline imports and
                    samples.
                  </Text>
                  <Text selectable style={ui.mono}>
                    {settings.url}
                  </Text>
                  <Text style={ui.label}>{retentionLabel}</Text>
                  <Text style={ui.label}>
                    Identical snapshots reuse their analysis. Reanalyzing replaces only that
                    snapshot’s analysis.
                  </Text>
                  {history.length ? (
                    <>
                      {history.map((item) => (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={
                            'Open ' +
                            snapshotLabels[item.source] +
                            ': ' +
                            item.bundle.incident.title +
                            (item.diagnosis ? ', with saved analysis' : '')
                          }
                          disabled={busy}
                          onPress={() => {
                            selectHistory(item);
                            setTab('Overview');
                          }}
                          style={({ pressed }) => [ui.card, { opacity: busy || pressed ? 0.5 : 1 }]}
                        >
                          <View style={ui.between}>
                            <Text style={[ui.title, { flex: 1 }]}>
                              {item.bundle.incident.title}
                            </Text>
                            <Icon name="chevron" size={16} />
                          </View>
                          <Badge>{snapshotLabels[item.source]}</Badge>
                          <Text style={ui.label}>
                            {'Evidence generated ' + dateLabel(item.bundle.generatedAt)}
                          </Text>
                          <Text style={ui.label}>
                            {item.capturedAt
                              ? 'Captured ' + dateLabel(item.capturedAt)
                              : 'Capture time unavailable · migrated cache'}
                          </Text>
                          <Text style={ui.label}>
                            {item.bundle.evidence.length +
                              ' evidence items · ' +
                              item.bundle.incident.status}
                          </Text>
                          <Text style={ui.label}>
                            {item.diagnosis
                              ? 'Reopen analysis from ' + dateLabel(item.diagnosis.analyzedAt)
                              : 'No saved analysis'}
                          </Text>
                        </Pressable>
                      ))}
                    </>
                  ) : (
                    <EmptyState
                      title="Nothing saved here yet"
                      description="Refresh a gateway or import evidence to save it for offline analysis."
                    />
                  )}
                  <Button
                    label="Clear all saved data"
                    variant="ghost"
                    onPress={() => void clearCache()}
                    disabled={busy || (!totalSaved && !historyNotice)}
                  />
                  <Text style={ui.label}>
                    Clears snapshots, imports, samples and analyses for every gateway on this phone,
                    including recovery copies. Exported files remain.
                  </Text>
                </>
              ) : null}
            </>
          ) : null}

          {tab === 'Fixes' ? (
            <FixHarness
              key={`${settings.url}:${bundle.incident.id}`}
              incidentId={bundle.incident.id}
              connected={live && mode === 'live'}
              busy={busy}
              generate={state.proposeFix}
            />
          ) : null}
          <View style={{ display: tab === 'Agent' ? 'flex' : 'none', gap: 16 }}>
            <View style={ui.row}>
              <Button
                label="Repository agent"
                variant={agentMode === 'repository' ? 'primary' : 'outline'}
                onPress={() => setAgentMode('repository')}
              />
              <Button
                label="Temp chat"
                variant={agentMode === 'chat' ? 'primary' : 'outline'}
                onPress={() => setAgentMode('chat')}
              />
            </View>
            <View style={{ display: agentMode === 'repository' ? 'flex' : 'none', gap: 16 }}>
              <FixHarness
                key={`agent:${settings.url}:${settings.token}:${modelPath ?? ''}`}
                mode="agent"
                incidentId={bundle.incident.id}
                connected={live && mode === 'live'}
                busy={busy}
                modelAvailable={!!(modelPath ?? process.env.EXPO_PUBLIC_MODEL_PATH)}
                generate={state.proposeFix}
                onOpenSettings={() => setTab('Settings')}
              />
            </View>
            <View style={{ display: agentMode === 'chat' ? 'flex' : 'none', gap: 16 }}>
              <TempChat
                key={`chat:${modelPath ?? ''}`}
                chat={state.chat}
                busy={busy}
                modelAvailable={!!(modelPath ?? process.env.EXPO_PUBLIC_MODEL_PATH)}
                onOpenSettings={() => setTab('Settings')}
              />
            </View>
          </View>
          {tab === 'Settings' ? (
            <>
              <Connections settings={settings} busy={busy} onSave={updateConnection} />
              <LocalModel
                path={modelPath ?? process.env.EXPO_PUBLIC_MODEL_PATH}
                busy={busy}
                onChange={setModelPath}
              />
              <Card>
                <View style={ui.between}>
                  <Text style={ui.title}>Data & privacy</Text>
                  <Icon name="terminal" size={18} color={colors.textMuted} />
                </View>
                <Text style={ui.body}>
                  Analysis stays on your phone. Provider credentials stay on your gateway, and its
                  access token is stored securely on this device.
                </Text>
                <View style={ui.divider} />
                <View style={ui.between}>
                  <Text style={ui.label}>Saved on this phone</Text>
                  <Text style={ui.title}>{totalSaved + ' snapshots'}</Text>
                </View>
                <Text style={ui.label}>{retentionLabel}</Text>
                <Button
                  label="Clear all saved data"
                  variant="outline"
                  disabled={busy || (!totalSaved && !historyNotice)}
                  onPress={() => void clearCache()}
                />
                <Text style={ui.label}>
                  Clears every gateway’s snapshots, offline imports, samples, analyses and recovery
                  copies. Exported files remain. Refreshing, importing or analyzing saves new data.
                </Text>
              </Card>
              {bundle.collection?.length ? (
                <Card>
                  <Text style={ui.title}>Evidence sources</Text>
                  {bundle.collection.map((item) => (
                    <View key={item.source} style={{ gap: 5 }}>
                      <View style={ui.between}>
                        <Text style={ui.title}>{item.source}</Text>
                        <Badge tone={item.status === 'ok' ? 'success' : 'warning'}>
                          {item.status}
                        </Badge>
                      </View>
                      <Text style={ui.body}>{item.message}</Text>
                    </View>
                  ))}
                </Card>
              ) : null}
              <Text style={[ui.label, { textAlign: 'center', paddingVertical: 8 }]}>
                PocketSRE / iQOO hackathon demo
              </Text>
            </>
          ) : null}

          {tab !== 'Settings'
            ? bundle.collection
                ?.filter((item) => item.status === 'unavailable')
                .map((item) => (
                  <View key={item.source} style={styles.notice}>
                    <Text style={ui.body}>{item.source + ': ' + item.message}</Text>
                  </View>
                ))
            : null}
          <View accessibilityLiveRegion="polite" style={styles.statusLine}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
            )}
            <Text style={[ui.label, { flex: 1 }]}>{message}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View accessibilityRole="tablist" style={[styles.navigation, { bottom: insets.bottom + 8 }]}>
        <LinearGradient
          pointerEvents="none"
          accessible={false}
          colors={['#FFE1C51C', '#FFB98405', '#100D0B33']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {navigation.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.label }}
            onPress={() => setTab(item.label)}
            style={({ pressed }) => [styles.navItem, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={[styles.navIcon, tab === item.label && styles.navIconSelected]}>
              <Icon
                name={item.icon}
                size={20}
                color={tab === item.label ? colors.primary : colors.textMuted}
              />
            </View>
            <Text
              style={[
                styles.navLabel,
                tab === item.label && { color: colors.primary, fontWeight: '600' },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  ambientLight: { position: 'absolute', top: 0, left: 0, right: 0, height: 440 },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1.6,
    fontWeight: '600',
  },
  serviceCard: {
    backgroundColor: '#201610',
    borderColor: colors.accentBorder,
    borderRadius: 28,
    padding: 24,
    gap: 20,
  },
  reviewCard: {
    backgroundColor: '#181513',
    borderColor: '#403127',
    borderTopLeftRadius: 8,
    gap: 18,
  },
  recoveryCard: {
    backgroundColor: '#201B14',
    borderColor: colors.accentBorder,
    borderLeftWidth: 3,
  },
  healthTitle: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '600',
    letterSpacing: -0.8,
  },
  content: {
    flexGrow: 1,
    padding: 22,
    paddingBottom: 132,
    gap: 24,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 42,
    lineHeight: 52,
    letterSpacing: -1.8,
    fontWeight: '600',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stats: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, gap: 20 },
  stat: { flex: 1, gap: 6 },
  statRule: { width: 1, backgroundColor: colors.border, marginVertical: 3 },
  statValue: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '600',
    letterSpacing: -0.7,
    color: colors.text,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checks: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  small: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  incident: {
    gap: 10,
    padding: 16,
    borderRadius: 10,
    backgroundColor: colors.dangerMuted,
    borderWidth: 0,
    borderColor: colors.dangerBorder,
    borderLeftWidth: 3,
  },
  incidentTitle: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 23,
    letterSpacing: -0.3,
  },
  finding: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  demoPanel: {
    gap: 12,
    backgroundColor: 'transparent',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  notice: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  statusLine: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 2 },
  navigation: {
    position: 'absolute',
    left: 28,
    right: 28,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 7,
    paddingBottom: 8,
    borderRadius: 48,
    overflow: 'hidden',
    backgroundColor: '#211A15D9',
    borderWidth: 1,
    borderColor: '#FFE0C32E',
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3, minHeight: 60 },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconSelected: {
    backgroundColor: '#FFAF7133',
    borderColor: '#FFD0A654',
  },
  navLabel: { fontSize: 11, lineHeight: 17, color: colors.textMuted },
  segmented: { backgroundColor: colors.muted, borderRadius: 8, padding: 3, flexDirection: 'row' },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentSelected: { backgroundColor: colors.accentMuted, borderColor: colors.accentBorder },
  segmentText: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: colors.textMuted },
  evidenceList: { borderTopWidth: 1, borderColor: colors.border },
  evidenceRow: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  eventNumber: {
    width: 18,
    fontFamily: 'monospace',
    color: colors.primary,
    fontSize: 10,
    lineHeight: 18,
    paddingTop: 1,
  },
  codeBlock: { backgroundColor: colors.muted, borderRadius: 6, padding: 12, gap: 6 },
  empty: { paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center', gap: 12 },
});
