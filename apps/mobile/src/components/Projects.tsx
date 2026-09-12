import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
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
  saveProjectSource,
  startGitHubSignIn,
  trackProject,
} from '../api/gateway';
import { Badge, Button, Card, Icon, ui } from './ui';
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
  onNavigate,
  onOpenSettings,
  onOpenDemo,
}: {
  onOpenAgent?: (project: TrackedProject) => void;
  initialProjectId?: string | null;
  onNavigate?: () => void;
  onOpenSettings?: () => void;
  onOpenDemo?: () => void;
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
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(360, Math.max(240, width - 72));
  const [importing, setImporting] = useState(false);
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [section, setSection] = useState<'health' | 'deployment' | 'monitoring' | 'source'>(
    'health',
  );
  const [sourcePaths, setSourcePaths] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [projectsUnavailable, setProjectsUnavailable] = useState(false);
  const [page, setPage] = useState(0);
  const [healthUrl, setHealthUrl] = useState('');
  const [observations, setObservations] = useState<Record<string, IncidentBundle>>({});
  const [working, setBusy] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const busy = working || operationBusy;
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
    setProjectsUnavailable(savedResult.status === 'rejected');
    if (savedResult.status === 'fulfilled') {
      setProjects(savedResult.value);
      if (initialProjectId && !loaded) {
        const initial = savedResult.value.find((p) => p.id === initialProjectId);
        setHealthUrl(initial?.healthUrl ?? '');
        setSourcePaths(initial?.sourcePaths?.join('\n') ?? '');
      }
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
    setLoaded(true);
    if (statusResult.status === 'rejected') {
      setConnection(null);
      throw statusResult.reason;
    }
    if (savedResult.status === 'rejected') throw savedResult.reason;
  }
  async function run(work: () => Promise<void>) {
    if (lock.current || operationBusy || !mounted.current) return;
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
              if (mounted.current) {
                setImporting(true);
                await browse();
                setMessage('GitHub connected. Choose a repository to import.');
              }
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
  function openProject(project: TrackedProject) {
    setSelectedId(project.id);
    setHealthUrl(project.healthUrl ?? '');
    setSourcePaths(project.sourcePaths?.join('\n') ?? '');
    setSection('health');
    setImporting(false);
    setMessage('');
    onNavigate?.();
  }
  function goHome() {
    setSelectedId(null);
    setImporting(false);
    setPage(0);
    setMessage('');
    onNavigate?.();
  }
  async function connect() {
    if (!connection?.canSignIn) {
      setMessage(
        connection
          ? 'GitHub sign-in is not configured on this gateway. Open connection settings to check your gateway, or ask its administrator to enable GitHub sign-in.'
          : 'Could not check GitHub. Refresh projects or check your gateway connection.',
      );
      return;
    }
    const value = device ?? (await startGitHubSignIn());
    if (!mounted.current) return;
    setDevice(value);
    await Linking.openURL(value.verificationUrl);
  }
  function addProject() {
    setImporting(true);
    setSearch('');
    onNavigate?.();
    if (connection?.connected) void run(() => browse());
  }
  const observed = selected ? observations[selected.id] : undefined;
  const filtered = repositories.filter((repo) =>
    repo.fullName.toLowerCase().includes(search.toLowerCase()),
  );
  const tabs = [
    { id: 'health', label: 'Health' },
    { id: 'deployment', label: 'Deployment' },
    { id: 'monitoring', label: 'Alerts' },
    { id: 'source', label: 'Source files' },
  ] as const;
  return (
    <>
      {busy ? (
        <View style={ui.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={ui.label}>Updating projects…</Text>
        </View>
      ) : null}
      {message ? (
        <Card>
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        </Card>
      ) : null}
      {!selected ? (
        <>
          {importing ? (
            <Button label="Back to projects" variant="ghost" onPress={goHome} disabled={busy} />
          ) : null}
          {!connection?.connected ? (
            <Card aurora>
              <View style={styles.logo}>
                <Icon name="github" size={36} />
              </View>
              <Text style={styles.headline}>{'Your code.\nYour command center.'}</Text>
              <Text style={ui.body}>
                Connect GitHub to bring your projects together. Give each one the context it needs
                to investigate incidents.
              </Text>
              <Button
                icon="github"
                label={device ? 'Reopen GitHub sign-in' : 'Connect GitHub'}
                disabled={busy}
                onPress={() => void run(connect)}
              />
              {connection && !connection.canSignIn ? (
                <>
                  <Text style={ui.label}>
                    GitHub sign-in is not configured on this gateway yet.
                  </Text>
                  {onOpenSettings ? (
                    <Button
                      label="Connection settings"
                      variant="outline"
                      onPress={onOpenSettings}
                    />
                  ) : null}
                </>
              ) : null}
              {device ? (
                <>
                  <Text style={ui.body}>Enter this code on GitHub to finish connecting.</Text>
                  <Text selectable style={styles.code}>
                    {device.userCode}
                  </Text>
                  <Text style={ui.label}>
                    Waiting for approval · expires {new Date(device.expiresAt).toLocaleTimeString()}
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
            </Card>
          ) : (
            <View style={ui.between}>
              <View style={ui.row}>
                <Icon name="github" size={24} />
                <Text style={ui.title}>{connection.account ?? 'GitHub connected'}</Text>
                <Badge tone="success" dot>
                  Connected
                </Badge>
              </View>
              <Button
                label={accountExpanded ? 'Hide account' : 'Account'}
                variant="ghost"
                onPress={() => setAccountExpanded(!accountExpanded)}
              />
            </View>
          )}
          {connection?.connected && accountExpanded ? (
            <Card>
              <Text style={ui.title}>GitHub account</Text>
              {connection.expiresAt ? (
                <Text style={ui.label}>
                  Session expires {new Date(connection.expiresAt).toLocaleString()}.
                </Text>
              ) : null}
              {connection.installationUrl ? (
                <Button
                  label="Manage repository access on GitHub"
                  variant="outline"
                  onPress={() =>
                    void run(async () => {
                      await Linking.openURL(connection.installationUrl!);
                    })
                  }
                />
              ) : null}
              <Button
                label="Disconnect GitHub"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    'Disconnect GitHub?',
                    'Your saved projects and settings remain. Repository access will need a new connection.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Disconnect',
                        onPress: () =>
                          void run(async () => {
                            await disconnectGitHub();
                            setDevice(null);
                            setAccountExpanded(false);
                            await load();
                          }),
                      },
                    ],
                  )
                }
              />
            </Card>
          ) : null}
          {!importing ? (
            <>
              <View style={ui.between}>
                <View>
                  <Text style={styles.sectionTitle}>Your projects</Text>
                  <Text style={ui.label}>
                    {projects.length
                      ? `${projects.length} imported · swipe to explore`
                      : 'A workspace for every repository'}
                  </Text>
                </View>
                <Button
                  label="Refresh projects"
                  icon="refresh"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => void run(load)}
                />
              </View>
              {loaded && (!projectsUnavailable || projects.length > 0) ? (
                <>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={cardWidth + 14}
                    decelerationRate="fast"
                    contentContainerStyle={styles.carousel}
                    accessibilityLabel="Imported GitHub projects"
                    onMomentumScrollEnd={(event) =>
                      setPage(Math.round(event.nativeEvent.contentOffset.x / (cardWidth + 14)))
                    }
                  >
                    {projects.map((project, index) => (
                      <Pressable
                        key={project.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${project.repository.fullName}`}
                        disabled={busy}
                        onPress={() => openProject(project)}
                        style={({ pressed }) => [
                          styles.project,
                          { width: cardWidth, opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <View style={ui.between}>
                          <View style={styles.projectIcon}>
                            <Icon name="github" size={30} />
                          </View>
                          <Text style={styles.ordinal}>{String(index + 1).padStart(2, '0')}</Text>
                        </View>
                        <View style={{ gap: 6 }}>
                          <Text style={ui.label}>{project.repository.fullName.split('/')[0]}</Text>
                          <Text style={styles.projectName}>
                            {project.repository.fullName.split('/')[1]}
                          </Text>
                          <Text style={ui.mono}>
                            {project.repository.defaultBranch} ·{' '}
                            {project.repository.private ? 'Private' : 'Public'}
                          </Text>
                        </View>
                        <Badge tone={project.healthUrl ? 'neutral' : 'warning'} dot>
                          {project.healthUrl
                            ? 'Health endpoint configured'
                            : 'Set up health endpoint'}
                        </Badge>
                        <View style={ui.divider} />
                        <View style={{ gap: 7 }}>
                          <Text style={ui.label}>
                            {project.deployment
                              ? `Vercel · ${project.deployment.target}`
                              : 'Deployment not linked'}
                          </Text>
                          <Text style={ui.label}>
                            {project.monitoring ? 'Monitoring enabled' : 'Monitoring paused'}
                          </Text>
                        </View>
                        <View style={[ui.between, { marginTop: 'auto' }]}>
                          <Text style={[ui.title, { color: colors.primary }]}>Open workspace</Text>
                          <Icon name="arrow" color={colors.primary} />
                        </View>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add project"
                      disabled={busy}
                      onPress={addProject}
                      style={({ pressed }) => [
                        styles.project,
                        styles.addProject,
                        { width: cardWidth, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text accessible={false} style={styles.plus}>
                        +
                      </Text>
                      <Text style={styles.projectName}>
                        {projects.length ? 'Room for one more.' : 'Your first project.'}
                      </Text>
                      <Text style={[ui.body, { textAlign: 'center' }]}>
                        Import a GitHub repository and connect its health, deployments and source
                        files.
                      </Text>
                      <Text style={[ui.title, { color: colors.primary }]}>Add project →</Text>
                    </Pressable>
                  </ScrollView>
                  <Text
                    accessibilityLabel="Project count"
                    style={[ui.label, { textAlign: 'center' }]}
                  >
                    {page < projects.length
                      ? `${page + 1} / ${projects.length} · Project workspace`
                      : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · Add a project`}
                  </Text>
                </>
              ) : !busy ? (
                <Button
                  label="Retry loading projects"
                  variant="outline"
                  onPress={() => void run(load)}
                />
              ) : null}
              {!projects.length && loaded && !projectsUnavailable ? (
                <Text style={ui.body}>
                  Start with one repository. Its settings and incident evidence will stay together
                  in its workspace.
                </Text>
              ) : null}
              <Card>
                <Text style={ui.title}>Better context. Clearer incidents.</Text>
                <Text style={ui.body}>
                  Open a project to connect its health endpoint, link deployment logs, choose source
                  files, and turn on alerts.
                </Text>
                {onOpenDemo ? (
                  <Button
                    label="Explore the demo workspace"
                    variant="outline"
                    onPress={onOpenDemo}
                  />
                ) : null}
              </Card>
            </>
          ) : connection?.connected ? (
            <Card>
              <Text style={styles.sectionTitle}>Import a project</Text>
              <Text style={ui.body}>
                Choose a repository from GitHub. You’ll configure its incident context next.
              </Text>
              <TextInput
                accessibilityLabel="Filter repositories"
                placeholder="Search loaded repositories…"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                value={search}
                onChangeText={setSearch}
                style={inputStyle}
              />
              {filtered.map((repo) => {
                const tracked = projects.some((project) => project.repository.id === repo.id);
                return (
                  <View key={repo.id} style={styles.repository}>
                    <View style={ui.row}>
                      <Icon name="github" size={22} />
                      <Text style={[ui.title, { flex: 1 }]}>{repo.fullName}</Text>
                    </View>
                    <Text style={ui.label}>
                      {repo.private ? 'Private' : 'Public'} · {repo.defaultBranch}
                    </Text>
                    <Button
                      label={tracked ? `Imported ${repo.fullName}` : `Import ${repo.fullName}`}
                      variant="outline"
                      disabled={busy || tracked}
                      onPress={() =>
                        void run(async () => {
                          const project = await trackProject(repo.fullName);
                          if (!mounted.current) return;
                          setProjects((previous) => [
                            ...previous.filter((p) => p.id !== project.id),
                            project,
                          ]);
                          openProject(project);
                        })
                      }
                    />
                  </View>
                );
              })}
              {browsed && !filtered.length ? (
                <Text style={ui.body}>
                  {repositories.length
                    ? 'No matching repositories in the loaded results. Try another name or load more.'
                    : 'No repositories available. Check repository access on GitHub, then try again.'}
                </Text>
              ) : null}
              {nextPage ? (
                <Button
                  label="Load more repositories"
                  variant="outline"
                  disabled={busy}
                  onPress={() => void run(() => browse(nextPage))}
                />
              ) : null}
              <Button
                label="Refresh repositories"
                variant="ghost"
                disabled={busy}
                onPress={() => void run(() => browse())}
              />
              {connection.installationUrl ? (
                <Button
                  label="Manage repository access on GitHub"
                  variant="ghost"
                  onPress={() =>
                    void run(async () => {
                      await Linking.openURL(connection.installationUrl!);
                    })
                  }
                />
              ) : null}
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Button label="Back to projects" variant="ghost" disabled={busy} onPress={goHome} />
          <Card aurora>
            <View style={ui.between}>
              <Icon name="github" size={32} />
              <Badge>
                {selected.repository.private ? 'Private repository' : 'Public repository'}
              </Badge>
            </View>
            <Text style={ui.label}>{selected.repository.fullName.split('/')[0]}</Text>
            <Text style={styles.projectName}>{selected.repository.fullName.split('/')[1]}</Text>
            <Text style={ui.body}>Incident workspace · {selected.repository.defaultBranch}</Text>
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              <Badge tone={selected.healthUrl ? 'neutral' : 'warning'}>
                {selected.healthUrl ? 'Endpoint configured' : 'Health setup needed'}
              </Badge>
              <Badge>{selected.monitoring ? 'Monitoring on' : 'Monitoring off'}</Badge>
            </View>
            {onOpenAgent ? (
              <Button
                icon="terminal"
                label="Analyze with project agent"
                disabled={busy}
                onPress={() => onOpenAgent(selected)}
              />
            ) : null}
          </Card>
          <Text style={styles.sectionTitle}>Incident context</Text>
          <Text style={ui.body}>
            Settings below apply to {selected.repository.fullName}. Start with health, then add
            context for deeper investigations.
          </Text>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: section === tab.id, disabled: busy }}
                disabled={busy}
                onPress={() => setSection(tab.id)}
                style={[styles.tab, section === tab.id && styles.activeTab]}
              >
                <Text
                  style={[
                    ui.label,
                    section === tab.id && { color: colors.primary, fontWeight: '600' },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Card>
            {section === 'health' ? (
              <>
                <Text style={ui.title}>Service health</Text>
                <Text style={ui.body}>
                  Use a dedicated health endpoint. HTTP 2xx means reachable, HTTP 5xx means down;
                  other responses or connection failures mean unknown. This does not verify business
                  behavior.
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
                      const updated = await saveProjectHealth(
                        selected.id,
                        healthUrl.trim() || null,
                      );
                      if (mounted.current)
                        setProjects((previous) =>
                          previous.map((p) => (p.id === updated.id ? updated : p)),
                        );
                      if (mounted.current) {
                        setObservations((previous) => {
                          const next = { ...previous };
                          delete next[selected.id];
                          return next;
                        });
                        setMessage('Health endpoint saved. Refresh health to check it.');
                      }
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
              </>
            ) : null}
            {section === 'deployment' || section === 'monitoring' ? (
              <ProjectOperations
                key={`${selected.id}:${section}`}
                section={section}
                onBusyChange={setOperationBusy}
                project={selected}
                onChange={(updated) => {
                  setProjects((previous) =>
                    previous.map((p) => (p.id === updated.id ? updated : p)),
                  );
                  setObservations({});
                }}
              />
            ) : null}
            {section === 'source' ? (
              <>
                <Text style={ui.title}>Source files for analysis</Text>
                <Text style={ui.body}>
                  Choose relevant files from this repository so the agent has code context. Add up
                  to 20 paths, one per line; each request can use up to three.
                </Text>
                <TextInput
                  accessibilityLabel="Project source paths"
                  multiline
                  placeholder={'src/server.ts\nsrc/config.ts'}
                  placeholderTextColor={colors.textMuted}
                  value={sourcePaths}
                  onChangeText={setSourcePaths}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  style={[inputStyle, { minHeight: 140, textAlignVertical: 'top' }]}
                />
                <Button
                  label="Save source files"
                  disabled={busy || !sourcePaths.trim()}
                  onPress={() =>
                    void run(async () => {
                      const updated = await saveProjectSource(
                        selected.id,
                        sourcePaths
                          .split('\n')
                          .map((p) => p.trim())
                          .filter(Boolean),
                      );
                      if (mounted.current) {
                        setProjects((previous) =>
                          previous.map((p) => (p.id === updated.id ? updated : p)),
                        );
                        setMessage('Source files saved for this project.');
                      }
                    })
                  }
                />
              </>
            ) : null}
          </Card>
          <Button
            label="Remove project"
            variant="ghost"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Remove this project?',
                `Remove ${selected.repository.fullName} and its tracking settings from PocketSRE? Your GitHub repository will remain.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove project',
                    style: 'destructive',
                    onPress: () =>
                      void run(async () => {
                        await removeProject(selected.id);
                        if (!mounted.current) return;
                        setProjects((previous) =>
                          previous.filter((project) => project.id !== selected.id),
                        );
                        setObservations((previous) => {
                          const next = { ...previous };
                          delete next[selected.id];
                          return next;
                        });
                        goHome();
                        setMessage(`${selected.repository.fullName} removed from PocketSRE.`);
                      }),
                  },
                ],
              )
            }
          />
        </>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    fontWeight: '600',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  carousel: { gap: 14, paddingVertical: 4, paddingRight: 4 },
  project: {
    minHeight: 330,
    padding: 22,
    gap: 18,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  projectIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectName: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.8,
    fontWeight: '600',
  },
  ordinal: { fontFamily: 'monospace', color: colors.primary, fontSize: 13 },
  addProject: {
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  plus: { color: colors.primary, fontSize: 42, lineHeight: 50, fontWeight: '300' },
  repository: { gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
  code: { color: colors.primary, fontSize: 26, letterSpacing: 4, fontFamily: 'monospace' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeTab: { backgroundColor: colors.accentMuted, borderColor: colors.accentBorder },
});
