import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AI_PROVIDERS, normalizeCloudModel, providerIds, type ProviderId } from '../ai/providers';
import { CloudTriageEngine } from '../ai/CloudTriageEngine';
import {
  loadCloudCredential,
  removeCloudKey,
  saveCloudAI,
  useLocalAI,
  type AISettings as Settings,
} from '../settings/ai';
import { colors } from '../theme';
import { Badge, Button, Card, ui } from './ui';
import { LocalModel } from './LocalModel';

export function AISettings({
  settings,
  path,
  busy,
  onChange,
  onModelChange,
}: {
  settings: Settings;
  path?: string;
  busy: boolean;
  onChange: (settings: Settings) => void;
  onModelChange: (path: string) => void;
}) {
  const [pane, setPane] = useState(settings.source);
  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const testEngine = useRef<CloudTriageEngine | null>(null);
  const profile = settings.profiles[provider];
  const disabled = busy || working;
  useEffect(() => {
    setModel(profile?.model ?? '');
    setBaseUrl(profile?.baseUrl ?? AI_PROVIDERS[provider].baseUrl);
    setApiKey('');
    setMessage('');
  }, [provider, profile]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void testEngine.current?.release();
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy || lock.current) return;
    lock.current = true;
    setWorking(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not update AI settings.');
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <>
      <Card>
        <View style={ui.between}>
          <Text style={ui.title}>AI model</Text>
          <Badge>{settings.source === 'cloud' ? 'Cloud API' : 'On-device'}</Badge>
        </View>
        <Text style={ui.body}>
          {settings.source === 'cloud'
            ? `Active: ${AI_PROVIDERS[settings.provider].name} · ${settings.profiles[settings.provider]?.model}`
            : 'Active: your selected local model, or local rules when no model is selected.'}
        </Text>
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          <Button
            label="On-device models"
            variant={pane === 'local' ? 'primary' : 'outline'}
            disabled={disabled}
            onPress={() => setPane('local')}
          />
          <Button
            label="Use an API key"
            variant={pane === 'cloud' ? 'primary' : 'outline'}
            disabled={disabled}
            onPress={() => setPane('cloud')}
          />
        </View>
        {pane === 'local' ? (
          <>
            <Text style={ui.body}>
              Run on this phone without an API key or per-request charges. Downloaded models stay
              available when you switch.
            </Text>
            {settings.source === 'cloud' ? (
              <Button
                label="Switch to on-device"
                disabled={disabled}
                onPress={() =>
                  void run(async () => {
                    const next = await useLocalAI();
                    onChange(next);
                  })
                }
              />
            ) : null}
          </>
        ) : (
          <>
            <Text style={ui.body}>
              Choose a provider and a text model available to your API account. Keys cannot be
              detected reliably from their format.
            </Text>
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              {providerIds.map((id) => (
                <Button
                  key={id}
                  label={AI_PROVIDERS[id].name}
                  variant={provider === id ? 'primary' : 'outline'}
                  disabled={disabled}
                  onPress={() => setProvider(id)}
                />
              ))}
            </View>
            {provider === 'compatible' ? (
              <>
                <Text style={ui.label}>HTTPS API base URL</Text>
                <TextInput
                  accessibilityLabel="AI API base URL"
                  value={baseUrl}
                  onChangeText={setBaseUrl}
                  editable={!disabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://your-provider.example/v1"
                  placeholderTextColor={colors.textMuted}
                  style={input}
                />
                <Text style={ui.label}>
                  For providers with an OpenAI-compatible Chat Completions API. Include the API
                  version path. Changing the endpoint requires entering its key again.
                </Text>
              </>
            ) : (
              <Text style={ui.label}>{AI_PROVIDERS[provider].baseUrl}</Text>
            )}
            <Text style={ui.label}>Model ID</Text>
            <TextInput
              accessibilityLabel="API model ID"
              value={model}
              onChangeText={setModel}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
              placeholder="Copy a model ID from your provider"
              placeholderTextColor={colors.textMuted}
              style={input}
            />
            <Text style={ui.label}>API key{profile?.hasKey ? ' · Saved securely' : ''}</Text>
            <TextInput
              accessibilityLabel="AI provider API key"
              value={apiKey}
              onChangeText={setApiKey}
              editable={!disabled}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={4096}
              placeholder={
                profile?.hasKey
                  ? 'Leave blank to keep this endpoint’s saved key'
                  : 'Enter your provider API key'
              }
              placeholderTextColor={colors.textMuted}
              style={input}
            />
            <Text style={ui.body}>
              Using an API sends chat messages, relevant incident evidence, and selected source
              files directly to this provider. Its data policies and API charges apply. Keys are
              stored securely on this phone and are never sent to the PocketSRE gateway.
            </Text>
            <Button
              label="Save and use API model"
              disabled={disabled}
              onPress={() =>
                void run(async () => {
                  const next = await saveCloudAI({ provider, model, baseUrl }, apiKey);
                  if (!mounted.current) return;
                  setApiKey('');
                  onChange(next);
                })
              }
            />
            <Button
              label="Test saved API model"
              variant="outline"
              disabled={
                disabled ||
                !profile?.hasKey ||
                settings.source !== 'cloud' ||
                settings.provider !== provider ||
                !!apiKey ||
                model !== profile.model ||
                baseUrl !== profile.baseUrl
              }
              onPress={() =>
                void run(async () => {
                  const selected = normalizeCloudModel({ provider, model, baseUrl });
                  const engine = new CloudTriageEngine(selected, loadCloudCredential);
                  testEngine.current = engine;
                  try {
                    await engine.testConnection();
                    if (mounted.current) setMessage('Connected. This model returned a response.');
                  } finally {
                    await engine.release();
                    testEngine.current = null;
                  }
                })
              }
            />
            <Text style={ui.label}>
              Testing sends a small “Reply with OK” request and may incur an API charge. Saving
              alone sends no request.
            </Text>
            {profile?.hasKey ? (
              <Button
                label="Remove saved API key"
                variant="ghost"
                disabled={disabled}
                onPress={() =>
                  void run(async () => {
                    const next = await removeCloudKey(provider);
                    setApiKey('');
                    onChange(next);
                  })
                }
              />
            ) : null}
          </>
        )}
        {working ? <Text style={ui.label}>Working…</Text> : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        ) : null}
      </Card>
      {pane === 'local' ? (
        <LocalModel
          path={path}
          busy={disabled || settings.source !== 'local'}
          onChange={onModelChange}
        />
      ) : null}
    </>
  );
}
const input = {
  color: colors.text,
  backgroundColor: colors.muted,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 12,
  padding: 14,
  fontSize: 15,
  minHeight: 48,
};
