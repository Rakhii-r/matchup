/**
 * LoadingIndicator — a slim track with a lime segment sweeping across it.
 *
 * Indeterminate on purpose: the splash waits on auth and fonts, neither of
 * which reports progress, so a bar that filled up would be making a number up.
 * Appears once the logo has landed (delay: 900ms).
 */
import { StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';
import { Easing } from 'react-native-reanimated';

const TRACK = 132;
const SEGMENT = 44;

export function LoadingIndicator(): React.ReactNode {
  return (
    <MotiView
      style={styles.wrap}
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: 400, delay: 900 }}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <View style={styles.track}>
        <MotiView
          style={styles.segment}
          from={{ translateX: -SEGMENT }}
          animate={{ translateX: TRACK }}
          transition={{
            type: 'timing',
            duration: 1100,
            easing: Easing.inOut(Easing.cubic),
            loop: true,
            repeatReverse: false,
          }}
        />
      </View>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 26 },
  track: {
    width: TRACK,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  segment: { width: SEGMENT, height: 4, borderRadius: 2, backgroundColor: '#B7F04A' },
});
