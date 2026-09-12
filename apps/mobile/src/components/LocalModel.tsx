import { useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { saveModelPath } from '../settings/model';
import { Badge, Button, Card, ui } from './ui';

export function LocalModel({
  path,
  busy,
  onChange,
}: {
  path?: string;
  busy: boolean;
  onChange: (path: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  async function choose() {
    setWorking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (!asset.name.toLowerCase().endsWith('.gguf')) throw new Error('Choose a GGUF model file.');
      const source = new File(asset.uri);
      if (!source.exists || source.size < 4) throw new Error('The selected model is empty.');
      const handle = source.open();
      try {
        if (Array.from(handle.readBytes(4)).join(',') !== '71,71,85,70')
          throw new Error('The selected file is not a GGUF model.');
      } finally {
        handle.close();
      }
      const model = new File(Paths.document, `pocketsre-model-${Date.now()}.gguf`);
      source.move(model);
      await saveModelPath(model.uri);
      onChange(model.uri);
      setMessage('Model imported. The next analysis loads it on this phone.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import the model.');
    } finally {
      setWorking(false);
    }
  }
  return (
    <Card>
      <Text style={ui.title}>On-device model</Text>
      <Badge>{path ? 'Model selected' : 'Local rules'}</Badge>
      <Text style={ui.body}>
        A GGUF file contains the AI model’s weights. Import a compatible model to analyze evidence
        and draft small code fixes offline. GitHub operations still need a connection.
      </Text>
      <Text style={ui.label}>
        The file is copied into app storage. Model size and available phone memory determine whether
        it can run. Models are never uploaded to GitHub.
      </Text>
      <Button
        label={working ? 'Importing model…' : 'Import GGUF model'}
        disabled={busy || working}
        onPress={() => void choose()}
      />
      {path ? (
        <Button
          label="Use local rules"
          variant="outline"
          disabled={busy || working}
          onPress={() => {
            void saveModelPath('')
              .then(() => {
                onChange('');
                setMessage(
                  'Rule-based diagnosis enabled. Imported model files remain in app storage.',
                );
              })
              .catch(() => setMessage('Could not save the model setting.'));
          }}
        />
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
