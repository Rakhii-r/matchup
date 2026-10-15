/**
 * Shared chrome and illustration for the emerald redesign (Oct 2026).
 *
 * Three kinds of thing live here, all of them purely presentational:
 *
 *   - `PageHeader` / `RoundBack`: the round mint back button and bold title
 *     every stack screen in the redesign opens with.
 *   - `StadiumBackdrop` / `HillsArt`: the pale floodlights-and-hills artwork.
 *     Drawn with react-native-svg from the palette rather than shipped as
 *     bitmaps, so it follows the theme toggle and costs nothing to download.
 *   - `IconTile`: the tinted circle or rounded square behind a glyph.
 *
 * Nothing in this file reads data or navigates anywhere except `useGoBack`,
 * which exists so a deep-linked screen with no history still has a way out.
 */
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

import { S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconBack } from '@shared/ui/icons';

/** Smallest comfortable tap target. */
const TOUCH = 44;

/**
 * Back, with somewhere to go when there is no history. A push notification or
 * a pasted link opens a screen with nothing behind it, where `router.back()`
 * is a no-op and would strand the user.
 */
export function useGoBack(fallback: Href = '/(tabs)'): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}

export function RoundBack({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[styles.roundBack, style]}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <IconBack color={M.green} size={22} strokeWidth={2.4} />
    </Pressable>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Where back goes when there is no history. Defaults to the tabs. */
  fallback?: Href;
  /** Overrides the default back behaviour entirely. */
  onBack?: () => void;
  right?: React.ReactNode;
  /** Wizard-style centred title. The default is left-aligned and larger. */
  centered?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PageHeader({
  title,
  subtitle,
  fallback,
  onBack,
  right,
  centered = false,
  style,
}: PageHeaderProps): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const goBack = useGoBack(fallback);

  return (
    <View style={[styles.header, style]}>
      <RoundBack onPress={onBack ?? goBack} />
      <View style={[styles.headerText, centered ? styles.headerTextCentered : null]}>
        <AppText
          variant="heading"
          color={M.text}
          numberOfLines={1}
          style={centered ? styles.titleCentered : styles.title}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={M.muted} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {/* A spacer the width of the back button keeps a centred title centred. */}
      {right ?? (centered ? <View style={styles.roundBackSpacer} /> : null)}
    </View>
  );
}

/**
 * Accent tints for glyph tiles. A screen of all-green tiles reads as one grey
 * block; a different hue per row lets the eye find "Wins" without reading.
 * `fg` is the glyph, `bg` its tile. The values hold up on both themes because
 * the tile carries its own background.
 */
export const TINT = {
  green: { fg: '#047857', bg: '#D1FAE5' },
  blue: { fg: '#1D4ED8', bg: '#DBEAFE' },
  amber: { fg: '#B45309', bg: '#FEF3C7' },
  red: { fg: '#B91C1C', bg: '#FEE2E2' },
  violet: { fg: '#6D28D9', bg: '#EDE9FE' },
  teal: { fg: '#0F766E', bg: '#CCFBF1' },
} as const;

export type TintName = keyof typeof TINT;

