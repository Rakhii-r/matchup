import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const BAND_WIDTH = 70;
const BURST_MS = 750;
const LOOP_MS = 1100;

/** Where each sparkle sits, and the point in the sweep at which it flashes. */
const SPARKLES: { left: DimensionValue; top: DimensionValue; at: number; size: number }[] = [
  { left: '10%', top: '24%', at: 0.05, size: 5 },
  { left: '27%', top: '66%', at: 0.2, size: 4 },
  { left: '46%', top: '20%', at: 0.36, size: 6 },
  { left: '64%', top: '70%', at: 0.5, size: 4 },
  { left: '80%', top: '28%', at: 0.62, size: 5 },
  { left: '91%', top: '60%', at: 0.72, size: 4 },
];

interface ShineOverlayProps {
  /** Increment to play one sweep. 0 means "has not been tapped yet". */
  burstKey: number;
  /** Sweep continuously, e.g. while the action the button started is running. */
  looping: boolean;
  /** Match the host's corner radius so the light is clipped to its shape. */
  borderRadius: number;
}

function Sparkle({
  progress,
  left,
  top,
  at,
  size,
}: {
  progress: SharedValue<number>;
  left: DimensionValue;
  top: DimensionValue;
  at: number;
  size: number;
}): ReactNode {
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [at, at + 0.12, at + 0.28], [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { rotate: '45deg' },
        { scale: interpolate(p, [at, at + 0.12, at + 0.28], [0.3, 1.2, 0.3], Extrapolation.CLAMP) },
      ],
    };
  });

  return <Animated.View style={[styles.sparkle, { left, top, width: size, height: size }, style]} />;
}

/**
 * A band of light that sweeps across its parent, with sparkles flashing in its
 * wake. Sits on top of a button as decoration only: it takes no touches and is
 * hidden from screen readers.
 *
 * The parent must be `position: relative` (the default) — this fills it.
 * Width comes from `onLayout`, never from the screen size, so it is correct in
 * split-screen and after a rotation.
 */
export function ShineOverlay({ burstKey, looping, borderRadius }: ShineOverlayProps): ReactNode {
  const progress = useSharedValue(0);
  const [width, setWidth] = useState(0);
  // The last tap already played. Without it, `looping` turning off would look
  // like a fresh tap and sweep once more — on a failed action, for instance.
  const playedBurst = useRef(0);

  useEffect(() => {
    if (looping) {
      progress.set(withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false));
    } else if (burstKey !== playedBurst.current) {
      progress.set(withTiming(1, { duration: BURST_MS, easing: Easing.out(Easing.quad) }));
    }
    playedBurst.current = burstKey;
    return () => {
      // Back to 0, where the band is off the left edge and every sparkle is
      // invisible — a sweep cancelled halfway must not freeze on the button.
      cancelAnimation(progress);
      progress.set(0);
    };
  }, [burstKey, looping, progress]);

  const bandStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.get(), [0, 1], [-BAND_WIDTH, width + BAND_WIDTH]) },
      { skewX: '-20deg' },
    ],
  }));

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.clip, { borderRadius }]}
    >
      <Animated.View style={[styles.band, bandStyle]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {SPARKLES.map((sparkle) => (
        <Sparkle key={sparkle.at} progress={progress} {...sparkle} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0, width: BAND_WIDTH },
  sparkle: { position: 'absolute', backgroundColor: '#FFFFFF' },
});
