import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { readChats, saveChat, type ChatSnapshot, type SavedChat } from '../storage/chats';
import { FixHarness } from './FixHarness';
import { Button, Icon, ui } from './ui';
import { colors } from '../theme';
const fresh = (): SavedChat => ({
  id: randomUUID(),
  title: 'New chat',
  updatedAt: new Date().toISOString(),
  conversation: [],
  request: '',
  paths: [],
});
export function ProjectConversations(
  props: ComponentProps<typeof FixHarness> & { projectName: string },
) {
  const scope = JSON.stringify([props.projectId, props.projectName]);
  return <Conversations key={scope} {...props} scope={scope} />;
}
function Conversations({
  scope,
  projectName,
  ...props
}: ComponentProps<typeof FixHarness> & { scope: string; projectName: string }) {
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [active, setActive] = useState<SavedChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState(false);
  const mounted = useRef(true);
  const current = useRef<SavedChat | null>(null);
  const pending = useRef(new Map<string, SavedChat>());
  const latest = useRef(new Map<string, SavedChat>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const values = [...pending.current.values()];
    pending.current.clear();
    for (const value of values) {
      try {
        await saveChat(scope, value);
        if (mounted.current && !pending.current.size) setError('');
      } catch (e) {
        if (!pending.current.has(value.id))
          pending.current.set(value.id, latest.current.get(value.id) ?? value);
        if (mounted.current) setError(e instanceof Error ? e.message : 'Could not save this chat.');
      }
    }
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const values = await readChats(scope);
      if (!mounted.current) return;
      setChats(values);
      const selected = values[0] ?? fresh();
      current.current = selected;
      setActive(selected);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not load chats.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      void flush();
    };
  }, []);
  function change(snapshot: ChatSnapshot) {
    if (!current.current) return;
    if (
      !snapshot.conversation.length &&
      !snapshot.request.trim() &&
      !current.current.conversation.length &&
      !current.current.request.trim()
    )
      return;
    if (
      JSON.stringify(snapshot) ===
      JSON.stringify({
        conversation: current.current.conversation,
        request: current.current.request,
        paths: current.current.paths,
      })
    )
      return;
    const first = snapshot.conversation.find((t) => t.role === 'user')?.content ?? snapshot.request;
    const value = {
      ...current.current,
      ...snapshot,
      title: first.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New chat',
      updatedAt: new Date().toISOString(),
    };
    current.current = value;
    setChats((old) => [value, ...old.filter((c) => c.id !== value.id)]);
    pending.current.set(value.id, value);
    latest.current.set(value.id, value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 350);
  }
  function select(value: SavedChat) {
    if (working || props.busy) return;
    void flush();
    current.current = value;
    setActive(value);
    setDrawer(false);
    setQuery('');
  }
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (!active)
    return (
      <View style={{ padding: 22, gap: 12 }}>
        <Text style={ui.body}>{error}</Text>
        <Button label="Retry chat history" onPress={() => void load()} />
      </View>
    );
  const visible = chats.filter((c) =>
    `${c.title} ${c.conversation.map((t) => t.content).join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          paddingHorizontal: 22,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open project chat history"
          disabled={working || props.busy}
          onPress={() => setDrawer(true)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
        >
          <Icon name="clock" size={19} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={ui.body}>
              {chats.find((c) => c.id === active.id)?.title ?? active.title}
            </Text>
            <Text style={ui.label}>Chat history · {chats.length}</Text>
          </View>
          <Icon name="chevron" size={14} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start new project chat"
          disabled={working || props.busy}
          onPress={() => select(fresh())}
          style={{ padding: 12 }}
        >
          <Text style={{ color: colors.primary, fontSize: 25 }}>＋</Text>
        </Pressable>
      </View>
      {error ? (
        <View style={{ paddingHorizontal: 22 }}>
          <Text accessibilityRole="alert" style={ui.body}>
            {error}
          </Text>
          <Button label="Retry saving chat" variant="ghost" onPress={() => void flush()} />
        </View>
      ) : null}
      <FixHarness
        {...props}
        key={active.id}
        onWorkingChange={(value) => {
          setWorking(value);
          props.onWorkingChange?.(value);
        }}
        chatSession={{ initial: active, onChange: change, onNew: () => select(fresh()) }}
      />
      <Modal
        visible={drawer}
        transparent
        animationType="slide"
        onRequestClose={() => setDrawer(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chat history"
            onPress={() => setDrawer(false)}
            style={{ flex: 1 }}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              paddingBottom: 36,
              gap: 16,
              maxHeight: '85%',
            }}
          >
            <View style={ui.between}>
              <Text style={ui.title}>Your chats</Text>
              <Button label="Done" variant="ghost" onPress={() => setDrawer(false)} />
            </View>
            <Text style={ui.body}>{projectName}</Text>
            <TextInput
              accessibilityLabel="Search project chats"
              placeholder="Search this project's conversations"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              style={{
                color: colors.text,
                backgroundColor: colors.muted,
                padding: 14,
                borderRadius: 14,
              }}
            />
            <Button label="New chat" onPress={() => select(fresh())} />
            <ScrollView keyboardShouldPersistTaps="handled">
              {!visible.length ? (
                <Text style={ui.body}>
                  {query
                    ? 'No matching chats in this project.'
                    : 'Your conversations will appear here after you start chatting.'}
                </Text>
              ) : null}
              {visible.map((item, index) => {
                const day = new Date(item.updatedAt).toDateString();
                const previousDay = visible[index - 1]
                  ? new Date(visible[index - 1]!.updatedAt).toDateString()
                  : null;
                return (
                  <View key={item.id}>
                    {day !== previousDay ? (
                      <Text style={[ui.label, { paddingTop: 18, paddingBottom: 8 }]}>
                        {day === new Date().toDateString()
                          ? 'Today'
                          : new Date(item.updatedAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open chat ${item.title}`}
                      accessibilityState={{ selected: item.id === active.id }}
                      onPress={() => select(item)}
                      style={{
                        padding: 14,
                        gap: 6,
                        borderRadius: 16,
                        backgroundColor: item.id === active.id ? colors.muted : 'transparent',
                      }}
                    >
                      <Text numberOfLines={2} style={ui.body}>
                        {item.title}
                      </Text>
                      <Text numberOfLines={1} style={ui.label}>
                        {item.conversation.at(-1)?.content ?? 'Draft message'}
                      </Text>
                      <Text style={ui.label}>
                        {item.conversation.length} messages
                        {item.id === active.id ? ' · Current chat' : ''}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
            <Text style={ui.label}>
              Saved on this phone, only for this project. Reopened chats require fresh review before
              publishing changes.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
