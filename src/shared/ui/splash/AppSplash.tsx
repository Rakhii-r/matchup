/**
 * AppSplash — full-screen splash overlay.
 *
 * Renders over the app until `visible` turns false, then fades out
 * and calls `onHidden` so the caller can hide the native splash.
 *
 * Intentionally has NO useTheme() dependency — always renders dark.
 */
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Animated } from 'react-native';

import { SplashBackground } from './SplashBackground';
import { AnimatedLogo } from './AnimatedLogo';
import { LoadingIndicator } from './LoadingIndicator';


interface AppSplashProps {
  visible: boolean;
  onHidden: () => void;
}

export function AppSplash({ visible, onHidden }: AppSplashProps): React.ReactNode {
  const opacity = useMemo(() => new Animated.Value(1), []);
  const mounted = useRef(true);

  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!visible) {
      // Minimum display time 1.4s so animations complete, then fade out
      const timer = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(() => {
          if (mounted.current) onHidden();
        });
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [visible, opacity, onHidden]);

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="none">
      <SplashBackground />

      {/* Logo centred vertically, pushed slightly above centre */}
      <Animated.View style={styles.content}>
        <AnimatedLogo />
        <LoadingIndicator />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    /*
      left/right/top/bottom: 0 already stretches this to the parent. The
      `width`/`height` that used to sit here came from a module-scope
      `Dimensions.get('window')` — captured once at import, so it kept the
      launch-time size through a rotation or a split-screen resize and left a
      strip of the app visible beside the splash.
    */
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: '#003D29',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    marginTop: -40, // slightly above centre
  },
});
