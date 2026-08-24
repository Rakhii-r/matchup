/**
 * The toss coin.
 *
 * The result is NOT decided here. `perform_toss` decides it on the server and
 * this component's only job is to land on the face it was handed — the spin is
 * calculated backwards from `outcome` so the coin physically comes to rest on
 * the right side. An animation that generated its own result would eventually
 * disagree with the database.
 *
 * Two real faces rather than one image flipped: the wrapper rotates on X with a
 * perspective, and each face is a separate Image. Which face is visible is
 * driven by the rotation angle itself, so it cannot desync from the spin —
 * `backfaceVisibility` is also set, but the parity check is what guarantees
 * correctness on devices where that property is unreliable.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import type { MockPalette } from '@shared/theme/mockTheme';

const HEADS = require('../../../../assets/images/head coin -64.jpg') as number;
const TAILS = require('../../../../assets/images/tails coin- 64.jpg') as number;

/** Full turns before it settles. Odd enough to read as a real flip, not a spin. */
const TURNS = 5;
const RISE_MS = 780;
const FALL_MS = 860;
const BOUNCE_UP_MS = 150;
const BOUNCE_DOWN_MS = 210;
/** The spin finishes just before the bounce, so it lands and then settles. */
const SPIN_MS = RISE_MS + FALL_MS;
const TOTAL_MS = SPIN_MS + BOUNCE_UP_MS + BOUNCE_DOWN_MS;

/** Fire-and-forget: haptics are unavailable on some devices and must never throw. */
function tap(style: Haptics.ImpactFeedbackStyle): void {
  Haptics.impactAsync(style).catch(() => undefined);
}

interface CoinFlipProps {
  /** Server-decided face. `null` means the coin has not been flipped yet. */
  outcome: 'heads' | 'tails' | null;
  /**
   * True only when this session performed the flip. A screen opened on an
   * already-decided toss shows the coin at rest instead of replaying it.
   */
  animate: boolean;
  /**
   * Identity of THIS flip — pass the toss row's `created_at`, which redo_toss
   * bumps. Guarding replay on `outcome` instead would break re-rolls: a re-roll
   * landing on the same face would be treated as already played and the coin
   * would sit still.
   */
  flipKey?: string | null;
  /** Called once the coin has settled, so the caller can reveal the result. */
  onSettled?: () => void;
  size?: number;
  M: MockPalette;
}

export function CoinFlip({
  outcome,
  animate,
  flipKey,
  onSettled,
  size = 176,
  M,
}: CoinFlipProps): React.ReactNode {
  const spin = useSharedValue(0);
  const lift = useSharedValue(0);
  const scale = useSharedValue(1);

  // Guards a replay: `outcome` arriving is the trigger, and a refetch can hand
  // us the same value again.
  const playedFor = useRef<string | null>(null);

  const settle = useCallback((): void => {
    tap(Haptics.ImpactFeedbackStyle.Medium);
    onSettled?.();
  }, [onSettled]);

  useEffect(() => {
    if (outcome === null) return;

    const restAngle = outcome === 'tails' ? 180 : 0;

    // Already resolved before this screen opened, or we've played this one:
    // sit on the correct face with no motion.
    const thisFlip = flipKey ?? outcome;
    if (!animate || playedFor.current === thisFlip) {
      spin.value = restAngle;
      lift.value = 0;
      scale.value = 1;
      return;
    }
    playedFor.current = thisFlip;

    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;

      if (reduceMotion) {
        // Respect the OS setting: land immediately, still on the right face,
        // and still tell the caller so the result is not withheld.
        spin.value = restAngle;
        settle();
        return;
      }

      tap(Haptics.ImpactFeedbackStyle.Light);

      spin.value = 0;
      spin.value = withTiming(
        TURNS * 360 + restAngle,
        // Decelerating: the last couple of turns are visibly slower, which is
        // what makes it read as a coin losing momentum rather than a spinner.
        { duration: SPIN_MS, easing: Easing.bezier(0.12, 0.62, 0.12, 1) },
        (finished) => {
          if (finished) runOnJS(settle)();
        },
      );

      lift.value = withSequence(
        withTiming(-size * 0.62, { duration: RISE_MS, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: FALL_MS, easing: Easing.in(Easing.cubic) }),
        withTiming(-size * 0.08, { duration: BOUNCE_UP_MS, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: BOUNCE_DOWN_MS, easing: Easing.in(Easing.quad) }),
      );

      // Shrinks at the apex — it is further away — then returns.
      scale.value = withSequence(
        withTiming(0.84, { duration: RISE_MS, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.cubic) }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [outcome, animate, flipKey, settle, size, spin, lift, scale]);

  const coinStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateY: lift.value },
      { scale: scale.value },
      { rotateX: `${spin.value}deg` },
    ],
  }));

  // Face visibility derived from the angle, so it can never disagree with the
  // spin. Heads owns 270°–90°, tails owns 90°–270°.
  const headsStyle = useAnimatedStyle(() => {
    const a = ((spin.value % 360) + 360) % 360;
    return { opacity: a < 90 || a >= 270 ? 1 : 0 };
  });
  const tailsStyle = useAnimatedStyle(() => {
    const a = ((spin.value % 360) + 360) % 360;
    return { opacity: a >= 90 && a < 270 ? 1 : 0 };
  });

  // The shadow tightens as the coin drops, which is what sells the height.
  const shadowStyle = useAnimatedStyle(() => {
    const height = Math.min(Math.abs(lift.value) / (size * 0.62), 1);
    return {
      opacity: 0.28 * (1 - height) + 0.05,
      transform: [{ scaleX: 1 - height * 0.35 }],
    };
  });

  const face = [styles.face, { width: size, height: size, borderRadius: size / 2 }];

  return (
    <View style={[styles.stage, { height: size * 1.9 }]} accessibilityRole="image">
      <Animated.View
        style={[
          styles.shadow,
          { width: size * 0.78, backgroundColor: M.overlay, bottom: size * 0.1 },
          shadowStyle,
        ]}
      />
      <Animated.View style={[{ width: size, height: size }, coinStyle]}>
        <Animated.Image source={HEADS} style={[...face, headsStyle]} resizeMode="cover" />
        <Animated.Image
          source={TAILS}
          style={[...face, styles.back, tailsStyle]}
          resizeMode="cover"
        />
      </Animated.View>
    </View>
  );
}

/** How long the caller should wait before revealing the result. */
export const COIN_FLIP_DURATION_MS = TOTAL_MS;

/** Static preview used before the flip, so the coin is on screen from the start. */
export function CoinResting({ size = 176 }: { size?: number }): React.ReactNode {
  return (
    <View style={[styles.stage, { height: size * 1.9 }]}>
      <Image
        source={HEADS}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  face: { position: 'absolute', backfaceVisibility: 'hidden' },
  back: { transform: [{ rotateX: '180deg' }] },
  shadow: { position: 'absolute', height: 10, borderRadius: 999 },
});
