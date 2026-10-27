/**
 * The toss coin.
 *
 * The result is NOT decided here. `perform_toss` decides it on the server and
 * this component's only job is to land on the face it was handed — the spin is
 * calculated backwards from `outcome` so the coin physically comes to rest on
 * the right side. An animation that generated its own result would eventually
 * disagree with the database.
 *
 * Two real faces rather than one image flipped: the wrapper squashes vertically
 * by |cos(angle)| (a 2D flip, see `coinStyle`), and each face is a separate
 * Image. Which face is visible is driven by the angle itself, so it cannot
 * desync from the spin. At rest it is a plain Image with no transform.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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

const HEADS = require('../../../../assets/images/coin-heads.png') as number;
const TAILS = require('../../../../assets/images/coin-tails.png') as number;

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

  /*
    Held in a ref, NOT an effect dependency. Callers pass an inline arrow, so
    a dependency changed on every render: any re-render mid-flip (the "you won
    the toss" popup, a refetch) re-ran the effect, which took the replay-guard
    branch, snapped the coin to rest and cancelled the spin -- whose callback
    then saw finished=false and never settled. The screen sat on "Flipping…".
  */
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  /*
    True only while the 3D spin is running. At rest the coin is a plain Image
    with no transform at all: rotateX + perspective on Android rendered an
    empty card on real devices, and a coin that is not moving has no use for
    3D. Only the spin itself is exposed to that risk.
  */
  const [spinning, setSpinning] = useState(false);

  const settle = useCallback((): void => {
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setSpinning(false);
    onSettledRef.current?.();
  }, []);

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

      setSpinning(true);
      spin.value = 0;
      spin.value = withTiming(
        TURNS * 360 + restAngle,
        // Decelerating: the last couple of turns are visibly slower, which is
        // what makes it read as a coin losing momentum rather than a spinner.
        { duration: SPIN_MS, easing: Easing.bezier(0.12, 0.62, 0.12, 1) },
        // Settle even when interrupted: the result is already decided on the
        // server, and withholding it behind "Flipping…" helps no one.
        () => {
          runOnJS(settle)();
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

  // A 2D flip: the coin's height follows |cos(angle)|, which is what a coin
  // turning end over end looks like from the front. No rotateX/perspective --
  // Android's 3D path is what left the card empty on real devices.
  const coinStyle = useAnimatedStyle(() => {
    const squash = Math.max(Math.abs(Math.cos((spin.value * Math.PI) / 180)), 0.04);
    return {
      transform: [{ translateY: lift.value }, { scale: scale.value }, { scaleY: squash }],
    };
  });

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

  if (!spinning) {
    return (
      <View style={[styles.stage, { height: size * 1.9 }]} accessibilityRole="image">
        <Image
          source={outcome === 'tails' ? TAILS : HEADS}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
          accessibilityLabel={outcome === 'tails' ? 'Coin showing tails' : 'Coin showing heads'}
        />
      </View>
    );
  }

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
          style={[...face, tailsStyle]}
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
  // No `backfaceVisibility` and no rotateX(180) back face: Android culled the
  // tails face at every angle, so a TAILS result showed an empty card. The
  // opacity parity above picks the visible face instead.
  face: { position: 'absolute' },
  shadow: { position: 'absolute', height: 10, borderRadius: 999 },
});
