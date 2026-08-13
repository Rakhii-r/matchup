/**
 * AnimatedLogo — sixfour24 brand mark with entry sequence + continuous glow pulse.
 *
 * Sequence:
 *   fade in + scale 0.8 → 1  (spring with small overshoot bounce)
 *   → continuous glow pulse (loop)
 *
 * App name fades up below, then the tagline.
 */
import { Image, StyleSheet, View } from 'react-native';
import { MotiView, MotiText } from 'moti';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_LOGO = require('../../../../assets/images/sixfour24-logo.png') as number;

// Intrinsic asset is 1672x941 (~1.78:1); keep that ratio when sizing.
const LOGO_WIDTH = 220;
const LOGO_HEIGHT = LOGO_WIDTH / (1672 / 941);

export function AnimatedLogo(): React.ReactNode {
  return (
    <View style={styles.container}>
      {/* Glow ring — continuous pulse behind logo */}
      <MotiView
        style={styles.glowRing}
        from={{ opacity: 0.12, scale: 0.9 }}
        animate={{ opacity: 0.35, scale: 1.15 }}
        transition={{
          type: 'timing',
          duration: 1800,
          loop: true,
          repeatReverse: true,
        }}
      />

      {/* Logo entry: fade + scale with spring bounce */}
      <MotiView
        from={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          type: 'spring',
          damping: 12,
          stiffness: 120,
          mass: 0.8,
          delay: 200,
        }}
      >
        <Image
          source={APP_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="sixfour24"
        />
      </MotiView>

      {/*
        No app-name text: the lockup above already contains the wordmark, and
        rendering it twice read as a mistake. The tagline still fades in.
      */}
      {/* Tagline — fades in after name */}
      <MotiView
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 500, delay: 1100 }}
      >
        <MotiText style={styles.tagline}>PLAY · CONNECT · WIN</MotiText>
      </MotiView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#22C55E',
    top: -36,
    alignSelf: 'center',
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 16,
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 4,
    textAlign: 'center',
    marginTop: 6,
  },
});
