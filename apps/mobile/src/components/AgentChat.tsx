import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { AgentTask } from '@pocketsre/contracts';
import { colors } from '../theme';
import { Button, Icon, ui } from './ui';
import { activeMention, attachMention, removeMention } from './agentMentions';

export type AgentChatFiles = {
  paths: string[];
  loading: boolean;
  error: string;
  truncated: boolean;
  refresh: () => void;
  prepare: (paths: string[]) => Promise<void>;
};
export function AgentChat({
  files,
  request,
  onRequest,
  paths,
  onPaths,
  conversation,
  activeRequest,
  working,
  disabled,
  modelAvailable,
  onOpenSettings,
  review,
  hasDraft,
  message,
  onSend,
  onNew,
}: {
  files: AgentChatFiles;
  request: string;
  onRequest: (text: string) => void;
  paths: string[];
  onPaths: (paths: string[]) => void;
  conversation: AgentTask['history'];
  activeRequest: string;
  working: boolean;
  disabled: boolean;
  modelAvailable: boolean;
  onOpenSettings?: () => void;
  review: ReactNode;
  hasDraft: boolean;
  message: string;
  onSend: () => void;
  onNew: () => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const [cursor, setCursor] = useState(request.length);
  const [viewportHeight, setViewportHeight] = useState(600);
  const mention = activeMention(request, Math.min(cursor, request.length));
  const matches = files.paths
    .filter(
      (path) =>
        !paths.includes(path) && path.toLowerCase().includes(mention?.query.toLowerCase() ?? ''),
    )
    .slice(0, 30);
  function edit(text: string) {
    setCursor(text.length);
    onRequest(text);
  }
  function attach(path: string) {
    if (paths.length >= 3) return;
    const next = attachMention(request, path, cursor);
    onPaths([...paths, path]);
    edit(next);
    input.current?.focus();
  }
  const canSend = !disabled && modelAvailable && !!request.trim() && paths.length > 0 && !hasDraft;
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: 20,
          paddingBottom: 20,
          gap: 22,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (conversation.length || activeRequest) scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        {!conversation.length && !activeRequest ? (
          <View style={{ flex: 1, justifyContent: 'center', gap: 20, paddingBottom: 28 }}>
            <Icon name="bot" size={36} color={colors.primary} />
            <Text
              style={{
                color: colors.text,
                fontSize: 30,
                lineHeight: 37,
                fontWeight: '500',
                letterSpacing: -0.8,
              }}
            >
              What are we working on?
            </Text>
            <Text style={ui.body}>
              Understand your code, investigate an incident, or shape your next change.
            </Text>
            {['Explain this code', 'Investigate a problem', 'Plan an improvement'].map(
              (label, index) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  disabled={disabled}
                  onPress={() => {
                    edit(
                      [
                        'Explain how this file works: @',
                        'Help me investigate a problem in @',
                        'Suggest improvements to @',
                      ][index]!,
                    );
                    input.current?.focus();
                  }}
                  style={{
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderColor: colors.border,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={ui.body}>{label}</Text>
                  <Icon name="arrow" size={17} color={colors.textMuted} />
                </Pressable>
              ),
            )}
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              disabled={disabled || hasDraft}
              onPress={onNew}
              style={{ alignSelf: 'flex-end', padding: 8 }}
            >
              <Text style={ui.label}>New chat ＋</Text>
            </Pressable>
            {conversation.map((turn, index) => (
              <View
                key={index}
                style={
                  turn.role === 'user'
                    ? {
                        alignSelf: 'flex-end',
                        maxWidth: '88%',
                        padding: 15,
                        borderRadius: 22,
                        backgroundColor: colors.muted,
                      }
                    : { gap: 12, paddingVertical: 4 }
                }
              >
                {turn.role === 'assistant' ? (
                  <Icon name="bot" size={20} color={colors.primary} />
                ) : null}
                <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 24 }}>
                  {turn.content}
                </Text>
              </View>
            ))}
            {activeRequest ? (
              <View
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '88%',
                  padding: 15,
                  borderRadius: 22,
                  backgroundColor: colors.muted,
                }}
              >
                <Text style={ui.body}>{activeRequest}</Text>
              </View>
            ) : null}
            {working ? (
              <View style={ui.row}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={ui.label}>Thinking…</Text>
              </View>
            ) : null}
          </>
        )}
        {review}
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8 }}>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={[ui.label, { paddingHorizontal: 6 }]}>
            {message}
          </Text>
        ) : null}
        {!modelAvailable ? (
          <View style={{ gap: 4 }}>
            <Text style={ui.label}>Choose a local or API model in Settings to start chatting.</Text>
            <Button label="Choose a model" variant="ghost" onPress={() => onOpenSettings?.()} />
          </View>
        ) : null}
        {mention && !hasDraft ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 12,
              maxHeight: Math.max(90, Math.min(230, viewportHeight - 230)),
              gap: 8,
            }}
          >
            <View style={ui.between}>
              <Text style={ui.label}>Source files · {paths.length}/3</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh file list"
                onPress={files.refresh}
              >
                <Icon name="refresh" size={16} />
              </Pressable>
            </View>
            {files.loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : files.error ? (
              <Text style={ui.body}>{files.error}</Text>
            ) : paths.length >= 3 ? (
              <Text style={ui.body}>Remove an attachment to choose another file.</Text>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {matches.map((path) => (
                  <Pressable
                    key={path}
                    accessibilityRole="button"
                    accessibilityLabel={`Attach ${path}`}
                    onPress={() => attach(path)}
                    style={{
                      paddingVertical: 10,
                      gap: 3,
                      borderBottomWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 14 }}>
                      {path.split('/').pop()}
                    </Text>
                    <Text numberOfLines={1} style={ui.label}>
                      {path}
                    </Text>
                  </Pressable>
                ))}
                {!matches.length ? <Text style={ui.body}>No matching source files.</Text> : null}
              </ScrollView>
            )}
            <Text style={ui.label}>Small regular files · up to 12 KB of source per request.</Text>
            {files.truncated ? (
              <Text style={ui.label}>Showing part of this repository’s file list.</Text>
            ) : null}
          </View>
        ) : null}
        <View
          style={{
            backgroundColor: colors.muted,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 26,
            padding: 14,
            gap: 10,
          }}
        >
          {paths.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {paths.map((path) => (
                <Pressable
                  key={path}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove attachment ${path}`}
                  disabled={disabled || hasDraft}
                  onPress={() => {
                    onPaths(paths.filter((p) => p !== path));
                    edit(removeMention(request, path));
                  }}
                  style={{
                    maxWidth: '100%',
                    borderWidth: 1,
                    borderColor: colors.accentBorder,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 12,
                  }}
                >
                  <Text numberOfLines={1} style={ui.label}>
                    {path.split('/').pop()} ×
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput
            ref={input}
            accessibilityLabel="Agent request"
            placeholder="Message your project… use @ for files"
            placeholderTextColor={colors.textMuted}
            value={request}
            onChangeText={edit}
            onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
            multiline
            textAlignVertical="top"
            maxLength={2000}
            editable={!disabled && !hasDraft}
            style={{
              color: colors.text,
              fontSize: 16,
              lineHeight: 23,
              minHeight: 48,
              maxHeight: Math.min(130, Math.max(50, viewportHeight * 0.2)),
              padding: 0,
            }}
          />
          <View style={ui.between}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach repository file"
              disabled={disabled || hasDraft}
              onPress={() => {
                edit(request + (request && !request.endsWith(' ') ? ' ' : '') + '@');
                input.current?.focus();
              }}
              style={{ paddingVertical: 6, paddingHorizontal: 8 }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 23 }}>@</Text>
            </Pressable>
            <Text style={ui.label}>{paths.length}/3 files · On device</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send to agent"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={onSend}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: canSend ? colors.primary : colors.border,
              }}
            >
              <View style={{ transform: [{ rotate: '-90deg' }] }}>
                <Icon
                  name="arrow"
                  size={20}
                  color={canSend ? colors.primaryForeground : colors.textMuted}
                />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
