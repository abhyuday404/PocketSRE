import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { EvidenceEvent } from '@pocketsre/contracts';
import { chronologicalEvidence } from '@pocketsre/incident-engine';
import { useIncident } from './hooks/useIncident';
import { Connections } from './components/Connections';
import { Badge, Button, Card, Icon, ui, type IconName } from './components/ui';
import { colors } from './theme';

type Tab = 'Overview' | 'Activity' | 'Settings';
type ActivityTab = 'Evidence' | 'Actions' | 'Saved';
const navigation: { label: Tab; icon: IconName }[] = [
  { label: 'Overview', icon: 'server' },
  { label: 'Activity', icon: 'activity' },
  { label: 'Settings', icon: 'settings' },
];
const sourceLabels: Record<EvidenceEvent['source'], string> = {
  github: 'GitHub',
  deployment: 'Deployment',
  sentry: 'Sentry',
  health: 'Health',
  database: 'Database',
  investigator: 'Investigation',
};
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
  const healthy = bundle.serviceHealth.status === 'healthy';
  const live = connection === 'live';
  const demo = live && mode === 'demo';
  const snapshot = !live;
  const originLabel = live
    ? mode === 'demo'
      ? 'Demo'
      : 'Live'
    : connection === 'cached'
      ? 'Offline'
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
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={ui.row}>
          <View style={styles.logo}>
            <Icon name="terminal" color={colors.primaryForeground} size={19} />
          </View>
          <Text style={styles.brand}>PocketSRE</Text>
        </View>
        <View>
          <Badge dot tone={live ? 'neutral' : 'warning'}>
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
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={busy}
              onRefresh={() => void refresh()}
              tintColor={colors.text}
              colors={[colors.text]}
            />
          }
        >
          <View style={styles.pageHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text accessibilityRole="header" style={styles.pageTitle}>
                {tab}
              </Text>
              <Text style={ui.body}>
                {tab === 'Overview'
                  ? 'Your service, at a glance.'
                  : tab === 'Activity'
                    ? 'The evidence behind every decision.'
                    : 'Your workspace. Your connection.'}
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

          {tab === 'Overview' ? (
            <>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={ui.label}>Connected services</Text>
                  <Text style={styles.statValue}>{live ? '1' : '0'}</Text>
                </View>
                <View style={styles.statRule} />
                <View style={styles.stat}>
                  <Text style={ui.label}>{snapshot ? 'Snapshot incidents' : 'Open incidents'}</Text>
                  <View style={ui.row}>
                    <Text style={styles.statValue}>{openIncidents}</Text>
                    {openIncidents ? <Badge tone="danger">Needs attention</Badge> : null}
                  </View>
                </View>
              </View>

              <Card>
                <View style={ui.between}>
                  <View style={[ui.row, { flex: 1 }]}>
                    <View style={styles.iconTile}>
                      <Icon name="server" size={20} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={ui.title}>{bundle.serviceHealth.serviceName}</Text>
                      <Text style={ui.mono}>{bundle.serviceHealth.version}</Text>
                    </View>
                  </View>
                  <Badge tone={healthy ? 'success' : 'danger'} dot>
                    {healthy
                      ? 'Healthy'
                      : bundle.serviceHealth.status === 'down'
                        ? 'Down'
                        : 'Degraded'}
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

              <Card>
                <View style={ui.between}>
                  <View style={ui.row}>
                    <Icon name="terminal" size={18} />
                    <Text style={ui.title}>Local analysis</Text>
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
                        ? 'Inspect the latest signals without sending your incident bundle to a cloud model.'
                        : 'Correlate the timeline and find a likely cause, with evidence for every conclusion.'}
                    </Text>
                    <Button
                      label={busy ? 'Working…' : 'Analyze incident'}
                      onPress={() => void analyze()}
                      disabled={busy}
                      icon="terminal"
                    />
                    <Text style={styles.small}>
                      Falls back to local rules when a model is unavailable.
                    </Text>
                  </>
                )}
              </Card>

              {diagnosis?.proposedAction ? (
                <Card>
                  <View style={ui.between}>
                    <Text style={ui.title}>Suggested action</Text>
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
                    <Text style={ui.title}>Demo sandbox</Text>
                    <Badge>Isolated</Badge>
                  </View>
                  <Text style={ui.body}>Simulate a checkout failure to try the recovery flow.</Text>
                  <View style={ui.row}>
                    <Button
                      label="Inject regression"
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
                      style={[styles.segmentText, activityTab === item && { color: colors.text }]}
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
                      <Text style={ui.mono}>
                        {timeLabel(entry.result.startedAt) + ' · ' + entry.serviceId}
                      </Text>
                    </Card>
                  ))
                ) : (
                  <EmptyState
                    title="No actions yet"
                    description="Approved health checks and recovery actions will appear here."
                  />
                )
              ) : null}
              {activityTab === 'Saved' ? (
                history.length ? (
                  <>
                    {history.map((item) => (
                      <Pressable
                        key={item.incident.id}
                        accessibilityRole="button"
                        accessibilityLabel={'Open saved incident: ' + item.incident.title}
                        disabled={busy}
                        onPress={() => {
                          selectHistory(item);
                          setTab('Overview');
                        }}
                        style={({ pressed }) => [ui.card, { opacity: busy || pressed ? 0.5 : 1 }]}
                      >
                        <View style={ui.between}>
                          <Text style={[ui.title, { flex: 1 }]}>{item.incident.title}</Text>
                          <Icon name="chevron" size={16} />
                        </View>
                        <Text style={ui.label}>{new Date(item.generatedAt).toLocaleString()}</Text>
                        <Badge>{item.incident.status}</Badge>
                      </Pressable>
                    ))}
                    <Button
                      label="Clear saved history"
                      variant="ghost"
                      onPress={() => void clearCache()}
                      disabled={busy}
                    />
                  </>
                ) : (
                  <EmptyState
                    title="Nothing saved yet"
                    description="Connected incidents are cached here for offline analysis."
                  />
                )
              ) : null}
            </>
          ) : null}

          {tab === 'Settings' ? (
            <>
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
                  <Text style={ui.label}>Saved snapshots</Text>
                  <Text style={ui.title}>{history.length + ' / 10'}</Text>
                </View>
                <Button
                  label="Clear saved history"
                  variant="outline"
                  disabled={busy || !history.length}
                  onPress={() => void clearCache()}
                />
                <Text style={ui.label}>This does not delete exported files.</Text>
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
                PocketSRE · Development build
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

      <View style={styles.navigation}>
        {navigation.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.label }}
            onPress={() => setTab(item.label)}
            style={({ pressed }) => [styles.navItem, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={[styles.navIcon, tab === item.label && { backgroundColor: colors.muted }]}>
              <Icon
                name={item.icon}
                size={20}
                color={tab === item.label ? colors.text : colors.textMuted}
              />
            </View>
            <Text
              style={[
                styles.navLabel,
                tab === item.label && { color: colors.text, fontWeight: '600' },
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
  safeArea: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    paddingHorizontal: 20,
    minHeight: 62,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  logo: {
    width: 29,
    height: 29,
    borderRadius: 7,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { color: colors.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.5 },
  content: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: 20,
    paddingBottom: 24,
    gap: 16,
  },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  pageTitle: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.8,
    fontWeight: '600',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stats: { flexDirection: 'row', paddingBottom: 4, gap: 20 },
  stat: { flex: 1, gap: 6 },
  statRule: { width: 1, backgroundColor: colors.border, marginVertical: 3 },
  statValue: {
    fontSize: 27,
    lineHeight: 34,
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
  small: { color: colors.textMuted, fontSize: 10, lineHeight: 16 },
  incident: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.dangerMuted,
    borderWidth: 1,
    borderColor: '#FECACA',
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
    paddingVertical: 8,
    gap: 12,
  },
  demoPanel: { gap: 10, backgroundColor: colors.muted, padding: 16, borderRadius: 10 },
  notice: {
    backgroundColor: colors.warningMuted,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEF08A',
  },
  statusLine: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 2 },
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
    width: 48,
    height: 30,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: { fontSize: 10, lineHeight: 16, color: colors.textMuted },
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
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 18,
    paddingTop: 1,
  },
  codeBlock: { backgroundColor: colors.muted, borderRadius: 6, padding: 12, gap: 6 },
  empty: { paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center', gap: 12 },
});
