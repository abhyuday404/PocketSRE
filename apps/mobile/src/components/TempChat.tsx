import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { ChatCompletion, ChatMessage } from '../ai/LocalTriageEngine';
import { Badge, Button, Card, ui } from './ui';
import { colors } from '../theme';

export function TempChat({
  chat,
  busy,
  modelAvailable,
  onOpenSettings,
}: {
  chat: ChatCompletion;
  busy: boolean;
  modelAvailable: boolean;
  onOpenSettings: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [partial, setPartial] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  async function send() {
    if (controller.current || busy || !modelAvailable || !input.trim()) return;
    const request = input;
    const prior = messages;
    const next: ChatMessage[] = [...messages, { role: 'user', content: request }];
    const abort = new AbortController();
    controller.current = abort;
    setWorking(true);
    setMessages(next);
    setInput('');
    setPartial('');
    setNotice('Loading the model and reading your message…');
    let streamed = '';
    try {
      const result = await chat(
        next,
        (token) => {
          streamed += token;
          if (mounted.current) {
            setPartial(streamed);
            setNotice('Generating on this phone…');
          }
        },
        abort.signal,
      );
      if (!mounted.current) return;
      const text = result.text || streamed;
      if (!text.trim()) throw new Error('The model returned no text. Try another message.');
      setMessages([...next, { role: 'assistant', content: text }]);
      setNotice(
        abort.signal.aborted
          ? 'Stopped.'
          : result.limited
            ? 'Reply reached the model output limit. Send “continue” for more.'
            : 'Finished on this phone.',
      );
    } catch (error) {
      if (!mounted.current) return;
      if (streamed) setMessages([...next, { role: 'assistant', content: streamed }]);
      else {
        setMessages(prior);
        setInput(request);
      }
      setNotice(
        abort.signal.aborted
          ? 'Stopped.'
          : error instanceof Error
            ? error.message
            : 'Chat failed. Try again.',
      );
    } finally {
      controller.current = null;
      if (mounted.current) {
        setWorking(false);
        setPartial('');
      }
    }
  }

  return (
    <>
      <Card>
        <Text style={ui.title}>Temporary model chat</Text>
        <Badge>On this phone · session only</Badge>
        <Text style={ui.body}>
          Talk directly to your imported model. No repository, gateway, evidence citations, or
          structured answers required.
        </Text>
        <Text style={ui.label}>
          No app-added system prompt. Messages stay in memory until you clear chat, change models,
          or restart the app. This chat has no tools or repository access.
        </Text>
        {!modelAvailable ? (
          <Button
            label="Import a model in Settings"
            variant="outline"
            disabled={busy}
            onPress={onOpenSettings}
          />
        ) : null}
      </Card>
      {messages.map((message, index) => (
        <Card key={index}>
          <Badge>{message.role === 'user' ? 'You' : 'Local model'}</Badge>
          <Text selectable style={ui.body}>
            {message.content}
          </Text>
        </Card>
      ))}
      {working ? (
        <Card>
          <Badge>Local model</Badge>
          <Text selectable style={ui.body}>
            {partial || 'Thinking…'}
          </Text>
        </Card>
      ) : null}
      <Card>
        <TextInput
          accessibilityLabel="Temporary chat message"
          placeholder="Ask the model anything…"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          value={input}
          onChangeText={setInput}
          editable={!busy && !working}
          style={{
            minHeight: 110,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            backgroundColor: colors.muted,
            color: colors.text,
            padding: 14,
            fontSize: 14,
          }}
        />
        <View style={ui.row}>
          {working ? (
            <Button
              label="Stop generating"
              variant="outline"
              onPress={() => {
                controller.current?.abort();
                setNotice('Stopping…');
              }}
            />
          ) : (
            <Button
              label="Send message"
              disabled={busy || !modelAvailable || !input.trim()}
              onPress={() => void send()}
            />
          )}
          <Button
            label="Clear chat"
            variant="ghost"
            disabled={busy || working || (!messages.length && !input)}
            onPress={() => {
              setMessages([]);
              setInput('');
              setNotice('Chat cleared.');
            }}
          />
        </View>
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={ui.label}>
            {notice}
          </Text>
        ) : null}
      </Card>
    </>
  );
}
