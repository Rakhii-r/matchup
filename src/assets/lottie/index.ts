/* eslint-disable @typescript-eslint/no-require-imports */
import type { AnimationObject } from 'lottie-react-native';

/** Every animation the app knows by name. See README.md in this folder. */
export type LottieName = 'success' | 'loading' | 'empty' | 'match-found' | 'confetti';

/**
 * Name -> bundled animation.
 *
 * A file is registered by un-commenting its line AFTER the JSON is in this
 * folder. The lines cannot be live before that: Metro resolves `require()` when
 * it builds the bundle, so a line pointing at a missing file fails the whole
 * build rather than failing quietly at runtime.
 *
 * A name with no line here is simply not available yet, and `<LottieAnim>`
 * renders nothing for it.
 */
export const LOTTIE_SOURCES: Partial<Record<LottieName, AnimationObject>> = {
  // success: require('./success.json'),
  // loading: require('./loading.json'),
  // empty: require('./empty.json'),
  // 'match-found': require('./match-found.json'),
  // confetti: require('./confetti.json'),
};
