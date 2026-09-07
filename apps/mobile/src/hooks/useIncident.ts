import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  IncidentBundleSchema,
  type IncidentBundle,
  type Diagnosis,
  type AuditEntry,
  type ApprovedActionRequest,
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
import { createTriageEngine } from '../ai/LocalTriageEngine';
import { createSampleIncident } from '../data/sampleIncident';
import { loadConnection, saveConnection, type ConnectionSettings } from '../settings/connection';
import { cacheIncident, readIncidentHistory, clearIncidentCache } from '../storage/incidents';
import { pickJsonFile, shareIncidentFile } from '../officekit/bundle';

export function useIncident() {
  const [bundle, setBundle] = useState(createSampleIncident);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(true);
  const [connection, setConnection] = useState<'live' | 'cached' | 'sample' | 'imported'>('sample');
  const [mode, setMode] = useState<'demo' | 'live' | null>(null);
  const [message, setMessage] = useState('Loading saved connection…');
  const [settings, setSettings] = useState<ConnectionSettings>({ url: '', token: '' });
  const [history, setHistory] = useState<IncidentBundle[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const lock = useRef(false);
  const ready = useRef(false);
  const engine = useMemo(createTriageEngine, []);

  async function persist(current: IncidentBundle, url: string) {
    await cacheIncident(url, current);
    setHistory(await readIncidentHistory(url));
  }
  async function refreshInternal(url: string) {
    const [current, gatewayMode] = await Promise.all([fetchCurrentIncident(), fetchGatewayMode()]);
    setBundle(current);
    setDiagnosis(null);
    setConnection('live');
    setMode(gatewayMode);
    try {
      await persist(current, url);
    } catch {
      setMessage('Connected, but the offline cache could not be saved.');
    }
    try {
      setAudit(await fetchAudit());
    } catch {
      setAudit([]);
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
    void (async () => {
      try {
        const saved = await loadConnection();
        if (disposed) return;
        setSettings(saved);
        configureGateway(saved);
        const records = await readIncidentHistory(saved.url);
        if (disposed) return;
        setHistory(records);
        if (records[0]) {
          setBundle(records[0]);
          setConnection('cached');
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
      ready.current = false;
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
      setMessage('Analyzing locally…');
      const result = await engine.analyze(bundle);
      setDiagnosis(result);
      setMessage(`Analysis complete · ${engine.modeLabel}`);
    });
  const updateConnection = (next: ConnectionSettings) =>
    run(async () => {
      const saved = await saveConnection(next);
      configureGateway(saved);
      setSettings(saved);
      setDiagnosis(null);
      setAudit([]);
      setMode(null);
      const records = await readIncidentHistory(saved.url);
      setHistory(records);
      setBundle(records[0] ?? createSampleIncident());
      setConnection(records[0] ? 'cached' : 'sample');
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
    (mode === 'demo' || diagnosis.proposedAction.type === 'RUN_HEALTH_CHECK');
  function confirmAction() {
    const proposal = diagnosis?.proposedAction;
    if (!canExecute || !proposal) return;
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
      `${proposal.reason}\n\nService: ${proposal.target}\nCurrent release: ${approved.expectedVersion}\nTarget release: ${proposal.parameters.targetRelease ?? 'unchanged'}\nRisk: ${proposal.risk}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () =>
            void run(async () => {
              setDiagnosis(null);
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
      setDiagnosis(null);
      setConnection('imported');
      // Imported data is intentionally not associated with a trusted live gateway cache.
      setMessage(
        incident.success
          ? 'Incident imported for offline analysis.'
          : 'Investigation merged. Analyze again to include the new evidence.',
      );
    });
  function selectHistory(item: IncidentBundle) {
    if (busy) return;
    setBundle(item);
    setDiagnosis(null);
    setConnection('cached');
    setMessage('Viewing saved evidence. Refresh to return to the current incident.');
  }
  const clearCache = () =>
    run(async () => {
      clearIncidentCache();
      setHistory([]);
      setMessage('Saved incident history cleared from this phone.');
    });
  return {
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
  };
}
