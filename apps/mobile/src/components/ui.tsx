import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { colors } from '../theme';

export type IconName =
  | 'terminal'
  | 'activity'
  | 'server'
  | 'settings'
  | 'clock'
  | 'chevron'
  | 'check'
  | 'arrow'
  | 'refresh'
  | 'upload'
  | 'download';
type Segment = [number, number, number, number];
const paths: Record<IconName, Segment[]> = {
  terminal: [
    [5, 7, 10, 12],
    [10, 12, 5, 17],
    [13, 17, 19, 17],
  ],
  activity: [
    [2, 12, 6, 12],
    [6, 12, 9, 5],
    [9, 5, 14, 19],
    [14, 19, 17, 12],
    [17, 12, 22, 12],
  ],
  server: [
    [6, 8, 6.1, 8],
    [10, 8, 18, 8],
    [6, 16, 6.1, 16],
    [10, 16, 18, 16],
  ],
  settings: [
    [6, 3, 6, 6],
    [6, 12, 6, 21],
    [12, 3, 12, 12],
    [12, 18, 12, 21],
    [18, 3, 18, 6],
    [18, 12, 18, 21],
  ],
  clock: [
    [12, 6, 12, 12],
    [12, 12, 16, 14],
  ],
  chevron: [
    [9, 6, 15, 12],
    [15, 12, 9, 18],
  ],
  check: [
    [5, 12, 10, 17],
    [10, 17, 19, 7],
  ],
  arrow: [
    [4, 12, 20, 12],
    [14, 6, 20, 12],
    [20, 12, 14, 18],
  ],
  refresh: [
    [20, 3, 20, 9],
    [14, 9, 20, 9],
  ],
  upload: [
    [12, 16, 12, 3],
    [7, 8, 12, 3],
    [12, 3, 17, 8],
    [4, 16, 4, 21],
    [4, 21, 20, 21],
    [20, 21, 20, 16],
  ],
  download: [
    [12, 3, 12, 16],
    [7, 11, 12, 16],
    [12, 16, 17, 11],
    [4, 16, 4, 21],
    [4, 21, 20, 21],
    [20, 21, 20, 16],
  ],
};

/** Small native line icons; no font download or extra native module required. */
export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const d = (n: number) => (n * size) / 24;
  const box = (x: number, y: number, w: number, h: number, radius: number, key: string) => (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: d(x),
        top: d(y),
        width: d(w),
        height: d(h),
        borderRadius: d(radius),
        borderWidth: d(1.6),
        borderColor: color,
      }}
    />
  );
  return (
    <View accessible={false} pointerEvents="none" style={{ width: size, height: size }}>
      {name === 'server' ? (
        <>
          {box(2, 3, 20, 10, 2, 'a')}
          {box(2, 13, 20, 8, 2, 'b')}
        </>
      ) : null}
      {name === 'clock' ? box(3, 3, 18, 18, 10, 'circle') : null}
      {name === 'settings' ? (
        <>
          {box(3.5, 6, 5, 6, 2, 'a')}
          {box(9.5, 12, 5, 6, 2, 'b')}
          {box(15.5, 6, 5, 6, 2, 'c')}
        </>
      ) : null}
      {name === 'refresh' ? (
        <View
          style={{
            position: 'absolute',
            left: d(3),
            top: d(4),
            width: d(17),
            height: d(17),
            borderRadius: d(10),
            borderWidth: d(1.6),
            borderColor: color,
            borderRightColor: 'transparent',
          }}
        />
      ) : null}
      {paths[name].map(([x1, y1, x2, y2], index) => {
        const length = Math.hypot(x2 - x1, y2 - y1);
        return (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: d((x1 + x2 - length) / 2),
              top: d((y1 + y2) / 2 - 0.8),
              width: Math.max(d(length), d(1.6)),
              height: d(1.6),
              borderRadius: d(1),
              backgroundColor: color,
              transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
            }}
          />
        );
      })}
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'outline' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const foreground = variant === 'primary' ? colors.primaryForeground : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        variant === 'primary' ? ui.primary : variant === 'outline' ? ui.outline : ui.ghost,
        style,
        { opacity: disabled || loading ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Icon name={icon} size={17} color={foreground} />
      ) : null}
      <Text style={[ui.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger'; dot?: boolean }>) {
  const foreground = tone === 'neutral' ? colors.textMuted : colors[tone];
  const background = tone === 'neutral' ? colors.muted : colors[`${tone}Muted`];
  return (
    <View style={[ui.badge, { backgroundColor: background }]}>
      {dot ? (
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: foreground }} />
      ) : null}
      <Text style={[ui.badgeText, { color: foreground }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export const ui = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  body: { fontSize: 13, lineHeight: 20, color: colors.textMuted },
  label: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  mono: { fontFamily: 'monospace', fontSize: 11, lineHeight: 17, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border },
  button: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  outline: { backgroundColor: colors.surface, borderColor: colors.border },
  ghost: { borderColor: 'transparent', backgroundColor: 'transparent' },
  buttonText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '500' },
});
