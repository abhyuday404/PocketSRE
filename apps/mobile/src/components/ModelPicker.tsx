import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { loadModels, saveModelPath, type SavedModel } from '../settings/model';
import { Button, ui } from './ui';
export function ModelPicker({
  path,
  busy,
  onChange,
}: {
  path?: string;
  busy: boolean;
  onChange: (path: string) => void;
}) {
  const [models, setModels] = useState<SavedModel[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadModels()
      .then((models) => {
        if (active) setModels(models);
      })
      .catch(() => {
        if (active) setError('Could not load imported models.');
      });
    return () => {
      active = false;
    };
  }, [path]);
  const selected = models.find((model) => model.path === path);
  return (
    <View style={{ gap: 8 }}>
      <Button
        label={`Model: ${selected?.name ?? (path ? 'Configured local model' : 'Local rules')}`}
        variant="outline"
        disabled={busy}
        onPress={() => setOpen(!open)}
      />
      {open
        ? models.map((model) => (
            <Button
              key={model.path}
              label={model.name}
              variant="ghost"
              disabled={busy || path === model.path}
              onPress={() => {
                void saveModelPath(model.path)
                  .then(() => {
                    onChange(model.path);
                    setOpen(false);
                  })
                  .catch(() => setError('Could not select that model.'));
              }}
            />
          ))
        : null}
      {open && !models.length ? (
        <Text style={ui.label}>Import GGUF models in Settings to switch between them.</Text>
      ) : null}
      {error ? <Text style={ui.label}>{error}</Text> : null}
    </View>
  );
}
