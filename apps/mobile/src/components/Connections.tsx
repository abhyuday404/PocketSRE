import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { ConnectionSettings } from '../settings/connection';
import { colors } from '../theme';
import { Badge, Button, Card, Icon, ui } from './ui';

export function Connections({
  settings,
  busy,
  onSave,
}: {
  settings: ConnectionSettings;
  busy: boolean;
  onSave: (value: ConnectionSettings) => Promise<void>;
}) {
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState('');
  const [focused, setFocused] = useState<'url' | 'token' | null>(null);
  useEffect(() => {
    setUrl(settings.url);
  }, [settings.url]);
  return (
    <Card>
      <View style={ui.between}>
        <View style={ui.row}>
          <Icon name="server" size={18} />
          <Text style={ui.title}>Gateway connection</Text>
        </View>
        <Badge>Private</Badge>
      </View>
      <Text style={ui.body}>Connect to the gateway running on your computer or server.</Text>
      <View style={styles.field}>
        <Text style={styles.label}>Gateway URL</Text>
        <TextInput
          accessibilityLabel="Gateway URL"
          value={url}
          onChangeText={setUrl}
          onFocus={() => setFocused('url')}
          onBlur={() => setFocused(null)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://127.0.0.1:4100"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.text}
          style={[styles.input, focused === 'url' && styles.focused]}
        />
        <Text style={ui.label}>Use localhost with USB forwarding, or a secure server URL.</Text>
      </View>
      <View style={styles.field}>
        <View style={ui.between}>
          <Text style={styles.label}>Access token</Text>
          <Text style={ui.label}>{settings.token ? 'Token saved' : 'Optional on localhost'}</Text>
        </View>
        <TextInput
          accessibilityLabel="Gateway access token"
          value={token}
          onChangeText={setToken}
          onFocus={() => setFocused('token')}
          onBlur={() => setFocused(null)}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={settings.token ? 'Leave blank to keep saved token' : 'Enter access token'}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.text}
          style={[styles.input, focused === 'token' && styles.focused]}
        />
        <Text style={ui.label}>A saved token is kept only when the URL is unchanged.</Text>
      </View>
      <Button
        label="Save connection"
        disabled={busy}
        onPress={() => {
          void onSave({ url, token: token || (url === settings.url ? settings.token : '') }).then(
            () => setToken(''),
          );
        }}
      />
      {settings.token ? (
        <Button
          label="Remove saved token"
          variant="ghost"
          disabled={busy}
          onPress={() => void onSave({ url, token: '' })}
        />
      ) : null}
    </Card>
  );
}
const styles = StyleSheet.create({
  field: { gap: 7 },
  label: { color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  input: {
    color: colors.text,
    fontSize: 13,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 7,
  },
  focused: { borderColor: colors.text },
});
