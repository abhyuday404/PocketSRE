import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { rememberModel, saveModelPath, type SavedModel } from '../settings/model';
import { deviceModelStorage, modelDownloads } from '../models/deviceDownloads';
import type { DownloadableModel } from '../models/catalog';
import { ModelCatalog } from './ModelCatalog';
import { Card, ui } from './ui';

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
  const operation = useRef(false);
  const downloads = useSyncExternalStore(modelDownloads.subscribe, modelDownloads.getSnapshot);
  const locked = busy || working || !!downloads.active || !!downloads.removing;
  useEffect(() => {
    void modelDownloads.initialize();
  }, []);
  async function select(model: DownloadableModel) {
    if (locked || operation.current) return;
    operation.current = true;
    setWorking(true);
    setMessage('');
    try {
      if (!deviceModelStorage.installed(model))
        throw new Error(
          'The model file is missing or incomplete. Restart the app to download it again.',
        );
      const modelPath = deviceModelStorage.path(model);
      await rememberModel(modelPath, model.name);
      await saveModelPath(modelPath);
      onChange(modelPath);
      setMessage(`${model.name} selected. The next request loads it on this phone.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not select the model.');
    } finally {
      operation.current = false;
      setWorking(false);
    }
  }
  async function choose() {
    if (locked || operation.current) return;
    operation.current = true;
    setWorking(true);
    setMessage('');
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
      await source.move(model);
      await rememberModel(model.uri, asset.name);
      await saveModelPath(model.uri);
      onChange(model.uri);
      setMessage('Model imported. The next analysis loads it on this phone.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import the model.');
    } finally {
      operation.current = false;
      setWorking(false);
    }
  }
  async function selectSaved(model: SavedModel) {
    if (locked || operation.current) return;
    operation.current = true;
    setWorking(true);
    setMessage('');
    try {
      if (model.path && !new File(model.path).exists)
        throw new Error('The saved model file is missing. Import or download it again.');
      await saveModelPath(model.path);
      onChange(model.path);
      setMessage(
        model.path
          ? model.name + ' selected.'
          : 'Local rules enabled. Your models remain on this phone.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the model setting.');
    } finally {
      operation.current = false;
      setWorking(false);
    }
  }
  return (
    <Card>
      <Text style={ui.title}>On-device model</Text>
      <ModelCatalog
        state={downloads}
        path={path}
        disabled={busy || working}
        onSelect={(model) => void select(model)}
        onSaved={(model) => void selectSaved(model)}
        onImport={() => void choose()}
        onRules={() => void selectSaved({ path: '', name: 'Local rules' })}
        onError={setMessage}
      />
      {working ? <Text style={ui.label}>Updating model…</Text> : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
