import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { MODEL_CATALOG, formatBytes, modelSource, type DownloadableModel } from '../models/catalog';
import { modelDownloads } from '../models/deviceDownloads';
import type { DownloadState } from '../models/downloads';
import {
  getModelLibraryRevision,
  loadModels,
  subscribeModelLibrary,
  type SavedModel,
} from '../settings/model';
import { colors } from '../theme';
import { Button, ui } from './ui';

export function ModelCatalog({
  state,
  path,
  disabled,
  onSelect,
  onSaved,
  onImport,
  onRules,
  onError,
}: {
  state: DownloadState;
  path?: string;
  disabled: boolean;
  onSelect: (model: DownloadableModel) => void;
  onSaved: (model: SavedModel) => void;
  onImport: () => void;
  onRules: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>();
  const [saved, setSaved] = useState<SavedModel[]>([]);
  const revision = useSyncExternalStore(subscribeModelLibrary, getModelLibraryRevision);
  useEffect(() => {
    setChoice(undefined);
  }, [path]);
  useEffect(() => {
    let mounted = true;
    void loadModels()
      .then((models) => {
        if (mounted) setSaved(models);
      })
      .catch(() => {
        if (mounted) onError('Could not load saved models.');
      });
    return () => {
      mounted = false;
    };
  }, [path, revision, onError]);
  const current = MODEL_CATALOG.find((item) => !!path && state.installed[item.id] === path);
  const model = MODEL_CATALOG.find(
    (item) => item.id === (state.active?.id ?? choice ?? current?.id),
  );
  const installed = model && state.installed[model.id];
  const selected = !!installed && installed === path;
  const active = state.active;
  const percent =
    model && active
      ? Math.max(0, Math.min(100, Math.floor((active.bytes / model.bytes) * 100)))
      : 0;
  const locked = disabled || !!active || !!state.removing;
  const currentName =
    current?.name ??
    saved.find((item) => item.path === path)?.name ??
    (path ? 'Imported model' : 'Local rules');
  const savedOptions = saved.filter((item) => !Object.values(state.installed).includes(item.path));
  if (path && !current && !savedOptions.some((item) => item.path === path))
    savedOptions.push({ path, name: currentName });
  function row(key: string, name: string, detail: string, action: () => void, checked = false) {
    return (
      <Pressable
        key={key}
        accessibilityRole="menuitem"
        accessibilityLabel={name}
        accessibilityState={{ selected: checked, disabled: locked }}
        disabled={locked}
        onPress={() => {
          setOpen(false);
          action();
        }}
        style={({ pressed }) => ({
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 48,
          backgroundColor: checked || pressed ? colors.muted : 'transparent',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          opacity: locked ? 0.5 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[ui.body, { color: colors.text }]}>{name}</Text>
          <Text style={ui.label}>{detail}</Text>
        </View>
        {checked ? <Text style={{ color: colors.primary }}>✓</Text> : null}
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose on-device model"
        accessibilityState={{ expanded: open, disabled: locked }}
        disabled={locked}
        onPress={() => setOpen(!open)}
        style={{
          borderWidth: 1,
          borderColor: open ? colors.primary : colors.border,
          borderRadius: 12,
          padding: 14,
          minHeight: 52,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: colors.muted,
          opacity: locked ? 0.6 : 1,
        }}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[ui.body, { color: colors.text }]}>{model?.name ?? currentName}</Text>
          <Text style={ui.label}>
            {model
              ? selected
                ? 'Selected · On this phone'
                : installed
                  ? 'On this phone'
                  : formatBytes(model.bytes) + ' · Available to download'
              : path
                ? 'Selected · On this phone'
                : 'No download needed'}
          </Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 18 }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: colors.surface,
          }}
        >
          <ScrollView
            nestedScrollEnabled
            style={{ maxHeight: 320 }}
            keyboardShouldPersistTaps="handled"
          >
            {row(
              'rules',
              'Use local rules',
              'Offline diagnosis · No model needed',
              () => {
                setChoice(undefined);
                onRules();
              },
              !path && !choice,
            )}
            {MODEL_CATALOG.map((item) =>
              row(
                item.id,
                item.name,
                formatBytes(item.bytes) +
                  (item.recommended ? ' · Recommended' : '') +
                  (state.installed[item.id] ? ' · Downloaded' : ''),
                () => setChoice(item.id),
                item.id === model?.id,
              ),
            )}
            {savedOptions.map((item) =>
              row(
                item.path,
                item.name,
                'Imported · On this phone',
                () => {
                  setChoice(undefined);
                  onSaved(item);
                },
                item.path === path,
              ),
            )}
            {row('import', 'Import GGUF model', 'Choose a file from your phone', onImport)}
          </ScrollView>
        </View>
      ) : null}
      {!open && model ? (
        <View style={{ gap: 8 }}>
          <Text style={ui.body}>{model.description}</Text>
          <Text style={ui.label}>{model.memory} · Estimate</Text>
          {active ? (
            <>
              <Text accessibilityLiveRegion="polite" style={ui.body}>
                {active.phase === 'downloading'
                  ? 'Downloading ' +
                    percent +
                    '% · ' +
                    formatBytes(active.bytes) +
                    ' / ' +
                    formatBytes(model.bytes)
                  : active.phase === 'verifying'
                    ? 'Verifying download ' + percent + '%'
                    : active.phase === 'saving'
                      ? 'Saving model…'
                      : active.phase === 'cancelling'
                        ? 'Cancelling…'
                        : 'Preparing download…'}
              </Text>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={model.name + ' ' + active.phase}
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                style={{
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: colors.muted,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{ height: '100%', width: `${percent}%`, backgroundColor: colors.primary }}
                />
              </View>
              <Button
                label="Cancel download"
                variant="ghost"
                onPress={modelDownloads.cancel}
                disabled={active.phase === 'saving' || active.phase === 'cancelling'}
              />
            </>
          ) : installed ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button
                label={selected ? model.name + ' selected' : 'Use ' + model.name}
                disabled={locked || selected}
                onPress={() => onSelect(model)}
              />
              <Button
                label={'Remove ' + model.name}
                variant="ghost"
                disabled={locked || selected}
                onPress={() => void modelDownloads.remove(model.id, path)}
              />
            </View>
          ) : (
            <>
              <Text style={ui.label}>Use Wi-Fi and keep the app open while downloading.</Text>
              <Button
                label={'Download ' + model.name}
                icon="download"
                disabled={locked || !state.ready}
                onPress={() => void modelDownloads.download(model.id)}
              />
            </>
          )}
          <Text
            accessibilityRole="link"
            style={[ui.label, { color: colors.primary }]}
            onPress={() =>
              void Linking.openURL(modelSource(model)).catch(() =>
                onError('Could not open the model source.'),
              )
            }
          >
            {model.license} · Source & license
          </Text>
        </View>
      ) : !open ? (
        <Text style={ui.label}>Choose a model to download, or import your own GGUF file.</Text>
      ) : null}
      {!state.ready ? (
        <Button
          label="Reload model storage"
          variant="ghost"
          onPress={() => void modelDownloads.initialize()}
        />
      ) : null}
      {state.error || state.message ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {state.error || state.message}
        </Text>
      ) : null}
    </View>
  );
}
