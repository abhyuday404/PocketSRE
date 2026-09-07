import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { ConnectionSettings } from '../settings/connection';
import { colors } from '../theme';

export function Connections({
  settings,
  busy,
  onSave,
}: {
  settings: ConnectionSettings;
  busy: boolean;
  onSave: (value: ConnectionSettings) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState('');
  useEffect(() => {
    setUrl(settings.url);
  }, [settings.url]);
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}>
        <Text style={styles.title}>Connections {open ? '−' : '+'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.form}>
          <Text style={styles.label}>Gateway URL</Text>
          <TextInput
            accessibilityLabel="Gateway URL"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          <Text style={styles.label}>
            Access token · blank keeps the token only for the same URL
          </Text>
          <TextInput
            accessibilityLabel="Gateway access token"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
          <Pressable
            disabled={busy}
            style={styles.button}
            onPress={() => {
              void onSave({
                url,
                token: token || (url === settings.url ? settings.token : ''),
              }).then(() => setToken(''));
            }}
          >
            <Text style={styles.buttonText}>Save and connect</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void onSave({ url, token: '' })}>
            <Text style={styles.label}>Remove saved token</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.accent, fontWeight: '700' },
  form: { gap: 10, marginTop: 14 },
  label: { color: colors.textMuted, fontSize: 12 },
  input: {
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: 10,
  },
  button: { backgroundColor: colors.accent, padding: 12, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: colors.black, fontWeight: '700' },
});
