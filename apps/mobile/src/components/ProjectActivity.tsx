import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import type { AuditEntry, IncidentBundle, TrackedProject } from '@pocketsre/contracts';
import { fetchProjectActions, fetchProjectIncident, getGatewayUrl } from '../api/gateway';
import { cacheIncident, readIncidentHistory, type SavedIncident } from '../storage/incidents';
import { Badge, Button, Card, Icon, ui } from './ui';
import { colors } from '../theme';

export function ProjectActivity({
  project,
  observed,
}: {
  project: TrackedProject;
  observed?: IncidentBundle;
}) {
  const [section, setSection] = useState<'Evidence' | 'Actions' | 'Saved'>('Evidence');
  const [bundle, setBundle] = useState<IncidentBundle | undefined>(observed);
  const [saved, setSaved] = useState<SavedIncident[]>([]);
  const [actions, setActions] = useState<AuditEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const gateway = getGatewayUrl();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const service = `github:${project.repository.id}`;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void (async () => {
      const errors: string[] = [];
      const results = await Promise.allSettled([
        (async () => {
          if (observed?.incident.serviceId === service) await cacheIncident(gateway, observed);
          return readIncidentHistory(gateway);
        })(),
        fetchProjectActions(project.id),
      ]);
      if (!active) return;
      const history = results[0];
      if (history.status === 'fulfilled') {
        const records = history.value.records.filter(
          (r) => r.source === 'gateway' && r.bundle.incident.serviceId === service,
        );
        setSaved(records);
        setBundle((old) => old ?? records[0]?.bundle);
        if (history.value.notice) errors.push(history.value.notice);
      } else errors.push('Saved activity could not be read.');
      const audit = results[1];
      if (audit.status === 'fulfilled')
        setActions(audit.value.filter((a) => a.serviceId === service));
      else
        errors.push(
          audit.reason instanceof Error ? audit.reason.message : 'Action history unavailable.',
        );
      setError(errors.join(' '));
      setBusy(false);
    })();
    return () => {
      active = false;
    };
  }, [project.id, service, observed, revision, gateway]);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      if (project.healthUrl) {
        const value = await fetchProjectIncident(project.id);
        if (!mounted.current) return;
        if (value.incident.serviceId !== service)
          throw new Error('This evidence belongs to another project.');
        await cacheIncident(gateway, value);
        if (!mounted.current) return;
        setBundle(value);
      }
      if (mounted.current) setRevision((v) => v + 1);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Could not refresh activity.');
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 16 }}>
      <Text style={ui.title}>Project activity</Text>
      <Text style={ui.body}>
        Evidence, approved actions and saved snapshots for {project.repository.fullName}.
      </Text>
      <View style={[ui.row, { flexWrap: 'wrap' }]}>
        {(['Evidence', 'Actions', 'Saved'] as const).map((label) => (
          <Button
            key={label}
            label={label}
            variant={section === label ? 'primary' : 'ghost'}
            onPress={() => setSection(label)}
          />
        ))}
      </View>
      <Button
        label="Refresh activity"
        icon="refresh"
        variant="outline"
        disabled={busy}
        onPress={() => void refresh()}
      />
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {error}
        </Text>
      ) : null}
      {section === 'Evidence' ? (
        bundle ? (
          <>
            <Badge>{bundle.serviceHealth.status}</Badge>
            <Text style={ui.title}>{bundle.incident.title}</Text>
            <Text style={ui.label}>
              Snapshot from {new Date(bundle.generatedAt).toLocaleString()}
            </Text>
            {[...bundle.evidence]
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
              .map((event) => (
                <View
                  key={event.id}
                  style={{
                    gap: 8,
                    paddingVertical: 12,
                    borderTopWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={event.title}
                    accessibilityState={{ expanded: expanded === event.id }}
                    onPress={() => setExpanded(expanded === event.id ? null : event.id)}
                    style={ui.between}
                  >
                    <Text style={[ui.title, { flex: 1 }]}>{event.title}</Text>
                    <Icon name="chevron" size={14} />
                  </Pressable>
                  <Text style={ui.label}>
                    {event.source} · {new Date(event.timestamp).toLocaleString()}
                  </Text>
                  <Text
                    selectable
                    numberOfLines={expanded === event.id ? undefined : 3}
                    style={ui.body}
                  >
                    {event.excerpt}
                  </Text>
                  {expanded === event.id ? (
                    <>
                      <Text selectable style={ui.mono}>
                        Evidence ID: {event.id}
                      </Text>
                      {Object.entries(event.metadata).map(([key, value]) => (
                        <Text selectable key={key} style={ui.mono}>
                          {key}: {String(value)}
                        </Text>
                      ))}
                    </>
                  ) : null}
                </View>
              ))}
            {!bundle.evidence.length ? (
              <Text style={ui.body}>This snapshot has no collected evidence.</Text>
            ) : null}
          </>
        ) : (
          <Text style={ui.body}>
            {project.healthUrl
              ? 'Refresh activity to collect this project’s latest health and deployment evidence.'
              : 'Add a health endpoint in Health to start collecting incident evidence.'}
          </Text>
        )
      ) : null}
      {section === 'Actions' ? (
        actions.length ? (
          actions.map((entry) => (
            <Card key={entry.requestId}>
              <Badge tone={entry.result.status === 'succeeded' ? 'success' : 'neutral'}>
                {entry.result.status}
              </Badge>
              <Text style={ui.title}>{entry.action.replaceAll('_', ' ').toLowerCase()}</Text>
              <Text style={ui.body}>{entry.result.message}</Text>
              <Text style={ui.label}>{new Date(entry.result.startedAt).toLocaleString()}</Text>
              {entry.result.pullRequestUrl ? (
                <Button
                  label="Open pull request"
                  variant="outline"
                  onPress={() => {
                    void Linking.openURL(entry.result.pullRequestUrl!).catch(() =>
                      setError('Could not open the pull request.'),
                    );
                  }}
                />
              ) : null}
            </Card>
          ))
        ) : (
          <Text style={ui.body}>No approved actions recorded for this project.</Text>
        )
      ) : null}
      {section === 'Saved' ? (
        <>
          <Text style={ui.label}>
            Saved on this phone. The newest 5 snapshots per incident are kept, within the shared
            30-snapshot server limit.
          </Text>
          {saved.map((record) => (
            <Card key={record.id}>
              <Text style={ui.title}>{record.bundle.incident.title}</Text>
              <Text style={ui.label}>
                {new Date(record.bundle.generatedAt).toLocaleString()} ·{' '}
                {record.bundle.evidence.length} evidence items
              </Text>
              <Button
                label="View saved evidence"
                variant="outline"
                onPress={() => {
                  setBundle(record.bundle);
                  setSection('Evidence');
                }}
              />
            </Card>
          ))}
          {!saved.length ? (
            <Text style={ui.body}>
              No saved snapshots for this project yet. Refresh activity to save one.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
