import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { TrackedProject } from '@pocketsre/contracts';
import {
  bindDeployment,
  connectVercel,
  disconnectVercel,
  fetchDeploymentProjects,
  fetchMonitorStatus,
  fetchVercelConnection,
  setProjectMonitoring,
} from '../api/gateway';
import { enableProjectNotifications, disableProjectNotifications } from '../notifications';
import { Badge, Button, ui } from './ui';
import { colors } from '../theme';

export function ProjectOperations({
  project,
  onChange,
  section,
  onBusyChange,
}: {
  project: TrackedProject;
  section?: 'deployment' | 'monitoring';
  onBusyChange?: (busy: boolean) => void;
  onChange: (project: TrackedProject) => void;
}) {
  const [provider, setProvider] = useState<Awaited<
    ReturnType<typeof fetchVercelConnection>
  > | null>(null);
  const [monitor, setMonitor] = useState<Awaited<ReturnType<typeof fetchMonitorStatus>> | null>(
    null,
  );
  const [candidates, setCandidates] = useState<Awaited<
    ReturnType<typeof fetchDeploymentProjects>
  > | null>(null);
  const [token, setToken] = useState('');
  const [team, setTeam] = useState('');
  const [target, setTarget] = useState<'production' | 'preview'>(
    project.deployment?.target ?? 'production',
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.allSettled([fetchVercelConnection(), fetchMonitorStatus(project.id)]).then(
      ([provider, monitor]) => {
        if (!active) return;
        if (provider.status === 'fulfilled') setProvider(provider.value);
        if (monitor.status === 'fulfilled') setMonitor(monitor.value);
      },
    );
    return () => {
      active = false;
    };
  }, [project.id]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setNotice('');
    try {
      await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update project operations.');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  const input = {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
  };
  return (
    <View style={{ gap: 14 }}>
      {section !== 'monitoring' ? (
        <>
          <Text style={ui.title}>Deployment and logs</Text>
          <Badge>
            {project.deployment
              ? `Vercel · ${project.deployment.name} · ${project.deployment.target}`
              : 'No deployment linked'}
          </Badge>
          <Text style={ui.body}>
            Connect Vercel, confirm the matching project and environment, then refresh project
            health to collect build and runtime log evidence. Access and log retention depend on the
            provider.
          </Text>
          {!provider?.connected ? (
            <>
              <TextInput
                accessibilityLabel="Vercel access token"
                placeholder="Vercel access token"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={token}
                onChangeText={setToken}
                style={input}
                editable={!busy}
              />
              <TextInput
                accessibilityLabel="Vercel team ID"
                placeholder="Team ID (optional)"
                autoCapitalize="none"
                value={team}
                onChangeText={setTeam}
                style={input}
                editable={!busy}
              />
              <Text style={ui.label}>
                Use a token scoped to the intended project/team. It stays in gateway memory and must
                be reconnected after a restart unless configured by its administrator.
              </Text>
              <Button
                label="Connect Vercel"
                disabled={busy || !token.trim()}
                onPress={() =>
                  void run(async () => {
                    const secret = token;
                    setToken('');
                    setProvider(await connectVercel(secret.trim(), team.trim()));
                  })
                }
              />
            </>
          ) : (
            <>
              <Button
                label="Find Vercel projects"
                disabled={busy}
                onPress={() =>
                  void run(async () => setCandidates(await fetchDeploymentProjects(project.id)))
                }
              />
              <Button
                label="Disconnect Vercel"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    setProvider(await disconnectVercel());
                    setCandidates(null);
                  })
                }
              />
            </>
          )}
          {candidates ? (
            <>
              <Button
                label={`Environment: ${target}`}
                variant="outline"
                disabled={busy}
                onPress={() => setTarget(target === 'production' ? 'preview' : 'production')}
              />
              {candidates.projects.map((candidate) => (
                <Button
                  key={candidate.id}
                  label={`${candidate.suggested ? 'Suggested: ' : ''}${candidate.name}`}
                  variant="outline"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      'Link this deployment?',
                      `${project.repository.fullName}\nVercel: ${candidate.name}\nEnvironment: ${target}\nOnly deployment status and logs are read.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Link project',
                          onPress: () =>
                            void run(async () => {
                              onChange(await bindDeployment(project.id, candidate.id, target));
                              setCandidates(null);
                            }),
                        },
                      ],
                    )
                  }
                />
              ))}
              {!candidates.projects.length ? (
                <Text style={ui.body}>
                  No projects returned. Check the token and team, or load another page.
                </Text>
              ) : null}
              {candidates.next ? (
                <Button
                  label="More Vercel projects"
                  disabled={busy}
                  onPress={() =>
                    void run(async () =>
                      setCandidates(await fetchDeploymentProjects(project.id, candidates.next!)),
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
          {project.deployment ? (
            <Button
              label="Unlink deployment"
              variant="ghost"
              disabled={busy}
              onPress={() =>
                void run(async () => onChange(await bindDeployment(project.id, null, target)))
              }
            />
          ) : null}
        </>
      ) : null}
      {section !== 'deployment' ? (
        <>
          <Text style={ui.title}>Monitoring and alerts</Text>
          <Text style={ui.body}>
            The gateway checks enabled projects while the phone is closed. Keep the gateway running.
            Two consecutive failures trigger an outage; two healthy checks trigger recovery. Unknown
            results do not establish recovery.
          </Text>
          <Badge>
            {project.monitoring ? 'Background monitoring enabled' : 'Monitoring paused'}
          </Badge>
          <Text style={ui.label}>
            {monitor?.lastCheckedAt
              ? `Last check: ${new Date(monitor.lastCheckedAt).toLocaleString()} · ${monitor.status}`
              : 'No background check recorded yet.'}
          </Text>
          {monitor?.error ? <Text style={ui.body}>{monitor.error}</Text> : null}
          <Button
            label={project.monitoring ? 'Pause monitoring' : 'Enable background monitoring'}
            disabled={busy || !project.healthUrl}
            onPress={() =>
              void run(async () => {
                onChange(await setProjectMonitoring(project.id, !project.monitoring));
                setMonitor(await fetchMonitorStatus(project.id));
              })
            }
          />
          <Button
            label="Refresh monitoring status"
            variant="outline"
            disabled={busy}
            onPress={() => void run(async () => setMonitor(await fetchMonitorStatus(project.id)))}
          />
          <Button
            label="Enable alerts on this phone"
            disabled={busy || !project.monitoring}
            onPress={() =>
              void run(async () => {
                await enableProjectNotifications(project.id);
                setNotice('This phone is subscribed to outage and recovery alerts.');
              })
            }
          />
          <Button
            label="Disable alerts on this phone"
            variant="ghost"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await disableProjectNotifications(project.id);
                setNotice('Alerts disabled for this project on this phone.');
              })
            }
          />
        </>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
