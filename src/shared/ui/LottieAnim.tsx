import type { ReactNode } from 'react';
import { View } from 'react-native';
import LottieView from 'lottie-react-native';

import { LOTTIE_SOURCES, type LottieName } from '@/assets/lottie';

interface LottieAnimProps {
  name: LottieName;
  /** Width and height in dp. Lottie files are vector, so any size is sharp. */
  size?: number;
  loop?: boolean;
  autoPlay?: boolean;
  /** Called when a non-looping animation plays to its end (not when cancelled). */
  onFinish?: () => void;
}

/**
 * Plays a bundled Lottie animation by name.
 *
 * Renders nothing when the named file has not been added yet (see
 * `src/assets/lottie/README.md`), so a screen can ship its `<LottieAnim>`
 * before the artwork exists.
 *
 * Decorative by default: hidden from screen readers. Say what happened in text
 * next to it — an animation alone tells a VoiceOver/TalkBack user nothing.
 */
export function LottieAnim({
  name,
  size = 120,
  loop = false,
  autoPlay = true,
  onFinish,
}: LottieAnimProps): ReactNode {
  const source = LOTTIE_SOURCES[name];
  if (!source) return null;

  // LottieView takes no accessibility props, so the wrapper carries them.
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LottieView
        source={source}
        autoPlay={autoPlay}
        loop={loop}
        style={{ width: size, height: size }}
        onAnimationFinish={(isCancelled) => {
          if (!isCancelled) onFinish?.();
        }}
      />
    </View>
  );
}
