import { PullRequestMerge } from './PullRequestMerge';
import { CodeBrowser } from './CodeBrowser';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  GitBranch,
  GitCommit,
  GitDiff,
  GitFile,
  GitPull,
  TrackedProject,
} from '@pocketsre/contracts';
import {
  compareProjectRefs,
  fetchProjectBranches,
  fetchProjectCommits,
  fetchProjectDiff,
  fetchProjectPulls,
  fetchProjects,
} from '../api/gateway';
import { Badge, Button, Card, Icon, ui } from './ui';
import { colors } from '../theme';

type Section = 'Code' | 'Pull requests' | 'Commits' | 'Branches' | 'Compare';
const input = {
  color: colors.text,
  backgroundColor: colors.muted,
  padding: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.border,
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not load GitHub data.';
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderRadius: 18,
        backgroundColor: selected ? colors.muted : 'transparent',
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
      }}
    >
      <Text style={[ui.label, selected && { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}
export function FileDiff({ file }: { file: GitFile }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Diff ${file.filename}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ gap: 8 }}
      >
        <View style={ui.between}>
          <Text style={[ui.mono, { flex: 1 }]}>{file.filename}</Text>
          <Icon name="chevron" size={14} />
        </View>
        {file.previous_filename ? (
          <Text style={ui.label}>Renamed from {file.previous_filename}</Text>
        ) : null}
        <View style={ui.row}>
          <Badge>{file.status}</Badge>
          <Text style={{ color: colors.success }}>+{file.additions}</Text>
          <Text style={{ color: colors.danger }}>−{file.deletions}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <>
          {file.patch ? (
            <ScrollView horizontal>
              <View>
                {file.patch.split('\n').map((line, index) => (
                  <Text
                    selectable
                    key={index}
                    style={[
                      ui.mono,
                      {
                        fontSize: 11,
                        lineHeight: 18,
                        color: line.startsWith('+')
                          ? colors.success
                          : line.startsWith('-')
                            ? colors.danger
                            : line.startsWith('@@')
                              ? colors.primary
                              : colors.textMuted,
                      },
                    ]}
                  >
                    {line || ' '}
                  </Text>
                ))}
              </View>
            </ScrollView>
          ) : (
            <Text style={ui.body}>
              No text patch available. This may be a binary file or a diff GitHub omitted.
            </Text>
          )}
          {file.patchTruncated ? (
            <Text style={ui.body}>Preview shortened. Open GitHub for the complete diff.</Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
function DiffList({ diff }: { diff: GitDiff }) {
  return (
    <>
      <Text style={ui.body}>{diff.summary}</Text>
      <Text style={ui.label}>{diff.files.length} files loaded · tap a file to see its diff</Text>
      {diff.files.map((file) => (
        <FileDiff key={file.filename} file={file} />
      ))}
      {!diff.files.length ? <Text style={ui.body}>No changed files in this result.</Text> : null}
      {diff.limited ? (
        <Text style={ui.body}>
          GitHub’s file limit was reached. Open GitHub to inspect the remaining changes.
        </Text>
      ) : null}
    </>
  );
}
export function GitHub({ onOpenProjects }: { onOpenProjects: () => void }) {
  const [projects, setProjects] = useState<TrackedProject[] | null>(null);
  const [selected, setSelected] = useState<string>('all');
  const [error, setError] = useState('');
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void fetchProjects()
      .then((value) => {
        if (active) setProjects(value);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [visit]);
  const project = projects?.find((p) => p.id === selected);
  return (
    <View style={{ gap: 20 }}>
      <View style={ui.between}>
        <View style={ui.row}>
          <Icon name="github" size={24} />
          <Text style={ui.title}>Your repositories</Text>
        </View>
        <Button label="Refresh" variant="ghost" onPress={() => setVisit((v) => v + 1)} />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {error}
        </Text>
      ) : null}
      {!projects && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {projects?.length ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <Choice
              label="All projects"
              selected={selected === 'all'}
              onPress={() => setSelected('all')}
            />
            {projects.map((p) => (
              <Choice
                key={p.id}
                label={p.repository.fullName}
                selected={selected === p.id}
                onPress={() => setSelected(p.id)}
              />
            ))}
          </ScrollView>
          {project ? (
            <RepositoryGit key={`${project.id}:${visit}`} project={project} />
          ) : (
            <AllPulls key={visit} projects={projects} onSelect={setSelected} />
          )}
        </>
      ) : projects ? (
        <Card>
          <Text style={ui.title}>Bring your repositories here</Text>
          <Text style={ui.body}>
            Connect GitHub and import a project to browse its pull requests, commits, branches and
            changes.
          </Text>
          <Button label="Connect or import projects" icon="github" onPress={onOpenProjects} />
        </Card>
      ) : null}
    </View>
  );
}
function AllPulls({
  projects,
  onSelect,
}: {
  projects: TrackedProject[];
  onSelect: (id: string) => void;
}) {
  const [rows, setRows] = useState<
    { project: TrackedProject; pulls: GitPull[]; more: boolean; error: string }[] | null
  >(null);
  useEffect(() => {
    let active = true;
    // Small sequential batches avoid bursting requests for accounts with many projects.
    void (async () => {
      const result: NonNullable<typeof rows> = [];
      for (let start = 0; start < projects.length; start += 4) {
        if (!active) return;
        const batch = projects.slice(start, start + 4);
        const values = await Promise.allSettled(batch.map((p) => fetchProjectPulls(p.id)));
        values.forEach((value, i) =>
          result.push({
            project: batch[i]!,
            pulls: value.status === 'fulfilled' ? value.value.items : [],
            more: value.status === 'fulfilled' && !!value.value.nextPage,
            error: value.status === 'rejected' ? errorText(value.reason) : '',
          }),
        );
      }
      if (active) setRows(result);
    })();
    return () => {
      active = false;
    };
  }, [projects]);
  return (
    <View style={{ gap: 16 }}>
      <Text style={ui.title}>Open pull requests</Text>
      <Text style={ui.body}>
        Across your imported projects. Select a repository for commits, branches and comparisons.
      </Text>
      {!rows ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        rows.map((row) => (
          <Card key={row.project.id}>
            <Text style={ui.title}>{row.project.repository.fullName}</Text>
            {row.error ? (
              <Text style={ui.body}>
                {row.error} Pull request read access may need enabling in the GitHub App.
              </Text>
            ) : (
              <>
                <Badge>
                  {row.pulls.length}
                  {row.more ? '+' : ''} open
                </Badge>
                {row.pulls.slice(0, 5).map((pr) => (
                  <Text key={pr.number} style={ui.body}>
                    #{pr.number} · {pr.title}
                  </Text>
                ))}
                {!row.pulls.length ? <Text style={ui.body}>No open pull requests.</Text> : null}
              </>
            )}
            <Button
              label={`Browse ${row.project.repository.fullName.split('/')[1]}`}
              variant="outline"
              onPress={() => onSelect(row.project.id)}
            />
          </Card>
        ))
      )}
    </View>
  );
}
function RepositoryGit({ project }: { project: TrackedProject }) {
  const [section, setSection] = useState<Section>('Pull requests');
  const [pulls, setPulls] = useState<GitPull[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ref, setRef] = useState(project.repository.defaultBranch);
  const [base, setBase] = useState(project.repository.defaultBranch);
  const [head, setHead] = useState('');
  const [branchDestination, setBranchDestination] = useState<'Code' | 'Commits'>('Code');
  const [detail, setDetail] = useState<{
    kind: 'pulls' | 'commits';
    revision: string;
    headSha?: string;
    title: string;
    body?: string | null;
    subtitle: string;
  } | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      generation.current++;
    },
    [],
  );
  async function run(work: () => Promise<() => void>) {
    const id = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const apply = await work();
      if (mounted.current && id === generation.current) apply();
    } catch (e) {
      if (mounted.current && id === generation.current) setError(errorText(e));
    } finally {
      if (mounted.current && id === generation.current) setBusy(false);
    }
  }
  function load(page = 1) {
    void run(async () => {
      if (section === 'Pull requests') {
        const value = await fetchProjectPulls(project.id, page);
        return () => {
          setPulls((old) =>
            page === 1
              ? value.items
              : [
                  ...old,
                  ...value.items.filter((item) => !old.some((p) => p.number === item.number)),
                ],
          );
          setNext(value.nextPage);
        };
      }
      if (section === 'Commits') {
        const value = await fetchProjectCommits(project.id, ref, page);
        return () => {
          setCommits((old) =>
            page === 1
              ? value.items
              : [...old, ...value.items.filter((item) => !old.some((p) => p.sha === item.sha))],
          );
          setNext(value.nextPage);
        };
      }
      const value = await fetchProjectBranches(project.id, page);
      return () => {
        setBranches((old) =>
          page === 1
            ? value.items
            : [...old, ...value.items.filter((item) => !old.some((p) => p.name === item.name))],
        );
        setNext(value.nextPage);
      };
    });
  }
  useEffect(() => {
    setDetail(null);
    setDiff(null);
    setNext(null);
    setCommits([]);
    setError('');
    generation.current++;
    setBusy(false);
    if (section !== 'Compare' && section !== 'Code') load();
  }, [section, ref]);
  function open(value: NonNullable<typeof detail>) {
    setDetail(value);
    setDiff(null);
    void run(async () => {
      const result = await fetchProjectDiff(
        project.id,
        value.kind,
        value.revision,
        1,
        value.headSha,
      );
      return () => setDiff(result);
    });
  }
  function moreDiff() {
    if (!detail || !diff?.nextPage) return;
    void run(async () => {
      const value = await fetchProjectDiff(
        project.id,
        detail.kind,
        detail.revision,
        diff.nextPage!,
        detail.headSha,
      );
      return () =>
        setDiff({
          ...value,
          files: [
            ...diff.files,
            ...value.files.filter((f) => !diff.files.some((old) => old.filename === f.filename)),
          ],
        });
    });
  }
  const url = `https://github.com/${project.repository.fullName}`;
  const openUrl = (path: string) => {
    void Linking.openURL(url + path).catch((e) => setError(errorText(e)));
  };
  return (
    <View style={{ gap: 16 }}>
      <View style={ui.row}>
        <Badge>{project.repository.private ? 'Private' : 'Public'}</Badge>
        <Button
          label={`Switch branch: ${ref}`}
          variant="outline"
          style={{ flex: 1 }}
          onPress={() => {
            setBranchDestination(section === 'Commits' ? 'Commits' : 'Code');
            setSection('Branches');
            setDetail(null);
            setDiff(null);
          }}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {(['Code', 'Pull requests', 'Commits', 'Branches', 'Compare'] as const).map((item) => (
          <Choice
            key={item}
            label={item}
            selected={section === item}
            onPress={() => setSection(item)}
          />
        ))}
      </ScrollView>
      {detail ? (
        <>
          <Button
            label="Back to list"
            variant="ghost"
            onPress={() => {
              generation.current++;
              setBusy(false);
              setError('');
              setDetail(null);
              setDiff(null);
            }}
          />
          <Text style={ui.title}>{detail.title}</Text>
          <Text style={ui.mono}>{detail.subtitle}</Text>
          {detail.body ? (
            <Text selectable style={ui.body}>
              {detail.body}
            </Text>
          ) : null}
          <Button
            label="Open on GitHub"
            variant="outline"
            onPress={() =>
              openUrl(
                detail.kind === 'pulls'
                  ? `/pull/${detail.revision}/files`
                  : `/commit/${detail.revision}`,
              )
            }
          />
          {detail.kind === 'pulls' && diff && detail.headSha ? (
            <PullRequestMerge
              key={`${project.id}:${detail.revision}`}
              projectId={project.id}
              number={Number(detail.revision)}
              reviewedSha={detail.headSha}
              onMerged={() =>
                setPulls((old) => old.filter((pull) => pull.number !== Number(detail.revision)))
              }
            />
          ) : null}
          {diff ? <DiffList diff={diff} /> : null}
          {diff?.nextPage ? (
            <Button label="Load more files" disabled={busy} onPress={moreDiff} />
          ) : null}
          {error ? (
            <Button label="Retry diff" disabled={busy} onPress={() => open(detail)} />
          ) : null}
        </>
      ) : (
        <>
          {section === 'Code' ? (
            <CodeBrowser
              key={`${project.id}:${ref}`}
              project={project}
              initialRef={ref}
              onRefChange={setRef}
            />
          ) : null}
          {section === 'Pull requests' ? (
            <>
              <Text style={ui.title}>Open pull requests</Text>
              {pulls.map((pr) => (
                <Card key={pr.number}>
                  <View style={ui.row}>
                    <Badge tone={pr.draft ? 'neutral' : 'success'}>
                      {pr.draft ? 'Draft' : 'Open'}
                    </Badge>
                    <Text style={ui.label}>
                      #{pr.number} · {pr.user?.login ?? 'Deleted account'}
                    </Text>
                  </View>
                  <Text style={ui.title}>{pr.title}</Text>
                  <Text style={ui.mono}>
                    {pr.head.ref} → {pr.base.ref}
                  </Text>
                  <Text style={ui.label}>Updated {new Date(pr.updated_at).toLocaleString()}</Text>
                  <Button
                    label={`Review #${pr.number}`}
                    variant="outline"
                    onPress={() =>
                      open({
                        kind: 'pulls',
                        revision: String(pr.number),
                        headSha: pr.head.sha,
                        title: pr.title,
                        body: pr.body,
                        subtitle: `${pr.head.ref} → ${pr.base.ref}`,
                      })
                    }
                  />
                </Card>
              ))}
              {!busy && !error && !pulls.length ? (
                <Card>
                  <Text style={ui.title}>All caught up</Text>
                  <Text style={ui.body}>No open pull requests for this project.</Text>
                </Card>
              ) : null}
            </>
          ) : null}
          {section === 'Commits' ? (
            <>
              <Text style={ui.title}>Commit history</Text>
              <Text style={ui.mono}>Branch: {ref}</Text>
              {commits.map((c) => (
                <Card key={c.sha}>
                  <Text style={ui.title}>{c.commit.message.split('\n')[0]}</Text>
                  <Text style={ui.label}>
                    {c.commit.author?.name ?? 'Unknown author'} ·{' '}
                    {c.commit.author ? new Date(c.commit.author.date).toLocaleString() : ''}
                  </Text>
                  <Text style={ui.mono}>{c.sha.slice(0, 7)}</Text>
                  <Button
                    label={`Diff ${c.sha.slice(0, 7)}`}
                    variant="outline"
                    onPress={() =>
                      open({
                        kind: 'commits',
                        revision: c.sha,
                        title: c.commit.message,
                        subtitle: c.sha.slice(0, 7),
                      })
                    }
                  />
                </Card>
              ))}
              {!busy && !error && !commits.length ? (
                <Text style={ui.body}>No commits available for this branch.</Text>
              ) : null}
            </>
          ) : null}
          {section === 'Branches' ? (
            <>
              <Text style={ui.title}>Branches</Text>
              {branches.map((b) => (
                <Card key={b.name}>
                  <Text style={ui.title}>{b.name}</Text>
                  <View style={ui.row}>
                    {b.name === ref ? <Badge tone="success">Selected</Badge> : null}
                    {b.name === project.repository.defaultBranch ? <Badge>Default</Badge> : null}
                    {b.protected ? <Badge>Protected</Badge> : null}
                    <Text style={ui.mono}>{b.commit.sha.slice(0, 7)}</Text>
                  </View>
                  <Button
                    label={`Switch to ${b.name}`}
                    variant={b.name === ref ? 'outline' : 'primary'}
                    onPress={() => {
                      setRef(b.name);
                      setSection(branchDestination);
                    }}
                  />
                  <Button
                    label={`Browse code on ${b.name}`}
                    variant="outline"
                    onPress={() => {
                      setRef(b.name);
                      setSection('Code');
                    }}
                  />
                  <Button
                    label={`Commits on ${b.name}`}
                    variant="outline"
                    onPress={() => {
                      setRef(b.name);
                      setSection('Commits');
                    }}
                  />
                  <Button
                    label={`Compare ${b.name}`}
                    variant="ghost"
                    onPress={() => {
                      setHead(b.name);
                      setSection('Compare');
                    }}
                  />
                </Card>
              ))}
              {!busy && !error && !branches.length ? (
                <Text style={ui.body}>No branches available.</Text>
              ) : null}
            </>
          ) : null}
          {section === 'Compare' ? (
            <>
              <Text style={ui.title}>Compare changes</Text>
              <Text style={ui.body}>
                Choose a base and head branch, tag, or commit SHA. Changes are shown from their
                common ancestor to the head.
              </Text>
              <Text style={ui.label}>Base</Text>
              <TextInput
                accessibilityLabel="Base reference"
                style={input}
                value={base}
                onChangeText={(v) => {
                  setBase(v);
                  setDiff(null);
                }}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={ui.label}>Head</Text>
              <TextInput
                accessibilityLabel="Head reference"
                placeholder="feature/my-branch"
                placeholderTextColor={colors.textMuted}
                style={input}
                value={head}
                onChangeText={(v) => {
                  setHead(v);
                  setDiff(null);
                }}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                label="Compare references"
                disabled={busy || !base.trim() || !head.trim()}
                onPress={() => {
                  setDiff(null);
                  void run(async () => {
                    const value = await compareProjectRefs(project.id, base.trim(), head.trim());
                    return () => setDiff(value);
                  });
                }}
              />
              {diff ? (
                <>
                  <DiffList diff={diff} />
                  <Button
                    label="Open comparison on GitHub"
                    variant="outline"
                    onPress={() =>
                      openUrl(
                        `/compare/${encodeURIComponent(base.trim())}...${encodeURIComponent(head.trim())}`,
                      )
                    }
                  />
                </>
              ) : null}
            </>
          ) : section !== 'Code' ? (
            <>
              {next ? (
                <Button label="Load more" disabled={busy} onPress={() => load(next)} />
              ) : null}
              <Button
                label="Refresh repository"
                icon="refresh"
                variant="ghost"
                disabled={busy}
                onPress={() => load()}
              />
            </>
          ) : null}
        </>
      )}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
