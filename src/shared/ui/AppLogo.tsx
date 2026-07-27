/**
 * AppLogo — the P24 brand mark. Single source of truth for the logo
 * so every screen shows the same image.
 *
 * Usage:
 *   <AppLogo />          // default 160px wide
 *   <AppLogo width={120} />
 */
import { Image } from 'react-native';
import type { StyleProp, ImageStyle } from 'react-native';

// Intrinsic asset is 1038x576 (~1.8:1); keep that ratio when sizing.
const ASPECT_RATIO = 1038 / 576;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_LOGO = require('../../../assets/images/logo-p24.png') as number;

interface AppLogoProps {
  /** Rendered width in px. Height is derived from the logo's aspect ratio. */
  width?: number;
  style?: StyleProp<ImageStyle>;
}

export function AppLogo({ width = 160, style }: AppLogoProps): React.ReactNode {
  return (
    <Image
      source={APP_LOGO}
      style={[{ width, height: width / ASPECT_RATIO }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="P24"
    />
  );
}
