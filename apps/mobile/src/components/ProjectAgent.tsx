import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { FixContext, FixProposal, TrackedProject } from '@pocketsre/contracts';
import { fetchProjects, fetchProjectFiles, saveProjectSource } from '../api/gateway';
import { Button, Icon, ui } from './ui';
import { ProjectConversations } from './ProjectConversations';
import { ModelPicker } from './ModelPicker';
import { TempChat } from './TempChat';
import type { ChatCompletion } from '../ai/LocalTriageEngine';
import { colors } from '../theme';

export function ProjectAgent({
  project,
  busy,
  generate,
  modelPath,
  cloudModelLabel,
  modelAvailable = !!modelPath,
  modelKey = modelPath ?? '',
  onModelChange,
  onOpenSettings,
  onChangeProject,
  onAddProject,
  chat,
}: {
  project: TrackedProject | null;
  busy: boolean;
  generate: (context: FixContext) => Promise<FixProposal>;
  modelPath?: string;
  cloudModelLabel?: string;
  modelAvailable?: boolean;
  modelKey?: string;
  onModelChange: (path: string) => void;
  onOpenSettings: () => void;
  onChangeProject: (project: TrackedProject | null) => void;
  onAddProject: () => void;
  chat: ChatCompletion;
}) {
  const [projects, setProjects] = useState<TrackedProject[]>([]);
  const [picker, setPicker] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<{ id: string; paths: string[]; truncated: boolean }>({
    id: '',
    paths: [],
    truncated: false,
  });
  const [fileError, setFileError] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const locked = busy || working;
  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchProjects()
      .then((values) => {
        if (!active) return;
        setProjects(values);
        setError('');
        onChangeProject(values.find((value) => value.id === project?.id) ?? values[0] ?? null);
      })
      .catch(() => {
        if (active) setError('Could not load projects. Check the server connection in Settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [picker]);
  useEffect(() => {
    let active = true;
    setFiles({ id: project?.id ?? '', paths: [], truncated: false });
    setFileError('');
    if (!project) return;
    setFileLoading(true);
    void fetchProjectFiles(project.id)
      .then((value) => {
        if (active) setFiles({ id: project.id, ...value });
      })
      .catch((error) => {
        if (active) setFileError(error instanceof Error ? error.message : 'Could not load files.');
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project?.id, revision]);
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          paddingHorizontal: 22,
          paddingTop: 14,
          paddingBottom: 12,
          gap: 10,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View style={ui.between}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch agent project"
            accessibilityState={{ expanded: picker }}
            disabled={locked}
            onPress={() => setPicker(true)}
            style={{ flex: 1, gap: 4, paddingVertical: 5 }}
          >
            <View style={ui.row}>
              <Text
                numberOfLines={1}
                style={{ color: colors.text, fontSize: 20, fontWeight: '600', maxWidth: '85%' }}
              >
                {temporary
                  ? 'Temporary chat'
                  : (project?.repository.fullName.split('/').pop() ?? 'Choose a project')}
              </Text>
              <View style={{ transform: [{ rotate: '90deg' }] }}>
                <Icon name="chevron" size={16} />
              </View>
            </View>
            <Text style={ui.label}>
              {temporary
                ? 'Not attached to a repository'
                : (project?.repository.fullName ?? 'Your repository assistant')}
            </Text>
          </Pressable>
          <Icon name="bot" size={25} color={colors.primary} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select agent model"
          disabled={locked}
          onPress={() => (cloudModelLabel ? onOpenSettings() : setModelPicker(!modelPicker))}
        >
          <Text style={ui.label}>
            {cloudModelLabel ?? (modelPath ? 'On-device model' : 'Choose a model')} ⌄
          </Text>
        </Pressable>
        {modelPicker && !cloudModelLabel ? (
          <ModelPicker
            path={modelPath}
            busy={locked}
            onChange={(path) => {
              onModelChange(path);
              setModelPicker(false);
            }}
          />
        ) : null}
      </View>
      {temporary ? (
        <ScrollView
          contentContainerStyle={{ padding: 22, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <TempChat
            key={modelKey}
            chat={chat}
            cloudModelLabel={cloudModelLabel}
            busy={busy}
            modelAvailable={modelAvailable}
            onOpenSettings={onOpenSettings}
          />
        </ScrollView>
      ) : project ? (
        <ProjectConversations
          key={project.id}
          projectName={project.repository.fullName}
          projectId={project.id}
          incidentId={`project:${project.id}`}
          connected
          busy={busy}
          generate={generate}
          mode="agent"
          modelAvailable={modelAvailable}
          onOpenSettings={onOpenSettings}
          onWorkingChange={setWorking}
          chatFiles={{
            paths: files.id === project.id ? files.paths : [],
            loading: fileLoading,
            error: fileError,
            truncated: files.truncated,
            refresh: () => setRevision((value) => value + 1),
            prepare: async (paths) => {
              const selected = [...new Set([...project.sourcePaths, ...paths])];
              if (selected.length > 20)
                throw new Error(
                  'This project already has 20 configured files. Remove unused source paths in its workspace first.',
                );
              if (paths.some((path) => !project.sourcePaths.includes(path)))
                await saveProjectSource(project.id, selected);
            },
          }}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', padding: 26, gap: 18 }}>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Text style={ui.title}>Bring a project into the conversation</Text>
              <Text style={ui.body}>
                {error ||
                  'Import a GitHub repository, then chat with its code and incident context.'}
              </Text>
              <Button label="Import a project" onPress={onAddProject} />
            </>
          )}
        </View>
      )}
      <Modal
        visible={picker}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close project picker"
            onPress={() => setPicker(false)}
            style={{ flex: 1 }}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              paddingBottom: 34,
              gap: 18,
              maxHeight: '75%',
            }}
          >
            <View style={ui.between}>
              <Text style={ui.title}>Choose a project</Text>
              <Button label="Done" variant="ghost" onPress={() => setPicker(false)} />
            </View>
            {loading ? <ActivityIndicator color={colors.primary} /> : null}
            {error ? <Text style={ui.body}>{error}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {projects.map((value) => (
                <Pressable
                  key={value.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use project ${value.repository.fullName}`}
                  accessibilityState={{ selected: !temporary && project?.id === value.id }}
                  disabled={locked}
                  onPress={() => {
                    onChangeProject(value);
                    setTemporary(false);
                    setPicker(false);
                  }}
                  style={{
                    paddingVertical: 15,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderBottomWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Icon name="github" size={25} />
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={ui.title}>{value.repository.fullName.split('/').pop()}</Text>
                    <Text style={ui.label}>
                      {value.repository.fullName} ·{' '}
                      {value.repository.private ? 'Private' : 'Public'}
                    </Text>
                  </View>
                  {!temporary && project?.id === value.id ? (
                    <Icon name="check" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
            <Button
              label="Import another project"
              variant="ghost"
              disabled={locked}
              onPress={() => {
                setPicker(false);
                onAddProject();
              }}
            />
            <Button
              label="Temporary chat without a project"
              variant="ghost"
              disabled={locked}
              onPress={() => {
                setTemporary(true);
                setPicker(false);
              }}
            />
            <Text style={ui.label}>
              Each project keeps its own chats. Switching projects restores its latest conversation.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
