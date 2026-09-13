import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Switch } from 'react-native';
import type { ConnectionSettings } from '../settings/connection';
import { colors } from '../theme';
import { Button, Card, Icon, ui } from './ui';

export function Connections({
  settings,
  busy,
  onSave,
}: {
  settings: ConnectionSettings;
  busy: boolean;
  onSave: (value: ConnectionSettings) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState('');
  const [reuseKey, setReuseKey] = useState(false);
  useEffect(() => {
    setUrl(settings.url);
    setReuseKey(false);
  }, [settings.url]);
  if (!expanded)
    return <Button label="Server connection" variant="ghost" onPress={() => setExpanded(true)} />;
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.title}>Server connection</Text>
        <Icon name="server" size={18} />
      </View>
      <Text style={ui.body}>
        Connect wirelessly to your PC. Keep the PC awake and its tunnel running.
      </Text>
      <View style={styles.field}>
        <Text style={ui.label}>Server URL</Text>
        <TextInput
          accessibilityLabel="Server URL"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setReuseKey(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://your-tunnel.example"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          keyboardAppearance="dark"
          style={styles.input}
        />
      </View>
      <View style={styles.field}>
        <Text style={ui.label}>App access key · stored securely on this phone</Text>
        <TextInput
          accessibilityLabel="Server access key"
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={
            settings.token ? 'Leave blank to keep the key for this address' : 'Enter access key'
          }
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          keyboardAppearance="dark"
          style={styles.input}
        />
      </View>
      {settings.token && url !== settings.url ? (
        <View style={ui.between}>
          <Text style={[ui.body, { flex: 1 }]}>Same PC — use its saved key</Text>
          <Switch
            accessibilityLabel="Use saved key for the same PC"
            value={reuseKey}
            onValueChange={setReuseKey}
          />
        </View>
      ) : null}
      <Button
        label="Save connection"
        disabled={busy}
        onPress={() => {
          void onSave({
            url,
            token: token || (url === settings.url || reuseKey ? settings.token : ''),
          }).then(() => setToken(''));
        }}
      />
      <Button label="Hide connection settings" variant="ghost" onPress={() => setExpanded(false)} />
    </Card>
  );
}
const styles = StyleSheet.create({
  field: { gap: 7 },
  input: {
    color: colors.text,
    fontSize: 13,
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
