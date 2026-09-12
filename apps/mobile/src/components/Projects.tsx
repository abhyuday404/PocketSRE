import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Text, TextInput, View } from 'react-native';
import type {
  GitHubDevice,
  GitHubRepository,
  IncidentBundle,
  TrackedProject,
} from '@pocketsre/contracts';
import {
  disconnectGitHub,
  fetchGitHubConnection,
  fetchGitHubRepositories,
  fetchProjectIncident,
  fetchProjects,
  pollGitHubSignIn,
  removeProject,
  saveProjectHealth,
  startGitHubSignIn,
  trackProject,
} from '../api/gateway';
import { Badge, Button, Card, ui } from './ui';
import { colors } from '../theme';
import { ProjectOperations } from './ProjectOperations';

const inputStyle = {
  color: colors.text,
  backgroundColor: colors.muted,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 12,
  padding: 14,
  fontSize: 15,
};

export function Projects({
  onOpenAgent,
  initialProjectId,
}: {
  onOpenAgent?: (project: TrackedProject) => void;
  initialProjectId?: string | null;
}) {
  const [connection, setConnection] = useState<Awaited<
    ReturnType<typeof fetchGitHubConnection>
  > | null>(null);
  const [projects, setProjects] = useState<TrackedProject[]>([]);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [browsed, setBrowsed] = useState(false);
  const [search, setSearch] = useState('');
  const [device, setDevice] = useState<GitHubDevice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null);
  const [healthUrl, setHealthUrl] = useState('');
  const [observations, setObservations] = useState<Record<string, IncidentBundle>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const lock = useRef(false);
  const selected = projects.find((project) => project.id === selectedId);

  async function load() {
    const [statusResult, savedResult] = await Promise.allSettled([
      fetchGitHubConnection(),
      fetchProjects(),
    ]);
    if (!mounted.current) return;
    if (savedResult.status === 'fulfilled') {
      setProjects(savedResult.value);
      if (initialProjectId)
        setHealthUrl(savedResult.value.find((p) => p.id === initialProjectId)?.healthUrl ?? '');
      setObservations({});
    }
    if (statusResult.status === 'fulfilled') {
      setConnection(statusResult.value);
      if (!statusResult.value.connected) {
        setRepositories([]);
        setNextPage(null);
        setBrowsed(false);
      }
    }
    if (statusResult.status === 'rejected') throw statusResult.reason;
    if (savedResult.status === 'rejected') throw savedResult.reason;
  }
  async function run(work: () => Promise<void>) {
    if (lock.current || !mounted.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not update projects.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void run(load);
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!device) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (Date.now() >= Date.parse(device!.expiresAt)) {
          if (active) {
            setDevice(null);
            setMessage('The sign-in code expired. Start GitHub sign-in again.');
          }
          return;
        }
        const result = await pollGitHubSignIn(device!.id);
        if (!active) return;
        if (result.status === 'pending')
          timer = setTimeout(() => void poll(), result.interval * 1000);
        else {
          setDevice(null);
          if (result.status === 'connected') {
            await run(async () => {
              await load();
              if (mounted.current) setMessage('GitHub connected. Choose repositories to track.');
            });
          } else
            setMessage(
              result.status === 'denied'
                ? 'GitHub sign-in was declined.'
                : 'The sign-in code expired. Try again.',
            );
        }
      } catch {
        if (active) setMessage('Could not check GitHub sign-in. Reopen sign-in to retry.');
      }
    }
    timer = setTimeout(() => void poll(), device.interval * 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [device]);

  async function browse(page = 1) {
    const result = await fetchGitHubRepositories(page);
    if (!mounted.current) return;
    setRepositories((previous) => [
      ...new Map(
        [...(page === 1 ? [] : previous), ...result.repositories].map((repo) => [repo.id, repo]),
      ).values(),
    ]);
    setNextPage(result.nextPage);
    setBrowsed(true);
  }
  const observed = selected ? observations[selected.id] : undefined;
  return (
    <>
      {!selected ? (
        <Card>
          <Text style={ui.title}>Your projects</Text>
          <Text style={ui.body}>
            Choose GitHub repositories and connect their live health endpoints. Refresh a project
            for evidence, or enable background monitoring and phone alerts.
          </Text>
          <Badge>
            {connection?.connected
              ? `GitHub · ${connection.account ?? 'Connected'}`
              : 'GitHub not connected'}
          </Badge>
          {connection && !connection.enabled ? (
            <Text style={ui.body}>
              GitHub projects are not configured on this gateway yet. Your existing demo and
              incident connection remain available.
            </Text>
          ) : null}
          {connection?.canSignIn && !connection.connected ? (
            <Button
              label={device ? 'Reopen GitHub sign-in' : 'Connect GitHub'}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const value = await startGitHubSignIn();
                  if (mounted.current) setDevice(value);
                  if (mounted.current) await Linking.openURL(value.verificationUrl);
                })
              }
            />
          ) : null}
          {device ? (
            <>
              <Text style={ui.body}>
                Enter this code on GitHub. Install the PocketSRE GitHub App on the repositories you
                want to make available.
              </Text>
              <Text selectable style={ui.mono}>
                {device.userCode}
              </Text>
              <Text style={ui.label}>
                Waiting for GitHub approval. This code expires at{' '}
                {new Date(device.expiresAt).toLocaleTimeString()}.
              </Text>
              <Button
                label="Cancel sign-in"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await disconnectGitHub();
                    if (mounted.current) setDevice(null);
                    await load();
                  })
                }
              />
            </>
          ) : null}
          {connection?.connected ? (
            <>
              <Button
                label="Choose repositories"
                disabled={busy}
                onPress={() => void run(() => browse())}
              />
              <Button
                label="Disconnect GitHub"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    'Disconnect GitHub?',
                    'This removes the gateway’s current GitHub session. Saved project settings remain. It does not revoke the GitHub App installation.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Disconnect',
                        onPress: () =>
                          void run(async () => {
                            await disconnectGitHub();
                            if (mounted.current) setDevice(null);
                            await load();
                          }),
                      },
                    ],
                  )
                }
              />
            </>
          ) : null}
          {connection?.installationUrl ? (
            <Button
              label="Manage repository access on GitHub"
              variant="outline"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await Linking.openURL(connection.installationUrl!);
                })
              }
            />
          ) : null}
          {connection?.expiresAt ? (
            <Text style={ui.label}>
              GitHub session expires {new Date(connection.expiresAt).toLocaleString()}. Reconnect
              after expiry or a gateway restart.
            </Text>
          ) : null}
          {browsed && !repositories.length ? (
            <Text style={ui.body}>
              No repositories are available to this connection. Check the GitHub App installation
              and repository permissions, then choose repositories again.
            </Text>
          ) : null}
          <Button
            label="Refresh projects"
            variant="outline"
            disabled={busy}
            onPress={() => void run(load)}
          />
        </Card>
      ) : null}
      {repositories.length && !selected ? (
        <Card>
          <Text style={ui.title}>Available repositories</Text>
          <TextInput
            accessibilityLabel="Filter repositories"
            placeholder="Filter loaded repositories…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            value={search}
            onChangeText={setSearch}
            style={inputStyle}
          />
          {repositories
            .filter((repo) => repo.fullName.toLowerCase().includes(search.toLowerCase()))
            .map((repo) => {
              const tracked = projects.some((p) => p.repository.id === repo.id);
              return (
                <View key={repo.id} style={{ gap: 6 }}>
                  <Text style={ui.title}>{repo.fullName}</Text>
                  <Text style={ui.label}>
                    {repo.private ? 'Private' : 'Public'} · {repo.defaultBranch}
                  </Text>
                  <Button
                    label={tracked ? `Tracking ${repo.fullName}` : `Track ${repo.fullName}`}
                    variant="outline"
                    disabled={busy || tracked}
                    onPress={() =>
                      void run(async () => {
                        await trackProject(repo.fullName);
                        await load();
                      })
                    }
                  />
                </View>
              );
            })}
          {nextPage ? (
            <Button
              label="Load more repositories"
              variant="ghost"
              disabled={busy}
              onPress={() => void run(() => browse(nextPage))}
            />
          ) : null}
        </Card>
      ) : null}
      {!projects.length ? (
        <Card>
          <Text style={ui.title}>No projects selected</Text>
          <Text style={ui.body}>
            Connect GitHub, then choose the repositories you want to track. A repository needs a
            live endpoint before its availability can be checked.
          </Text>
        </Card>
      ) : null}
      {!selected
        ? projects.map((project) => (
            <Card key={project.id}>
              <Text style={ui.title}>{project.repository.fullName}</Text>
              <Badge
                tone={
                  observations[project.id]?.serviceHealth.status === 'down'
                    ? 'danger'
                    : observations[project.id]?.serviceHealth.status === 'healthy'
                      ? 'success'
                      : 'neutral'
                }
              >
                {observations[project.id]?.serviceHealth.status ??
                  (project.healthUrl ? 'Not checked' : 'Needs health endpoint')}
              </Badge>
              {observations[project.id] ? (
                <Text style={ui.label}>
                  HTTP availability · checked{' '}
                  {new Date(observations[project.id]!.serviceHealth.checkedAt).toLocaleString()}
                </Text>
              ) : null}
              <Button
                label={`Open ${project.repository.fullName}`}
                variant="outline"
                disabled={busy}
                onPress={() => {
                  setSelectedId(project.id);
                  setHealthUrl(project.healthUrl ?? '');
                  setMessage('');
                }}
              />
            </Card>
          ))
        : null}
      {selected ? (
        <Card>
          <Button
            label="Back to projects"
            variant="ghost"
            disabled={busy}
            onPress={() => setSelectedId(null)}
          />
          <Text style={ui.title}>{selected.repository.fullName} · Health</Text>
          {onOpenAgent ? (
            <Button
              label="Chat with this project's agent"
              disabled={busy}
              onPress={() => onOpenAgent(selected)}
            />
          ) : null}
          <Text style={ui.body}>
            Use a dedicated health endpoint. HTTP 2xx means reachable, HTTP 5xx means down; other
            responses or connection failures mean unknown. This does not verify business behavior.
          </Text>
          <TextInput
            accessibilityLabel="Project health URL"
            placeholder="https://your-app.example/health"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={healthUrl}
            onChangeText={setHealthUrl}
            editable={!busy}
            style={inputStyle}
          />
          <Button
            label="Save health endpoint"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await saveProjectHealth(selected.id, healthUrl.trim() || null);
                if (mounted.current) {
                  setObservations((previous) => {
                    const next = { ...previous };
                    delete next[selected.id];
                    return next;
                  });
                  setMessage('Health endpoint saved. Refresh health to check it.');
                }
                await load();
              })
            }
          />
          <Button
            label="Refresh project health"
            variant="outline"
            disabled={busy || !selected.healthUrl}
            onPress={() =>
              void run(async () => {
                const bundle = await fetchProjectIncident(selected.id);
                if (mounted.current)
                  setObservations((previous) => ({ ...previous, [selected.id]: bundle }));
              })
            }
          />
          {observed ? (
            <>
              <Text style={ui.title}>
                {observed.serviceHealth.status === 'unknown'
                  ? 'Health could not be established'
                  : `HTTP availability: ${observed.serviceHealth.status}`}
              </Text>
              <Text style={ui.label}>
                Incident: {observed.incident.status} · {observed.incident.id}
              </Text>
              {observed.collection
                ?.filter((source) => source.status === 'unavailable')
                .map((source) => (
                  <Text key={source.source} style={ui.body}>
                    {source.source}: {source.message}
                  </Text>
                ))}
              {observed.evidence.slice(-12).map((event) => (
                <View key={event.id}>
                  <Text style={ui.label}>{event.title}</Text>
                  <Text style={ui.body}>{event.excerpt}</Text>
                  <Text selectable style={ui.label}>
                    Evidence: {event.id}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
          <ProjectOperations
            key={selected.id}
            project={selected}
            onChange={(updated) => {
              setProjects((projects) => projects.map((p) => (p.id === updated.id ? updated : p)));
              setObservations({});
            }}
          />
          <Button
            label="Stop tracking project"
            variant="ghost"
            disabled={busy}
            onPress={() =>
              Alert.alert('Stop tracking this project?', selected.repository.fullName, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Stop tracking',
                  onPress: () =>
                    void run(async () => {
                      await removeProject(selected.id);
                      if (mounted.current) setSelectedId(null);
                      await load();
                    }),
                },
              ])
            }
          />
        </Card>
      ) : null}
      {busy ? <Text style={ui.label}>Updating projects…</Text> : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {message}
        </Text>
      ) : null}
    </>
  );
}
