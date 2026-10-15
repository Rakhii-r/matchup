/**
 * AnimatedLogo — the sixfour24 lockup inside two counter-rotating arcs.
 *
 * Sequence:
 *   rings fade in → logo fades and springs up from 0.85 → tagline fades in.
 *   The arcs keep turning for as long as the splash is up, so the screen reads
 *   as "working" rather than "frozen" on a slow start.
 *
 * Replaced the pulsing green disc (8 Oct 2026): it sat behind a logo that is
 * itself green, and read as a blob rather than as part of the mark.
 */
import { Image, StyleSheet, View } from 'react-native';
import { MotiView, MotiText } from 'moti';
import { Easing } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_LOGO = require('../../../../assets/images/sixfour24-logo.png') as number;

// Intrinsic asset is 1672x941 (~1.78:1); keep that ratio when sizing.
const LOGO_WIDTH = 200;
const LOGO_HEIGHT = LOGO_WIDTH / (1672 / 941);

const RING = 264;
const STROKE = 4;

const LIME = '#B7F04A';
const EMERALD = '#10B981';

/** One arc of a circle, drawn as a dashed stroke with a single visible dash. */
function Arc({
  inset,
  color,
  sweep,
}: {
  /** How far inside the outer ring this arc sits. */
  inset: number;
  color: string;
  /** Fraction of the circle the arc covers, 0..1. */
  sweep: number;
}): React.ReactNode {
  const size = RING - inset * 2;
  const r = (size - STROKE) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={STROKE}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${c * sweep} ${c}`}
      />
    </Svg>
  );
}

export function AnimatedLogo(): React.ReactNode {
  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        {/* Outer arc, clockwise */}
        <MotiView
          style={styles.layer}
          from={{ opacity: 0, rotate: '0deg' }}
          animate={{ opacity: 1, rotate: '360deg' }}
          transition={{
            opacity: { type: 'timing', duration: 400 },
            rotate: {
              type: 'timing',
              duration: 1800,
              easing: Easing.linear,
              loop: true,
              repeatReverse: false,
            },
          }}
        >
          <Arc inset={0} color={LIME} sweep={0.28} />
        </MotiView>

        {/* Inner arc, anticlockwise and slower */}
        <MotiView
          style={styles.layer}
          from={{ opacity: 0, rotate: '360deg' }}
          animate={{ opacity: 1, rotate: '0deg' }}
          transition={{
            opacity: { type: 'timing', duration: 400, delay: 150 },
            rotate: {
              type: 'timing',
              duration: 2600,
              easing: Easing.linear,
              loop: true,
              repeatReverse: false,
            },
          }}
        >
          <Arc inset={14} color={EMERALD} sweep={0.18} />
        </MotiView>

        {/* Logo entry: fade + scale with a small spring */}
        <MotiView
          from={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 13, stiffness: 120, mass: 0.8, delay: 200 }}
        >
          <Image
            source={APP_LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="sixfour24"
          />
        </MotiView>
      </View>

      {/*
        No app-name text: the lockup above already contains the wordmark, and
        rendering it twice read as a mistake. The tagline still fades in.
      */}
      <MotiView
        from={{ opacity: 0, translateY: 6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 500, delay: 900 }}
      >
        <MotiText style={styles.tagline}>PLAY · CONNECT · COMPETE</MotiText>
      </MotiView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  stage: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  // Both arcs are centred on the stage whatever their own size.
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
  tagline: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 4,
    textAlign: 'center',
    marginTop: 22,
  },
});
