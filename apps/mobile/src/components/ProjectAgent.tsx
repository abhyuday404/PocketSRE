import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { FixContext, FixProposal, TrackedProject } from '@pocketsre/contracts';
import { saveProjectSource } from '../api/gateway';
import { Badge, Button, Card, ui } from './ui';
import { FixHarness } from './FixHarness';
import { ModelPicker } from './ModelPicker';
import { colors } from '../theme';
export function ProjectAgent({
  project,
  busy,
  generate,
  modelPath,
  onModelChange,
  onOpenSettings,
  onChangeProject,
}: {
  project: TrackedProject;
  busy: boolean;
  generate: (context: FixContext) => Promise<FixProposal>;
  modelPath?: string;
  onModelChange: (path: string) => void;
  onOpenSettings: () => void;
  onChangeProject: () => void;
}) {
  const [current, setCurrent] = useState(project);
  const [paths, setPaths] = useState(project.sourcePaths.join('\n'));
  const [editing, setEditing] = useState(!project.sourcePaths.length);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <>
      <Card>
        <Badge>{current.repository.fullName}</Badge>
        <Text style={ui.title}>What would you like to build?</Text>
        <Text style={ui.body}>
          Ask about this project, investigate an incident, or request a feature. Proposed changes
          stay in review until you approve a pull request.
        </Text>
        <ModelPicker path={modelPath} busy={busy || saving} onChange={onModelChange} />
        <Button
          label="Switch project"
          variant="ghost"
          disabled={busy || saving}
          onPress={onChangeProject}
        />
        <Button
          label="Choose source files"
          variant="outline"
          disabled={busy || saving}
          onPress={() => setEditing(!editing)}
        />
        {editing ? (
          <>
            <Text style={ui.label}>
              Existing repository paths, one per line. Configure up to 20, then select up to three
              per request.
            </Text>
            <TextInput
              accessibilityLabel="Project source paths"
              multiline
              value={paths}
              onChangeText={setPaths}
              editable={!busy && !saving}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                color: colors.text,
                minHeight: 100,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
              }}
            />
            <Button
              label="Save source selection"
              disabled={busy || saving || !paths.trim()}
              onPress={() => {
                setSaving(true);
                void saveProjectSource(
                  current.id,
                  paths
                    .split(/[\n,]/)
                    .map((p) => p.trim())
                    .filter(Boolean),
                )
                  .then((value) => {
                    setCurrent(value);
                    setEditing(false);
                    setNotice('Source selection saved.');
                  })
                  .catch((error) => setNotice(error.message))
                  .finally(() => setSaving(false));
              }}
            />
          </>
        ) : null}
        {notice ? <Text style={ui.label}>{notice}</Text> : null}
      </Card>
      <FixHarness
        key={`${current.id}:${current.sourcePaths.join(',')}:${modelPath ?? ''}`}
        projectId={current.id}
        incidentId={`project:${current.id}`}
        connected={true}
        busy={busy || saving}
        generate={generate}
        mode="agent"
        modelAvailable={!!modelPath}
        onOpenSettings={onOpenSettings}
      />
    </>
  );
}
