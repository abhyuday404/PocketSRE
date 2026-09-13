import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { Button } from './ui';

type ConfirmationAction = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};
type Confirmation = { title: string; message: string; actions: ConfirmationAction[] };
type ShowConfirmation = (
  title: string,
  message: string,
  actions: ConfirmationAction[],
) => () => void;

const ConfirmationContext = createContext<ShowConfirmation | null>(null);

export function ConfirmationProvider({ children }: PropsWithChildren) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef<Confirmation | null>(null);

  const show = useCallback<ShowConfirmation>((title, message, actions) => {
    // Keep the approval already on screen intact if another request arrives.
    if (pending.current) return () => {};
    const next = { title, message, actions };
    pending.current = next;
    Keyboard.dismiss();
    setConfirmation(next);
    return () => {
      if (pending.current !== next) return;
      pending.current = null;
      setConfirmation(null);
    };
  }, []);

  function choose(action?: ConfirmationAction) {
    // Clear synchronously so repeated taps cannot execute the action twice.
    if (!confirmation || pending.current !== confirmation) return;
    pending.current = null;
    setConfirmation(null);
    action?.onPress?.();
  }
  const cancel = () => choose(confirmation?.actions.find((action) => action.style === 'cancel'));

  return (
    <ConfirmationContext.Provider value={show}>
      {children}
      {confirmation ? (
        <Modal transparent animationType="fade" visible onRequestClose={cancel}>
          <View style={styles.overlay}>
            <Pressable
              testID="confirmation-backdrop"
              accessible={false}
              importantForAccessibility="no"
              style={StyleSheet.absoluteFill}
              onPress={cancel}
            />
            <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
              <View accessibilityViewIsModal onAccessibilityEscape={cancel} style={styles.dialog}>
                <ScrollView bounces={false} contentContainerStyle={styles.content}>
                  <View style={styles.accent} />
                  <Text accessibilityRole="header" style={styles.title}>
                    {confirmation.title}
                  </Text>
                  <Text selectable style={styles.message}>
                    {confirmation.message}
                  </Text>
                  <View style={styles.actions}>
                    {confirmation.actions.map((action, index) => (
                      <Button
                        key={index}
                        label={action.text}
                        variant={action.style === 'cancel' ? 'outline' : 'primary'}
                        style={[
                          styles.button,
                          action.style === 'destructive' && styles.destructive,
                        ]}
                        onPress={() => choose(action)}
                      />
                    ))}
                  </View>
                </ScrollView>
              </View>
            </SafeAreaView>
          </View>
        </Modal>
      ) : null}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation() {
  const show = useContext(ConfirmationContext);
  const dismiss = useRef<(() => void) | null>(null);
  useEffect(() => () => dismiss.current?.(), []);
  if (!show) throw new Error('useConfirmation requires ConfirmationProvider');
  return useCallback<ShowConfirmation>(
    (title, message, actions) => {
      dismiss.current?.();
      const close = show(title, message, actions);
      dismiss.current = close;
      return close;
    },
    [show],
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
  safeArea: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 24,
    overflow: 'hidden',
  },
  content: { padding: 24, gap: 18 },
  accent: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.primary },
  title: { color: colors.text, fontSize: 22, lineHeight: 29, fontWeight: '600' },
  message: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 6 },
  button: { flexGrow: 1, flexBasis: 140, minHeight: 48 },
  destructive: { backgroundColor: colors.danger, borderColor: colors.danger },
});
