import { useState, type ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESSED_SCALE = 0.96;
const SPRING = { damping: 15, stiffness: 300 } as const;
const DISABLED_OPACITY = 0.5;

export interface PressableScaleProps extends PressableProps {
  /** Light haptic tick on press. On by default; turn off for rapid-fire controls. */
  haptic?: boolean;
}

/**
 * A `Pressable` that dips to 0.96 while held and springs back on release.
 *
 * It is a drop-in for `Pressable`: every prop passes through, including the
 * function forms of `style` and `children`, and the caller's visuals are left
 * alone — this only adds the scale, the haptic, and the disabled treatment.
 *
 * The scale runs on the UI thread (Reanimated), so it stays smooth while the
 * JS thread is busy with whatever the press started.
 *
 * Disabled: no animation, no haptic, and opacity 0.5. That opacity is applied
 * last, so it replaces a caller's own disabled opacity instead of multiplying
 * with it. A caller's own `transform` is likewise replaced by the scale.
 */
export function PressableScale({
  haptic = true,
  disabled,
  style,
  children,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: PressableScaleProps): ReactNode {
  const scale = useSharedValue(1);
  // Mirrors Pressable's own `pressed`, for callers that style from it. An
  // animated component cannot take a style function, so it is resolved here.
  const [pressed, setPressed] = useState(false);
  const isDisabled = disabled === true;

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handlePressIn = (event: GestureResponderEvent): void => {
    setPressed(true);
    scale.set(withSpring(PRESSED_SCALE, SPRING));
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent): void => {
    setPressed(false);
    scale.set(withSpring(1, SPRING));
    onPressOut?.(event);
  };

  const handlePress = (event: GestureResponderEvent): void => {
    // Not every device has a haptic engine; a refusal is not worth surfacing.
    if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress?.(event);
  };

  const state = { pressed };

  return (
    <AnimatedPressable
      {...rest}
      disabled={isDisabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[
        typeof style === 'function' ? style(state) : style,
        animatedStyle,
        isDisabled ? { opacity: DISABLED_OPACITY } : null,
      ]}
    >
      {typeof children === 'function' ? children(state) : children}
    </AnimatedPressable>
  );
}
