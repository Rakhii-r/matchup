/**
 * LoadingIndicator — three pulsing dots with staggered timing.
 * Each dot scales 1→1.5→1 in a loop, offset by 200ms.
 * Appears after logo entrance is complete (delay: 1100ms).
 */
import { StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';

const DOTS = [0, 1, 2] as const;

export function LoadingIndicator(): React.ReactNode {
  return (
    <MotiView
      style={styles.row}
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: 400, delay: 1100 }}
    >
      {DOTS.map((i) => (
        <MotiView
          key={i}
          style={styles.dot}
          from={{ scale: 1, opacity: 0.4 }}
          animate={{ scale: 1.6, opacity: 1 }}
          transition={{
            type: 'timing',
            duration: 600,
            delay: i * 200,
            loop: true,
            repeatReverse: true,
          }}
        />
      ))}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
});
