import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { GitBranch, GitCode, TrackedProject } from '@pocketsre/contracts';
import { fetchProjectBranches, fetchProjectCode } from '../api/gateway';
import { Badge, Button, Card, Icon, ui } from './ui';
import { colors } from '../theme';
const input = {
  color: colors.text,
  backgroundColor: colors.muted,
  padding: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.border,
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Could not read this repository.';
export function CodeBrowser({
  project,
  initialRef,
  onRefChange,
}: {
  project: TrackedProject;
  initialRef: string;
  onRefChange?: (ref: string) => void;
}) {
  const [ref, setRef] = useState(initialRef);
  const [draftRef, setDraftRef] = useState(initialRef);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [data, setData] = useState<GitCode | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [branchPage, setBranchPage] = useState(1);
  const [nextBranch, setNextBranch] = useState<number | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState('');
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setData(null);
    setFilter('');
    setPage(0);
    void fetchProjectCode(project.id, snapshot ?? ref, path)
      .then((value) => {
        if (active) {
          setData(value);
          if (!snapshot) setSnapshot(value.ref);
        }
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
    // Snapshot is set by the first response; changing it alone must not refetch the same folder.
  }, [project.id, ref, path, revision]);
  useEffect(() => {
    if (!picker) return;
    let active = true;
    setBranchBusy(true);
    setBranchError('');
    void fetchProjectBranches(project.id, branchPage)
      .then((value) => {
        if (active) {
          setBranches((old) =>
            branchPage === 1
              ? value.items
              : [...old, ...value.items.filter((b) => !old.some((o) => o.name === b.name))],
          );
          setNextBranch(value.nextPage);
        }
      })
      .catch((e) => {
        if (active) setBranchError(message(e));
      })
      .finally(() => {
        if (active) setBranchBusy(false);
      });
    return () => {
      active = false;
    };
  }, [project.id, picker, branchPage]);
  function chooseRef(value: string) {
    const next = value.trim();
    if (!next) return;
    setSnapshot(null);
    setRef(next);
    onRefChange?.(next);
    setDraftRef(next);
    setPath('');
    setPicker(false);
    setRevision((v) => v + 1);
  }
  const lines = useMemo(() => data?.content?.split('\n') ?? [], [data]);
  const parts = path.split('/').filter(Boolean);
  const entries =
    data?.entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const openGitHub = () => {
    void Linking.openURL(
      `https://github.com/${project.repository.fullName}/${data?.kind === 'directory' ? 'tree' : 'blob'}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`,
    ).catch((e) => setError(message(e)));
  };
  return (
    <View style={{ gap: 16 }}>
      <View style={ui.between}>
        <Text style={ui.title}>Code</Text>
        <Badge>Read-only</Badge>
      </View>
      <Button
        label={`Branch / ref: ${ref}`}
        variant="outline"
        onPress={() => setPicker((v) => !v)}
      />
      {picker ? (
        <Card>
          <Text style={ui.title}>Choose a branch</Text>
          {branchBusy ? <ActivityIndicator color={colors.primary} /> : null}
          {branchError ? <Text style={ui.body}>{branchError}</Text> : null}
          <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
            {branches.map((branch) => (
              <Button
                key={branch.name}
                label={branch.name}
                variant="ghost"
                onPress={() => chooseRef(branch.name)}
              />
            ))}
          </ScrollView>
          {nextBranch ? (
            <Button
              label="More branches"
              disabled={branchBusy}
              variant="outline"
              onPress={() => setBranchPage(nextBranch)}
            />
          ) : null}
          <Text style={ui.label}>Or enter a branch, tag, or commit SHA</Text>
          <TextInput
            accessibilityLabel="Code reference"
            style={input}
            value={draftRef}
            onChangeText={setDraftRef}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            label="Open reference"
            disabled={!draftRef.trim()}
            onPress={() => chooseRef(draftRef)}
          />
        </Card>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', gap: 4 }}
      >
        <Button label="Repository root" variant="ghost" onPress={() => setPath('')} />
        {parts.map((name, i) => (
          <View key={i} style={ui.row}>
            <Text style={ui.label}>/</Text>
            <Button
              label={name}
              variant="ghost"
              onPress={() => setPath(parts.slice(0, i + 1).join('/'))}
            />
          </View>
        ))}
      </ScrollView>
      {path ? (
        <Button
          label="Up one folder"
          variant="ghost"
          onPress={() => setPath(parts.slice(0, -1).join('/'))}
        />
      ) : null}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {error}
        </Text>
      ) : null}
      {data?.kind === 'directory' ? (
        <>
          <TextInput
            accessibilityLabel="Filter this folder"
            placeholder="Filter this folder…"
            placeholderTextColor={colors.textMuted}
            style={input}
            value={filter}
            onChangeText={(value) => {
              setFilter(value);
              setPage(0);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={ui.label}>
            {entries.length} entries{filter ? ' matching' : ''}
          </Text>
          <Card>
            {entries.slice(0, (page + 1) * 100).map((entry) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${entry.path}`}
                key={entry.path}
                onPress={() => setPath(entry.path)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text
                  style={[
                    ui.mono,
                    { color: entry.kind === 'directory' ? colors.primary : colors.textMuted },
                  ]}
                >
                  {entry.kind === 'directory' ? '▸' : '·'}
                </Text>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={ui.title}>{entry.name}</Text>
                  <Text style={ui.label}>
                    {entry.kind}
                    {entry.size !== null ? ` · ${entry.size.toLocaleString()} bytes` : ''}
                  </Text>
                </View>
                <Icon name="chevron" size={14} />
              </Pressable>
            ))}
            {!entries.length ? (
              <Text style={ui.body}>
                {filter ? 'No matching files in this folder.' : 'This folder is empty.'}
              </Text>
            ) : null}
          </Card>
          {entries.length > (page + 1) * 100 ? (
            <Button label="More files" variant="outline" onPress={() => setPage((p) => p + 1)} />
          ) : null}
          {data.truncated ? (
            <Text style={ui.body}>
              GitHub omitted some entries from this directory. Open GitHub to see more.
            </Text>
          ) : null}
        </>
      ) : null}
      {data && data.kind !== 'directory' ? (
        <>
          <Text selectable style={ui.title}>
            {parts.at(-1)}
          </Text>
          <Text style={ui.label}>
            {data.kind}
            {data.size !== null ? ` · ${data.size.toLocaleString()} bytes` : ''}
          </Text>
          {data.reason ? <Text style={ui.body}>{data.reason}</Text> : null}
          {data.content !== null ? (
            <>
              <Text style={ui.label}>
                {lines.length} lines · showing {page * 200 + 1}–
                {Math.min((page + 1) * 200, lines.length)}
              </Text>
              <Card>
                <ScrollView key={page} nestedScrollEnabled style={{ maxHeight: 420 }}>
                  <ScrollView horizontal>
                    <View>
                      {lines.slice(page * 200, (page + 1) * 200).map((line, i) => (
                        <Text
                          selectable
                          key={page * 200 + i}
                          style={[ui.mono, { fontSize: 12, lineHeight: 20 }]}
                        >
                          <Text style={{ color: colors.textMuted }}>
                            {String(page * 200 + i + 1).padStart(4)}
                            {'  '}
                          </Text>
                          {line || ' '}
                        </Text>
                      ))}
                    </View>
                  </ScrollView>
                </ScrollView>
              </Card>
              <View style={ui.row}>
                <Button
                  label="Previous lines"
                  disabled={page === 0}
                  variant="outline"
                  onPress={() => setPage((p) => p - 1)}
                />
                <Button
                  label="Next lines"
                  disabled={(page + 1) * 200 >= lines.length}
                  variant="outline"
                  onPress={() => setPage((p) => p + 1)}
                />
              </View>
            </>
          ) : null}
        </>
      ) : null}
      <Button label="Open on GitHub" variant="outline" onPress={openGitHub} />
      <Button
        label={error ? 'Retry code' : 'Refresh code'}
        icon="refresh"
        variant="ghost"
        disabled={busy}
        onPress={() => {
          setSnapshot(null);
          setRevision((v) => v + 1);
        }}
      />
    </View>
  );
}
