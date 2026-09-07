import type { IncidentBundle } from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

export function serializeOfficeKitBundle(bundle: IncidentBundle): string {
  return JSON.stringify(sanitizeBundle(bundle), null, 2);
}

export async function shareIncidentFile(bundle: IncidentBundle): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File sharing is unavailable on this device.');
  const file = new File(Paths.cache, 'pocketsre-incident.json');
  file.create({ overwrite: true });
  file.write(serializeOfficeKitBundle(bundle));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Transfer incident through Office Kit',
  });
}

export async function pickJsonFile(): Promise<unknown | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if ((asset.size ?? file.size) > 2_000_000)
    throw new Error('Incident files must be smaller than 2 MB.');
  return JSON.parse(await file.text()) as unknown;
}