export function IconTile({
  children,
  size = 40,
  square = false,
  color,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  square?: boolean;
  /** Fill. Defaults to the palette's mint chip. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactNode {
  const M = useMock();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: square ? Math.round(size * 0.28) : size / 2,
          backgroundColor: color ?? M.chip,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** One floodlight tower: a pole with a 3 x 3 bank of lamps on top. */
function Floodlight({ x, top, base, color }: { x: number; top: number; base: number; color: string }) {
  const lamps: React.ReactNode[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      lamps.push(
        <Circle key={`${r}-${c}`} cx={x - 6 + c * 6} cy={top + 3 + r * 5} r={1.9} fill={color} />,
      );
    }
  }
  return (
    <G>
      <Line x1={x} y1={top + 16} x2={x} y2={base} stroke={color} strokeWidth={2} />
      <Line x1={x - 5} y1={base - 26} x2={x + 5} y2={base - 26} stroke={color} strokeWidth={1.4} />
      {lamps}
    </G>
  );
}

function Tree({ x, base, r, color }: { x: number; base: number; r: number; color: string }) {
  return (
    <G>
      <Rect x={x - 1.2} y={base - r * 0.9} width={2.4} height={r * 0.9} fill={color} />
      <Circle cx={x} cy={base - r * 1.5} r={r} fill={color} />
      <Circle cx={x - r * 0.7} cy={base - r * 1.05} r={r * 0.7} fill={color} />
      <Circle cx={x + r * 0.7} cy={base - r * 1.05} r={r * 0.7} fill={color} />
    </G>
  );
}

/**
 * The pale ground scene pinned to the bottom of an otherwise sparse screen:
 * rolling hills, two floodlight towers, trees and a practice net.
 *
 * Absolutely positioned and non-interactive, so it never takes part in layout
 * and never swallows a tap meant for the content above it.
 */
export function StadiumBackdrop({
  height = 190,
  net = true,
}: {
  height?: number;
  net?: boolean;
}): React.ReactNode {
  const M = useMock();
  const c = M.green;
  const netLines: React.ReactNode[] = [];
  if (net) {
    for (let i = 0; i <= 8; i += 1) {
      netLines.push(
        <Line key={`v${i}`} x1={140 + i * 10} y1={118} x2={140 + i * 10} y2={162} stroke={c} strokeWidth={0.7} />,
      );
    }
    for (let j = 0; j <= 4; j += 1) {
      netLines.push(
        <Line key={`h${j}`} x1={140} y1={118 + j * 11} x2={220} y2={118 + j * 11} stroke={c} strokeWidth={0.7} />,
      );
    }
  }
  return (
    <View pointerEvents="none" style={[styles0.backdrop, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 190" preserveAspectRatio="xMidYMax slice">
        <Path d="M0 96 C70 60 130 70 190 92 C250 112 310 84 360 70 L360 190 L0 190 Z" fill={c} opacity={0.05} />
        <G opacity={0.16}>
          <Floodlight x={82} top={58} base={160} color={c} />
          <Floodlight x={280} top={64} base={160} color={c} />
        </G>
        <G opacity={0.13}>
          <Tree x={54} base={166} r={11} color={c} />
          <Tree x={112} base={168} r={15} color={c} />
          <Tree x={252} base={168} r={12} color={c} />
          <Tree x={304} base={166} r={10} color={c} />
        </G>
        <G opacity={0.2}>{netLines}</G>
        <Path d="M0 150 C80 128 150 150 210 158 C270 166 320 146 360 138 L360 190 L0 190 Z" fill={c} opacity={0.08} />
        <Path d="M0 172 C90 158 200 176 360 160 L360 190 L0 190 Z" fill={c} opacity={0.08} />
      </Svg>
    </View>
  );
}

/**
 * Right-hand artwork for a hero card: hills with either stumps and a ball, or
 * a bat leaning on them. Fills its parent; the parent sets `overflow: hidden`.
 */
export function HillsArt({
  variant = 'stumps',
  width = 190,
}: {
  variant?: 'stumps' | 'bat' | 'plain';
  width?: number;
}): React.ReactNode {
  const M = useMock();
  const c = M.green;
  return (
    <View pointerEvents="none" style={[styles0.hillsArt, { width }]}>
      <Svg width="100%" height="100%" viewBox="0 0 190 130" preserveAspectRatio="xMaxYMax slice">
        <Path d="M0 70 C40 40 80 44 112 60 C140 74 168 52 190 40 L190 130 L0 130 Z" fill={c} opacity={0.08} />
        <Path d="M20 100 C60 76 110 92 190 74 L190 130 L20 130 Z" fill={c} opacity={0.1} />
        {variant !== 'plain' ? (
          <G>
            {/* Stumps */}
            <G opacity={0.22}>
              <Rect x={126} y={38} width={5} height={74} rx={2.5} fill={c} />
              <Rect x={138} y={38} width={5} height={74} rx={2.5} fill={c} />
              <Rect x={150} y={38} width={5} height={74} rx={2.5} fill={c} />
              <Rect x={125} y={34} width={15} height={4} rx={2} fill={c} />
              <Rect x={141} y={34} width={15} height={4} rx={2} fill={c} />
            </G>
            {variant === 'bat' ? (
              <G opacity={0.22} transform="rotate(24 168 70)">
                <Rect x={162} y={36} width={13} height={56} rx={4} fill={c} />
                <Rect x={166} y={12} width={5} height={26} rx={2.5} fill={c} />
              </G>
            ) : null}
            {/* Ball */}
            <Circle cx={172} cy={104} r={13} fill={c} opacity={0.28} />
            <Ellipse cx={128} cy={116} rx={44} ry={5} fill={c} opacity={0.12} />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

/** A folded map with a pin and a dashed search ring. Sized by its parent. */
export function MapPinArt({ size = 150 }: { size?: number }): React.ReactNode {
  const M = useMock();
  const c = M.green;
  return (
    <View pointerEvents="none" style={{ width: size, height: size * 0.82 }}>
      <Svg width="100%" height="100%" viewBox="0 0 150 123">
        <Ellipse cx={76} cy={108} rx={62} ry={11} fill={c} opacity={0.12} />
        {/* Map sheet, three folds */}
        <Path d="M22 62 L56 50 L56 100 L22 112 Z" fill={M.card} stroke={c} strokeOpacity={0.25} strokeWidth={1} />
        <Path d="M56 50 L94 62 L94 112 L56 100 Z" fill={M.cardHi} stroke={c} strokeOpacity={0.25} strokeWidth={1} />
        <Path d="M94 62 L128 50 L128 100 L94 112 Z" fill={M.card} stroke={c} strokeOpacity={0.25} strokeWidth={1} />
        <Path d="M30 78 L50 71 L50 86 L30 93 Z" fill={c} opacity={0.3} />
        <Path d="M100 80 L122 72 L122 90 L100 98 Z" fill={c} opacity={0.3} />
        <Path d="M62 70 L88 78 L88 88 L62 80 Z" fill={c} opacity={0.18} />
        <Circle cx={75} cy={50} r={38} fill="none" stroke={c} strokeWidth={1.2} strokeDasharray="4 4" opacity={0.7} />
        {/* Pin */}
        <Path d="M75 76 C75 76 56 56 56 41 A19 19 0 1 1 94 41 C94 56 75 76 75 76 Z" fill={c} />
        <Circle cx={75} cy={41} r={7.5} fill={M.card} />
        {/* Trees */}
        <Circle cx={134} cy={84} r={8} fill={c} opacity={0.35} />
        <Rect x={133} y={90} width={2} height={12} fill={c} opacity={0.35} />
        <Circle cx={12} cy={92} r={6} fill={c} opacity={0.3} />
        <Rect x={11} y={96} width={2} height={10} fill={c} opacity={0.3} />
      </Svg>
    </View>
  );
}

/** Desk calendar with a bat and ball -- the "nothing scheduled" empty state. */
export function CalendarArt({ size = 220 }: { size?: number }): React.ReactNode {
  const M = useMock();
  const c = M.green;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let col = 0; col < 4; col += 1) {
      const marked = r === 1 && col === 2;
      cells.push(
        <Rect
          key={`${r}-${col}`}
          x={86 + col * 20}
          y={84 + r * 19}
          width={13}
          height={12}
          rx={3}
          fill={marked ? c : M.border}
        />,
      );
    }
  }
  return (
    <View pointerEvents="none" style={{ width: size, height: size * 0.82 }}>
      <Svg width="100%" height="100%" viewBox="0 0 240 197">
        {/* Soft cloud and ground */}
        <Circle cx={74} cy={104} r={44} fill={c} opacity={0.07} />
        <Circle cx={168} cy={96} r={52} fill={c} opacity={0.07} />
        <Ellipse cx={120} cy={170} rx={98} ry={9} fill={c} opacity={0.1} />
        {/* Sparks above the calendar */}
        <Line x1={102} y1={22} x2={98} y2={10} stroke={c} strokeWidth={4} strokeLinecap="round" />
        <Line x1={122} y1={18} x2={126} y2={4} stroke={c} strokeWidth={4} strokeLinecap="round" />
        <Line x1={140} y1={26} x2={150} y2={16} stroke={c} strokeWidth={4} strokeLinecap="round" />
        {/* Leaves */}
        <Path d="M40 168 C36 148 44 138 52 134 C54 150 50 162 40 168 Z" fill={c} opacity={0.7} />
        <Path d="M54 168 C54 152 62 146 70 144 C70 156 64 164 54 168 Z" fill={c} opacity={0.5} />
        <Path d="M198 168 C196 152 202 144 210 140 C212 154 208 164 198 168 Z" fill={c} opacity={0.6} />
        {/* Bat */}
        <G transform="rotate(-18 62 120)">
          <Rect x={54} y={92} width={18} height={66} rx={6} fill="#E3C08A" />
          <Rect x={59} y={62} width={8} height={32} rx={4} fill="#3B3F45" />
          <Path d="M56 112 L63 120 L70 112 M56 124 L63 132 L70 124" stroke={c} strokeWidth={3} fill="none" />
        </G>
        {/* Calendar body */}
        <Rect x={74} y={44} width={100} height={118} rx={12} fill={M.card} stroke={M.border} strokeWidth={1.5} />
        <Path d="M74 56 a12 12 0 0 1 12 -12 h76 a12 12 0 0 1 12 12 v16 h-100 Z" fill={c} />
        <Rect x={98} y={32} width={8} height={24} rx={4} fill="#3B3F45" />
        <Rect x={142} y={32} width={8} height={24} rx={4} fill="#3B3F45" />
        {cells}
        {/* Ball */}
        <Circle cx={184} cy={152} r={15} fill="#C62828" />
        <Path d="M175 142 C182 149 182 157 176 164" stroke="#F5F5F5" strokeWidth={1.4} fill="none" />
        {/* Paper plane */}
        <Path d="M214 44 L190 54 L200 58 L204 68 Z" fill={c} opacity={0.35} />
        <Path d="M190 72 C182 84 180 92 184 104" stroke={c} strokeWidth={1} strokeDasharray="3 4" fill="none" opacity={0.5} />
      </Svg>
    </View>
  );
}

// Colour-free layout. Kept apart from makeStyles so the two illustration
// components, which never need the palette for layout, do not rebuild a sheet.
const styles0 = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  hillsArt: { position: 'absolute', top: 0, right: 0, bottom: 0 },
});

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      paddingVertical: S.sm,
    },
    headerText: { flex: 1, minWidth: 0 },
    headerTextCentered: { alignItems: 'center' },
    title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, lineHeight: 30, fontWeight: '700' },
    titleCentered: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, lineHeight: 26, fontWeight: '700' },
    roundBack: {
      width: TOUCH,
      height: TOUCH,
      borderRadius: TOUCH / 2,
      backgroundColor: M.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundBackSpacer: { width: TOUCH, height: TOUCH },
  });
