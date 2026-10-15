/**
 * SplashBackground — deep emerald, lit from behind the logo.
 *
 * A vertical gradient in the brand greens with one soft radial glow where the
 * logo sits. The floating particles and the blue-tinted rings are gone: with
 * two arcs already turning round the logo, more motion behind them was noise.
 */
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

export function SplashBackground(): React.ReactNode {
  /*
    Read live, not at module load. These numbers size the SVG canvas, so a
    value frozen at import left the glow cropped after a rotation or a
    split-screen resize.
  */
  const { width: W, height: H } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['#00583A', '#003D29', '#04140E']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <Svg style={StyleSheet.absoluteFill} width={W} height={H}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#34D399" stopOpacity="0.28" />
            <Stop offset="100%" stopColor="#34D399" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Sits a little above centre, where AppSplash places the logo. */}
        <Circle cx={W * 0.5} cy={H * 0.46} r={W * 0.75} fill="url(#glow)" />
      </Svg>
    </View>
  );
}
