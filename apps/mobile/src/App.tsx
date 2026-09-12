import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { EvidenceEvent } from '@pocketsre/contracts';
import { chronologicalEvidence } from '@pocketsre/incident-engine';
import { useIncident } from './hooks/useIncident';
import { Connections } from './components/Connections';
import { Badge, Button, Card, Icon, useUi, type IconName } from './components/ui';
import { ThemeProvider, useTheme, themes, type ThemeName, type Palette } from './theme';
import { HISTORY_LIMITS, type SnapshotSource } from './storage/incidents';

type Tab = 'Overview' | 'Activity' | 'Settings';
type ActivityTab = 'Evidence' | 'Actions' | 'Saved';
const navigation: { label: Tab; icon: IconName }[] = [
  { label: 'Overview', icon: 'server' },
  { label: 'Activity', icon: 'activity' },
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
  const { colors } = useTheme();
  const ui = useUi();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  const { colors } = useTheme();
  const ui = useUi();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  const { colors, dark, name: themeName, setTheme, saveError } = useTheme();
  const ui = useUi();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [citedOnly, setCitedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const state = useIncident();
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
  const evidence = chronologicalEvidence(bundle);
  const cited = new Set([
    ...(diagnosis?.evidenceIds ?? []),
    ...(diagnosis?.alternativeCauses.flatMap((cause) => cause.evidenceIds) ?? []),
    ...(diagnosis?.proposedAction?.evidenceIds ?? []),
  ]);
  const filteredEvidence = evidence.filter(
    (event) =>
      (!citedOnly || cited.has(event.id)) &&
      [event.title, event.excerpt, event.id, sourceLabels[event.source]]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
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
    setQuery('');
    setCitedOnly(false);
    setActivityTab('Evidence');
    setTab('Activity');
  };
  const openIncidents = bundle.incident.status === 'resolved' ? 0 : 1;
  const refreshHealth = async () => {
    if (busy || refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.topBar}>
        <View style={ui.row}>
          <View style={styles.logo}>
            <Icon name="terminal" color={colors.primaryForeground} size={19} />
          </View>
          <View>
            <Text style={styles.brand}>PocketSRE</Text>
            <Text style={styles.brandCaption}>A little clarity. A calmer on-call.</Text>
          </View>
        </View>
        <View>
          <Badge dot tone={live ? 'success' : 'warning'}>
            {originLabel}
          </Badge>
        </View>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          key={tab}
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refreshHealth()}
              tintColor={colors.primary}
              colors={[colors.primary]}
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
                      : 'WORKSPACE / 03'}
                </Text>
                <Badge dot tone={live ? 'neutral' : 'warning'}>
                  {originLabel}
                </Badge>
              </View>
              <Text accessibilityRole="header" style={styles.pageTitle}>
                {tab === 'Overview'
                  ? 'Overview'
                  : tab === 'Activity'
                    ? 'Follow the signals'
                    : 'Make it yours'}
              </Text>
              <Text style={ui.body}>
                {tab === 'Overview'
                  ? 'Stay informed. Take the next step with confidence.'
                  : tab === 'Activity'
                    ? 'Evidence, actions and saved incidents.'
                    : 'Connections and device storage.'}
              </Text>
            </View>
            {tab === 'Overview' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh service health"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void refreshHealth()}
                style={({ pressed }) => [styles.iconButton, { opacity: busy || pressed ? 0.4 : 1 }]}
              >
                <Icon name="refresh" size={18} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>

          {snapshot ? (
            <View style={styles.notice}>
              <Text style={[ui.body, { color: colors.warning }]}>
                {originLabel + ' snapshot · Refresh to see current service health.'}
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
              <View style={styles.hero}>
                <View style={ui.between}>
                  <View style={styles.heroIcon}>
                    <Icon name={healthy ? 'check' : 'activity'} size={26} color={colors.primary} />
                  </View>
                  <Badge tone={healthy ? 'success' : 'warning'}>
                    {snapshot ? 'Snapshot health' : healthy ? 'All clear' : 'Let’s take a look'}
                  </Badge>
                </View>
                <Text style={styles.heroTitle}>
                  {healthy ? 'Room to breathe.' : 'Clarity starts here.'}
                </Text>
                <Text style={ui.body}>
                  {snapshot
                    ? 'Explore this snapshot, or reconnect for the latest signals.'
                    : healthy
                      ? 'Your service is healthy. Explore the evidence whenever you need it.'
                      : 'Your service needs attention. Let’s work through the evidence, one step at a time.'}
                </Text>
                <View style={ui.row}>
                  <Button
                    label={
                      diagnosis ? 'View evidence' : healthy ? 'Analyze service' : 'Analyze incident'
                    }
                    icon={diagnosis ? 'activity' : 'terminal'}
                    disabled={busy}
                    loading={busy}
                    onPress={diagnosis ? showEvidence : () => void analyze()}
                    style={{ flex: 1 }}
                  />
                  <Button label="Timeline" variant="outline" onPress={showEvidence} />
                </View>
              </View>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={ui.label}>Services connected</Text>
                  <Text style={styles.statValue}>{live ? '1' : '0'}</Text>
                </View>

                <View style={styles.stat}>
                  <Text style={ui.label}>{snapshot ? 'Snapshot incidents' : 'Open incidents'}</Text>
                  <View style={[ui.row, { flexWrap: 'wrap' }]}>
                    <Text style={styles.statValue}>{openIncidents}</Text>
                    {openIncidents ? (
                      <Text style={[ui.label, { color: colors.danger }]}>To review</Text>
                    ) : null}
                  </View>
                </View>
              </View>

              <Card style={styles.serviceCard}>
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
                    <Text style={ui.title}>Find the next step</Text>
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
                      label={busy ? 'Working…' : healthy ? 'Analyze service' : 'Analyze incident'}
                      loading={busy}
                      onPress={() => void analyze()}
                      disabled={busy}
                      icon="terminal"
                    />
                    <Text style={styles.small}>
                      Private by design · Analysis stays on this device
                    </Text>
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
                    <Text style={ui.title}>A safe place to practice</Text>
                    <Badge>Isolated</Badge>
                  </View>
                  <Text style={ui.body}>Simulate a checkout failure to try the recovery flow.</Text>
                  <View style={ui.row}>
                    <Button
                      label="Simulate an incident"
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
                    <Text style={ui.label}>
                      {filteredEvidence.length +
                        ' of ' +
                        evidence.length +
                        ' events · oldest first'}
                    </Text>
                    <Badge>{cited.size + ' cited'}</Badge>
                  </View>
                  <View style={styles.searchBox}>
                    <TextInput
                      accessibilityLabel="Search evidence"
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search signals, sources, or evidence IDs"
                      placeholderTextColor={colors.textMuted}
                      selectionColor={colors.primary}
                      style={styles.searchInput}
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    {query ? (
                      <Button label="Clear" variant="ghost" onPress={() => setQuery('')} />
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel="Show only cited evidence"
                    accessibilityState={{ checked: citedOnly }}
                    onPress={() => setCitedOnly(!citedOnly)}
                    style={[
                      styles.filter,
                      citedOnly && {
                        backgroundColor: colors.primaryMuted,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Icon
                      name="check"
                      size={16}
                      color={citedOnly ? colors.primary : colors.textMuted}
                    />
                    <Text
                      style={[ui.label, { color: citedOnly ? colors.primary : colors.textMuted }]}
                    >
                      Cited in analysis only
                    </Text>
                  </Pressable>
                  <View style={styles.evidenceList}>
                    {filteredEvidence.length ? (
                      filteredEvidence.map((event) => (
                        <EvidenceItem
                          key={event.id}
                          event={event}
                          index={evidence.indexOf(event)}
                          cited={cited.has(event.id)}
                        />
                      ))
                    ) : (
                      <EmptyState
                        title={evidence.length ? 'No matching signals' : 'No evidence yet'}
                        description={
                          evidence.length
                            ? 'Try another search or turn off the cited-only filter.'
                            : 'Refresh the service to collect the latest signals.'
                        }
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

          {tab === 'Settings' ? (
            <>
              <Card>
                <View style={ui.row}>
                  <Icon name="settings" color={colors.primary} />
                  <Text style={ui.title}>Choose your atmosphere</Text>
                </View>
                <Text style={ui.body}>
                  A little comfort for your on-call hours. Your choice is saved on this device.
                </Text>
                <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
                  {(Object.keys(themes) as ThemeName[]).map((key) => (
                    <Pressable
                      key={key}
                      accessibilityRole="radio"
                      accessibilityLabel={themes[key].label + ' theme'}
                      accessibilityState={{ checked: themeName === key }}
                      onPress={() => setTheme(key)}
                      style={({ pressed }) => [
                        styles.themeOption,
                        themeName === key && {
                          borderColor: colors.primary,
                          backgroundColor: colors.primaryMuted,
                        },
                        { opacity: pressed ? 0.75 : 1 },
                      ]}
                    >
                      <View
                        style={[
                          styles.swatch,
                          {
                            backgroundColor: themes[key].colors.background,
                            borderColor: themes[key].colors.border,
                          },
                        ]}
                      >
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            backgroundColor: themes[key].colors.primary,
                          }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ui.title}>{themes[key].label}</Text>
                        <Text style={ui.label}>{themes[key].description}</Text>
                      </View>
                      {themeName === key ? <Icon name="check" color={colors.primary} /> : null}
                    </Pressable>
                  ))}
                </View>
                {saveError ? (
                  <Text accessibilityLiveRegion="polite" style={ui.label}>
                    {saveError}
                  </Text>
                ) : null}
              </Card>
              <Connections settings={settings} busy={busy} onSave={updateConnection} />
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

      {busy ? (
        <View accessibilityLiveRegion="polite" style={styles.busyBar}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[ui.label, { flex: 1 }]}>
            {refreshing ? 'Refreshing service health…' : 'Working on your request…'}
          </Text>
        </View>
      ) : null}

      <View accessibilityRole="tablist" style={styles.navigation}>
        {navigation.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.label }}
            onPress={() => setTab(item.label)}
            style={({ pressed }) => [styles.navItem, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View
              style={[
                styles.navIcon,
                tab === item.label && { backgroundColor: colors.primaryMuted },
              ]}
            >
              <Icon
                name={item.icon}
                size={20}
                color={tab === item.label ? colors.primary : colors.textMuted}
              />
            </View>
            <Text
              style={[
                styles.navLabel,
                tab === item.label && { color: colors.primary, fontWeight: '700' },
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
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    brandCaption: { fontSize: 10, lineHeight: 16, color: colors.textMuted },
    eyebrow: {
      color: colors.primary,
      fontSize: 10,
      lineHeight: 16,
      letterSpacing: 1.4,
      fontWeight: '700',
    },
    serviceCard: { backgroundColor: colors.hero, borderColor: colors.accent, borderRadius: 24 },
    reviewCard: { borderTopLeftRadius: 10 },
    recoveryCard: { borderLeftWidth: 3, borderLeftColor: colors.warning },
    healthTitle: {
      color: colors.text,
      fontSize: 26,
      lineHeight: 34,
      fontWeight: '600',
      letterSpacing: -0.7,
    },
    hero: { backgroundColor: colors.hero, borderRadius: 26, padding: 22, gap: 14 },
    heroIcon: {
      width: 50,
      height: 50,
      borderRadius: 18,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTitle: {
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '600',
      letterSpacing: -0.7,
      color: colors.text,
    },
    busyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: colors.primaryMuted,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, minHeight: 52, fontSize: 14, color: colors.text, paddingVertical: 12 },
    filter: {
      alignSelf: 'flex-start',
      minHeight: 44,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    themeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
    },
    swatch: {
      width: 44,
      height: 44,
      borderRadius: 14,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    safeArea: { flex: 1, backgroundColor: colors.surface },
    topBar: {
      paddingHorizontal: 20,
      minHeight: 76,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    logo: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brand: { color: colors.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.5 },
    content: {
      flexGrow: 1,
      backgroundColor: colors.background,
      padding: 20,
      paddingBottom: 32,
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      gap: 16,
    },
    pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
    pageTitle: {
      color: colors.text,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.8,
      fontWeight: '600',
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    stats: { flexDirection: 'row', gap: 12 },
    stat: {
      flex: 1,
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: 14,
    },
    statValue: {
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '600',
      letterSpacing: -0.7,
      color: colors.text,
    },
    iconTile: {
      width: 42,
      height: 42,
      borderRadius: 8,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checks: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
    check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 5, height: 5, borderRadius: 3 },
    small: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
    incident: {
      gap: 10,
      padding: 16,
      borderRadius: 20,
      backgroundColor: colors.dangerMuted,
      borderWidth: 1,
      borderColor: colors.dangerMuted,
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
      padding: 18,
      borderRadius: 20,
      backgroundColor: colors.surface,
      gap: 12,
    },
    demoPanel: { gap: 10, backgroundColor: colors.muted, padding: 20, borderRadius: 20 },
    notice: {
      backgroundColor: colors.warningMuted,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.warningMuted,
    },
    statusLine: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      padding: 14,
      backgroundColor: colors.muted,
      borderRadius: 14,
    },
    navigation: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 5,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    navItem: { flex: 1, alignItems: 'center', gap: 3, minHeight: 55 },
    navIcon: {
      width: 58,
      height: 34,
      borderRadius: 14,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    navLabel: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
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
    segmentSelected: { backgroundColor: colors.surface, borderColor: colors.border },
    segmentText: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: colors.textMuted },
    evidenceList: { backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 16 },
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
      color: colors.textMuted,
      fontSize: 10,
      lineHeight: 18,
      paddingTop: 1,
    },
    codeBlock: { backgroundColor: colors.muted, borderRadius: 6, padding: 12, gap: 6 },
    empty: { paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center', gap: 12 },
  });
/* Incoming main-only fixed dark styling is intentionally not used because this branch preserves the user-selectable theme system.
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
*/
