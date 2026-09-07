import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Diagnosis, EvidenceEvent, IncidentBundle } from '@pocketsre/contracts';
import { chronologicalEvidence } from '@pocketsre/incident-engine';
import {
  executeApprovedAction,
  fetchCurrentIncident,
  getGatewayUrl,
  injectDemoRegression,
  resetDemo,
} from './api/gateway';
import { createTriageEngine } from './ai/LocalTriageEngine';
import { createSampleIncident } from './data/sampleIncident';
import { serializeOfficeKitBundle } from './officekit/bundle';
import { colors } from './theme';

const sourceLabels: Record<EvidenceEvent['source'], string> = {
  github: 'GitHub',
  deployment: 'Deploy',
  sentry: 'Sentry',
  health: 'Health',
  database: 'Database',
  investigator: 'Deep check',
};

function timeLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AppContent() {
  const [bundle, setBundle] = useState<IncidentBundle>(() => createSampleIncident());
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connection, setConnection] = useState<'live' | 'cached'>('cached');
  const [message, setMessage] = useState('Cached incident ready for offline triage.');
  const engine = useMemo(() => createTriageEngine(), []);
  const evidence = chronologicalEvidence(bundle);
  const cited = new Set(diagnosis?.evidenceIds ?? []);

  async function refresh() {
    setRefreshing(true);
    try {
      const current = await fetchCurrentIncident();
      setBundle(current);
      setDiagnosis(null);
      setConnection('live');
      setMessage(`Connected to ${getGatewayUrl()}`);
    } catch {
      setConnection('cached');
      setMessage('Gateway unavailable. Showing the last cached incident.');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      void engine.release?.();
    };
  }, [engine]);

  async function analyze() {
    setBusy(true);
    setMessage('Analyzing the sanitized incident bundle on this device…');
    try {
      const result = await engine.analyze(bundle);
      setDiagnosis(result);
      setMessage(`Analysis complete · ${engine.modeLabel}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Local analysis failed.');
    } finally {
      setBusy(false);
    }
  }

  async function breakDemo() {
    setBusy(true);
    try {
      await injectDemoRegression();
      await refresh();
      setMessage('Regression injected. Production signals are arriving.');
    } catch {
      setMessage('The live demo service is unavailable. Cached evidence is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  async function restoreDemo() {
    setBusy(true);
    try {
      await resetDemo();
      await refresh();
      setMessage('Demo service reset to its healthy release.');
    } catch {
      setMessage('Could not reset the demo service.');
    } finally {
      setBusy(false);
    }
  }

  function confirmAction() {
    const proposal = diagnosis?.proposedAction;
    if (!proposal) return;

    Alert.alert(
      proposal.type === 'TRIGGER_ROLLBACK_WORKFLOW' ? 'Confirm rollback' : 'Confirm action',
      `${proposal.reason}\n\nTarget: ${proposal.target}\nRisk: ${proposal.risk}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: proposal.type === 'TRIGGER_ROLLBACK_WORKFLOW' ? 'destructive' : 'default',
          onPress: () => void runAction(),
        },
      ],
    );
  }

  async function runAction() {
    const proposal = diagnosis?.proposedAction;
    if (!proposal) return;
    setBusy(true);
    setMessage('Executing the approved allowlisted action…');
    try {
      const result = await executeApprovedAction({
        incidentId: bundle.incident.id,
        serviceId: bundle.incident.serviceId,
        action: proposal.type,
        target: proposal.target,
        parameters: proposal.parameters,
        approvedAt: new Date().toISOString(),
      });
      await refresh();
      setMessage(result.message);
    } catch {
      setMessage('The action failed safely. No additional actions were attempted.');
    } finally {
      setBusy(false);
    }
  }

  async function shareBundle() {
    await Share.share({
      title: `PocketSRE ${bundle.incident.id}`,
      message: serializeOfficeKitBundle(bundle),
    });
  }

  const isHealthy = bundle.serviceHealth.status === 'healthy';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>PHONE-FIRST INCIDENT RESPONSE</Text>
            <Text style={styles.brand}>PocketSRE</Text>
          </View>
          <View style={[styles.connectionPill, connection === 'live' && styles.connectionPillLive]}>
            <View
              style={[styles.connectionDot, connection === 'live' && styles.connectionDotLive]}
            />
            <Text style={styles.connectionText}>{connection === 'live' ? 'LIVE' : 'CACHED'}</Text>
          </View>
        </View>

        <LinearGradient
          colors={isHealthy ? ['#173C2D', '#0B2019'] : ['#3A2017', '#171612']}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>SERVICE HEALTH</Text>
              <Text style={styles.serviceName}>{bundle.serviceHealth.serviceName}</Text>
            </View>
            <View
              style={[styles.statusBadge, isHealthy ? styles.healthyBadge : styles.degradedBadge]}
            >
              <Text
                style={[styles.statusText, isHealthy ? styles.healthyText : styles.degradedText]}
              >
                {bundle.serviceHealth.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.release}>Release {bundle.serviceHealth.version}</Text>
          <View style={styles.checksRow}>
            {Object.entries(bundle.serviceHealth.checks).map(([name, status]) => (
              <View key={name} style={styles.check}>
                <View
                  style={[
                    styles.checkDot,
                    { backgroundColor: status === 'healthy' ? colors.accent : colors.danger },
                  ]}
                />
                <Text style={styles.checkText}>{name}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={styles.messageBar}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.spark}>✦</Text>
          )}
          <Text style={styles.messageText}>{message}</Text>
        </View>

        <View style={styles.actionsRow}>
          <Pressable disabled={busy} onPress={() => void analyze()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{busy ? 'Working…' : 'Analyze locally'}</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => void breakDemo()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Inject regression</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>ACTIVE INCIDENT</Text>
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.incidentTitle}>{bundle.incident.title}</Text>
            <Text style={[styles.severity, isHealthy && styles.severityHealthy]}>
              {bundle.incident.severity.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.muted}>
            Started {timeLabel(bundle.incident.startedAt)} · {evidence.length} signals
          </Text>
        </View>

        {diagnosis ? (
          <>
            <Text style={styles.sectionLabel}>LOCAL DIAGNOSIS</Text>
            <View style={styles.diagnosisCard}>
              <View style={styles.confidenceRow}>
                <Text style={styles.diagnosisMode}>
                  {diagnosis.mode.replaceAll('-', ' ').toUpperCase()}
                </Text>
                <Text style={styles.confidence}>
                  {diagnosis.confidence.toUpperCase()} CONFIDENCE
                </Text>
              </View>
              <Text style={styles.diagnosisTitle}>
                {diagnosis.likelyCause ?? 'More evidence is required.'}
              </Text>
              <Text style={styles.body}>{diagnosis.summary}</Text>
              <Text style={styles.evidenceHint}>
                {diagnosis.evidenceIds.length} evidence items cited below
              </Text>
            </View>

            {diagnosis.proposedAction ? (
              <View style={styles.actionCard}>
                <Text style={styles.actionEyebrow}>SAFE RECOVERY PROPOSAL</Text>
                <Text style={styles.actionTitle}>
                  {diagnosis.proposedAction.type === 'TRIGGER_ROLLBACK_WORKFLOW'
                    ? `Rollback to ${diagnosis.proposedAction.parameters.targetRelease ?? 'last healthy release'}`
                    : 'Run a fresh health check'}
                </Text>
                <Text style={styles.body}>{diagnosis.proposedAction.reason}</Text>
                <Text style={styles.risk}>Risk · {diagnosis.proposedAction.risk}</Text>
                <Pressable onPress={confirmAction} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>Review and approve</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>INCIDENT TIMELINE</Text>
          <Pressable onPress={() => void shareBundle()}>
            <Text style={styles.shareText}>Share bundle ↗</Text>
          </Pressable>
        </View>
        <View style={styles.timeline}>
          {evidence.map((event, index) => (
            <View key={event.id} style={styles.timelineItem}>
              <View style={styles.timelineRail}>
                <View
                  style={[styles.timelineDot, cited.has(event.id) && styles.timelineDotCited]}
                />
                {index < evidence.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={[styles.eventCard, cited.has(event.id) && styles.eventCardCited]}>
                <View style={styles.eventMeta}>
                  <Text style={styles.source}>{sourceLabels[event.source]}</Text>
                  <Text style={styles.eventTime}>{timeLabel(event.timestamp)}</Text>
                </View>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventExcerpt}>{event.excerpt}</Text>
                {cited.has(event.id) ? <Text style={styles.cited}>CITED BY DIAGNOSIS</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <Pressable disabled={busy} onPress={() => void restoreDemo()} style={styles.resetButton}>
          <Text style={styles.resetText}>Reset demo service</Text>
        </Pressable>
        <Text style={styles.footer}>
          Private by default · Evidence before action · Human in control
        </Text>
      </ScrollView>
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
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  brand: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#252D2A',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },
  connectionPillLive: { backgroundColor: colors.accentDark },
  connectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
  connectionDotLive: { backgroundColor: colors.accent },
  connectionText: { color: colors.text, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  hero: { borderRadius: 24, padding: 20, borderWidth: 1, borderColor: colors.border },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  heroLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  serviceName: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 4 },
  statusBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  healthyBadge: { backgroundColor: '#173E2E' },
  degradedBadge: { backgroundColor: '#4A2B1B' },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  healthyText: { color: colors.accent },
  degradedText: { color: colors.warning },
  release: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  checksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 20 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkDot: { width: 7, height: 7, borderRadius: 4 },
  checkText: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize' },
  messageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  spark: { color: colors.accent, fontSize: 17 },
  messageText: { color: colors.textMuted, fontSize: 12, flex: 1 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.black, fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 17,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  incidentTitle: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '700' },
  severity: { color: colors.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  severityHealthy: { color: colors.accent },
  muted: { color: colors.textMuted, fontSize: 12, marginTop: 8 },
  diagnosisCard: {
    backgroundColor: '#10241D',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2A6049',
  },
  confidenceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  diagnosisMode: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  confidence: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  diagnosisTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 14,
  },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  evidenceHint: { color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 14 },
  actionCard: {
    backgroundColor: '#2A1E13',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#644426',
  },
  actionEyebrow: { color: colors.warning, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  actionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 10 },
  risk: { color: colors.warning, fontSize: 11, marginTop: 10 },
  actionButton: {
    backgroundColor: colors.warning,
    borderRadius: 13,
    padding: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  actionButtonText: { color: colors.black, fontSize: 13, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  shareText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  timeline: { gap: 0 },
  timelineItem: { flexDirection: 'row', gap: 10 },
  timelineRail: { width: 16, alignItems: 'center' },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.border,
    marginTop: 19,
    zIndex: 1,
  },
  timelineDotCited: { backgroundColor: colors.accent },
  timelineLine: { width: 1, flex: 1, backgroundColor: colors.border },
  eventCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  eventCardCited: { borderColor: '#337858' },
  eventMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  source: {
    color: colors.info,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  eventTime: { color: colors.textMuted, fontSize: 10 },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
  eventExcerpt: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  cited: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 10,
  },
  resetButton: { alignItems: 'center', padding: 12 },
  resetText: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'underline' },
  footer: { color: '#587067', fontSize: 10, textAlign: 'center', marginTop: 4 },
});
