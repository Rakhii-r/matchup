/**
 * SplashBackground — animated dark sports background.
 * Layered: LinearGradient base + SVG glow rings + floating particles via Moti.
 */
import { StyleSheet, View, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

const PARTICLES = [
  { x: 0.12, y: 0.18, r: 3, dur: 3200, delay: 0 },
  { x: 0.82, y: 0.12, r: 2, dur: 2800, delay: 400 },
  { x: 0.25, y: 0.72, r: 2.5, dur: 3600, delay: 800 },
  { x: 0.68, y: 0.65, r: 3, dur: 2600, delay: 200 },
  { x: 0.45, y: 0.85, r: 2, dur: 3000, delay: 600 },
  { x: 0.88, y: 0.42, r: 3.5, dur: 3400, delay: 1000 },
  { x: 0.08, y: 0.55, r: 2, dur: 2900, delay: 300 },
  { x: 0.55, y: 0.22, r: 2.5, dur: 3100, delay: 700 },
  { x: 0.72, y: 0.88, r: 2, dur: 2700, delay: 500 },
  { x: 0.35, y: 0.45, r: 3, dur: 3300, delay: 900 },
  { x: 0.92, y: 0.78, r: 2.5, dur: 2850, delay: 150 },
  { x: 0.18, y: 0.35, r: 2, dur: 3150, delay: 450 },
] as const;

export function SplashBackground(): React.ReactNode {
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Deep dark gradient */}
      <LinearGradient
        colors={['#040D18', '#071A10', '#030C16', '#020A0F']}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Stadium glow rings (SVG) */}
      <Svg style={StyleSheet.absoluteFill} width={W} height={H}>
        <Defs>
          <RadialGradient id="gl" cx="22%" cy="18%" r="42%">
            <Stop offset="0%" stopColor="#4CAF50" stopOpacity="0.22" />
            <Stop offset="100%" stopColor="#4CAF50" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="gr" cx="78%" cy="18%" r="42%">
            <Stop offset="0%" stopColor="#4CAF50" stopOpacity="0.18" />
            <Stop offset="100%" stopColor="#4CAF50" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="gc" cx="50%" cy="52%" r="35%">
            <Stop offset="0%" stopColor="#1565C0" stopOpacity="0.1" />
            <Stop offset="100%" stopColor="#1565C0" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={W * 0.22} cy={H * 0.18} r={W * 0.55} fill="url(#gl)" />
        <Circle cx={W * 0.78} cy={H * 0.18} r={W * 0.55} fill="url(#gr)" />
        <Circle cx={W * 0.5} cy={H * 0.52} r={W * 0.5} fill="url(#gc)" />
      </Svg>

      {/* Floating particles */}
      {PARTICLES.map((p, i) => (
        <MotiView
          key={i}
          style={[
            styles.particle,
            { left: W * p.x, top: H * p.y, width: p.r * 2, height: p.r * 2, borderRadius: p.r },
          ]}
          from={{ opacity: 0.15, translateY: 0 }}
          animate={{ opacity: 0.7, translateY: -14 }}
          transition={{
            type: 'timing',
            duration: p.dur,
            delay: p.delay,
            loop: true,
            repeatReverse: true,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    backgroundColor: '#66BB6A',
  },
});
