import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  IncidentBundleSchema,
  type AuditEntry,
  type ApprovedActionRequest,
  type FixContext,
} from '@pocketsre/contracts';
import { mergeInvestigation, sanitizeBundle } from '@pocketsre/incident-engine';
import {
  configureGateway,
  fetchCurrentIncident,
  fetchAudit,
  fetchGatewayMode,
  executeApprovedAction,
  injectDemoRegression,
  resetDemo,
} from '../api/gateway';
import { createTriageEngine, type ChatCompletion } from '../ai/LocalTriageEngine';
import { createSampleIncident } from '../data/sampleIncident';
import { loadConnection, saveConnection, type ConnectionSettings } from '../settings/connection';
import {
  cacheIncident,
  cacheOfflineIncident,
  cacheDiagnosis,
  readIncidentHistory,
  clearIncidentCache,
  validatedDiagnosis,
  snapshotId,
  type SavedIncident,
  type SavedDiagnosis,
  type SnapshotSource,
} from '../storage/incidents';
import { pickJsonFile, shareIncidentFile } from '../officekit/bundle';

export function useIncident(modelPath?: string) {
  const [bundle, setBundle] = useState(createSampleIncident);
  const [analysis, setAnalysis] = useState<SavedDiagnosis | null>(null);
  const diagnosis = analysis?.value ?? null;
  const [savedSnapshot, setSavedSnapshot] = useState<SavedIncident | null>(null);
  const [source, setSource] = useState<SnapshotSource>('sample');
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [connection, setConnection] = useState<'live' | 'cached' | 'sample' | 'imported'>('sample');
  const [mode, setMode] = useState<'demo' | 'live' | null>(null);
  const [message, setMessage] = useState('Loading saved connection…');
  const [settings, setSettings] = useState<ConnectionSettings>({ url: '', token: '' });
  const [history, setHistory] = useState<SavedIncident[]>([]);
  const [totalSaved, setTotalSaved] = useState(0);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const lock = useRef(false);
  const ready = useRef(false);
  const mounted = useRef(true);
  const viewEpoch = useRef(0);
  const engine = useMemo(() => createTriageEngine(modelPath), [modelPath]);

  async function loadHistory(url: string) {
    const result = await readIncidentHistory(url);
    if (mounted.current) {
      setHistory(result.records);
      setTotalSaved(result.total);
      setHistoryNotice(result.notice);
    }
    return result.records;
  }
  function openSaved(item: SavedIncident) {
    viewEpoch.current++;
    setBundle(item.bundle);
    setSavedSnapshot(item);
    setSource(item.source);
    setCapturedAt(item.capturedAt);
    setAnalysis(item.diagnosis);
    setConnection(
      item.source === 'gateway' ? 'cached' : item.source === 'sample' ? 'sample' : 'imported',
    );
    setMode(null);
    setAudit([]);
  }
  async function refreshInternal(url: string) {
    viewEpoch.current++;
    const [raw, gatewayMode] = await Promise.all([fetchCurrentIncident(), fetchGatewayMode()]);
    const current = sanitizeBundle(raw);
    if (!mounted.current) return current;
    setBundle(current);
    setAnalysis(null);
    setSavedSnapshot(null);
    setCapturedAt(new Date().toISOString());
    setSource('gateway');
    setConnection('live');
    setMode(gatewayMode);
    try {
      const saved = await cacheIncident(url, current);
      if (!mounted.current) return current;
      setBundle(saved.bundle);
      setSavedSnapshot(saved);
      setCapturedAt(saved.capturedAt);
      setAnalysis(saved.diagnosis);
      await loadHistory(url);
    } catch {
      if (mounted.current)
        setHistoryNotice('Connected, but this evidence could not be saved for offline use.');
    }
    try {
      const entries = await fetchAudit();
      if (mounted.current) setAudit(entries);
    } catch {
      if (mounted.current) setAudit([]);
    }
    return current;
  }
  async function run(work: () => Promise<void>) {
    if (lock.current || !ready.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation could not be completed.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let disposed = false;
    mounted.current = true;
    void (async () => {
      try {
        const saved = await loadConnection();
        if (disposed) return;
        setSettings(saved);
        configureGateway(saved);
        const records = await loadHistory(saved.url);
        if (disposed) return;
        if (records[0]) {
          openSaved(records[0]);
        }
        try {
          await refreshInternal(saved.url);
          if (!disposed) setMessage('Connected. Evidence is ready for local analysis.');
        } catch {
          if (!disposed)
            setMessage(
              records.length
                ? 'Offline. Showing your saved incident; live health may have changed.'
                : 'Gateway unavailable. Showing a labelled sample incident.',
            );
        }
      } catch {
        if (!disposed)
          setMessage('Could not load the saved connection. Open Connections to configure it.');
      } finally {
        if (!disposed) {
          ready.current = true;
          setBusy(false);
        }
      }
    })();
    return () => {
      disposed = true;
      mounted.current = false;
      ready.current = false;
      viewEpoch.current++;
      void engine.release?.().catch(() => {});
    };
  }, [engine]);

  const refresh = () =>
    run(async () => {
      try {
        await refreshInternal(settings.url);
        setMessage('Latest health and evidence loaded.');
      } catch (error) {
        setConnection((previous) => (previous === 'live' ? 'cached' : previous));
        setMessage(
          `${error instanceof Error ? error.message : 'Gateway unavailable.'} Live health may have changed.`,
        );
      }
    });
  const analyze = () =>
    run(async () => {
      viewEpoch.current++;
      setMessage('Analyzing locally…');
      setAnalysis(null);
      const result = validatedDiagnosis(await engine.analyze(bundle), bundle);
      if (!mounted.current) return;
      const id =
        savedSnapshot?.id ??
        (await snapshotId(source, source === 'gateway' ? settings.url : null, bundle));
      setAnalysis({ snapshotId: id, analyzedAt: new Date().toISOString(), value: result });
      try {
        const snapshot =
          savedSnapshot ??
          (source === 'gateway'
            ? await cacheIncident(settings.url, bundle)
            : await cacheOfflineIncident(bundle, source));
        const saved = await cacheDiagnosis(snapshot, result);
        if (!mounted.current) return;
        setSavedSnapshot(saved);
        setCapturedAt(saved.capturedAt);
        setAnalysis(saved.diagnosis);
        await loadHistory(settings.url);
        setMessage(`Analysis saved with this evidence · ${engine.modeLabel}`);
      } catch {
        setHistoryNotice(
          'Analysis is available for this session only. It could not be saved on this phone.',
        );
        setMessage(`Analysis complete · ${engine.modeLabel}`);
      }
    });
  const updateConnection = (next: ConnectionSettings) =>
    run(async () => {
      const saved = await saveConnection(next);
      viewEpoch.current++;
      configureGateway(saved);
      setSettings(saved);
      setAnalysis(null);
      setSavedSnapshot(null);
      setCapturedAt(null);
      setAudit([]);
      setMode(null);
      const records = await loadHistory(saved.url);
      if (records[0]) openSaved(records[0]);
      else {
        setBundle(createSampleIncident());
        setConnection('sample');
        setSource('sample');
      }
      try {
        await refreshInternal(saved.url);
        setMessage('Connection saved and verified.');
      } catch {
        setMessage('Connection saved. Gateway unavailable; check URL and token.');
      }
    });
  const breakDemo = () =>
    run(async () => {
      if (mode !== 'demo' || connection !== 'live')
        throw new Error('Connect to the demo gateway first.');
      await injectDemoRegression();
      await refreshInternal(settings.url);
      setMessage('Demo regression injected. Checkout requests now fail.');
    });
  const restoreDemo = () =>
    run(async () => {
      if (mode !== 'demo' || connection !== 'live')
        throw new Error('Connect to the demo gateway first.');
      await resetDemo();
      await refreshInternal(settings.url);
      setMessage('Demo reset to a healthy release.');
    });
  const canExecute =
    connection === 'live' &&
    !busy &&
    !!diagnosis?.proposedAction &&
    (diagnosis.proposedAction.type === 'RUN_HEALTH_CHECK' ||
      (mode === 'demo' && !!bundle.serviceHealth.version));
  function confirmAction() {
    const proposal = diagnosis?.proposedAction;
    if (!canExecute || !proposal) return;
    const epoch = viewEpoch.current;
    // Capture exactly the proposal displayed by this confirmation, not mutable UI state.
    const approved: ApprovedActionRequest = {
      requestId: randomUUID(),
      expectedVersion: bundle.serviceHealth.version,
      incidentId: bundle.incident.id,
      serviceId: bundle.incident.serviceId,
      action: proposal.type,
      target: proposal.target,
      parameters: proposal.parameters,
      approvedAt: new Date().toISOString(),
    };
    Alert.alert(
      'Approve recovery action',
      `${proposal.reason}\n\nService: ${proposal.target}\nCurrent release: ${approved.expectedVersion ?? 'Unknown'}\nTarget release: ${proposal.parameters.targetRelease ?? 'unchanged'}\nRisk: ${proposal.risk}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () =>
            void run(async () => {
              if (epoch !== viewEpoch.current)
                throw new Error(
                  'Evidence or connection changed. Review the current analysis before approving.',
                );
              viewEpoch.current++;
              setAnalysis(null);
              let actionMessage =
                'Action outcome uncertain. Check history and health before retrying.';
              try {
                const result = await executeApprovedAction({
                  ...approved,
                  approvedAt: new Date().toISOString(),
                });
                actionMessage = result.message;
              } finally {
                try {
                  await refreshInternal(settings.url);
                } catch {
                  setConnection('cached');
                }
                setMessage(actionMessage);
              }
            }),
        },
      ],
    );
  }
  const shareBundle = () =>
    run(async () => {
      await shareIncidentFile(bundle);
      setMessage('Sanitized incident file prepared for transfer.');
    });
  const importFile = () =>
    run(async () => {
      const raw = await pickJsonFile();
      if (raw === null) return;
      const incident = IncidentBundleSchema.safeParse(raw);
      const next = incident.success
        ? sanitizeBundle(incident.data)
        : mergeInvestigation(bundle, raw);
      setBundle(next);
      viewEpoch.current++;
      setAnalysis(null);
      setSavedSnapshot(null);
      setCapturedAt(new Date().toISOString());
      const importedSource = incident.success ? 'imported-incident' : 'imported-investigation';
      setSource(importedSource);
      setConnection('imported');
      setMode(null);
      setAudit([]);
      // Import provenance is never promoted to a trusted live gateway snapshot.
      try {
        const saved = await cacheOfflineIncident(next, importedSource);
        setSavedSnapshot(saved);
        setBundle(saved.bundle);
        setCapturedAt(saved.capturedAt);
        setAnalysis(saved.diagnosis);
        await loadHistory(settings.url);
      } catch {
        setHistoryNotice(
          'Imported evidence is available for this session only. It could not be saved on this phone.',
        );
      }
      setMessage(
        incident.success
          ? 'Incident imported for offline analysis.'
          : 'Investigation merged. Analyze again to include the new evidence.',
      );
    });
  function selectHistory(item: SavedIncident) {
    if (busy || lock.current || !ready.current) return;
    openSaved(item);
    setMessage(
      item.diagnosis
        ? 'Reopened saved analysis with its original evidence. Refresh for the current gateway incident.'
        : 'Viewing saved evidence. Refresh for the current gateway incident.',
    );
  }
  const clearCache = () =>
    run(async () => {
      await clearIncidentCache();
      viewEpoch.current++;
      setHistory([]);
      setTotalSaved(0);
      setHistoryNotice(null);
      setAnalysis(null);
      setSavedSnapshot(null);
      if (connection !== 'live') {
        setBundle(createSampleIncident());
        setConnection('sample');
        setSource('sample');
        setCapturedAt(null);
        setAudit([]);
        setMode(null);
      }
      setMessage(
        'All saved snapshots, imports and analyses cleared from this phone. Refresh, import or analyze to save again.',
      );
    });
  async function proposeFix(context: FixContext) {
    if (lock.current || !ready.current)
      throw new Error('Wait for the current operation to finish.');
    if (!engine.proposeFix)
      throw new Error('Select a GGUF model in Settings before drafting a code fix.');
    lock.current = true;
    setBusy(true);
    try {
      return await engine.proposeFix(context);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const chat: ChatCompletion = async (messages, onToken, signal) => {
    if (lock.current || !ready.current)
      throw new Error('Wait for the current operation to finish.');
    if (!engine.chat) throw new Error('Import a GGUF model in Settings to use temporary chat.');
    lock.current = true;
    setBusy(true);
    try {
      return await engine.chat(messages, onToken, signal);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return {
    chat,
    proposeFix,
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
    analyzedAt: analysis?.analyzedAt ?? null,
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
  };
}
