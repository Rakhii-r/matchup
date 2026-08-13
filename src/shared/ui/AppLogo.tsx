/**
 * AppLogo — the sixfour24 brand mark. Single source of truth for the logo so
 * every screen shows the same image.
 *
 * Two lockups, because they are not interchangeable:
 *   variant="full" (default) — 6/4 monogram + wordmark. Use where the app needs
 *     to name itself: splash, login, empty states.
 *   variant="icon" — monogram only, square. Use in tight furniture like a
 *     header or an avatar slot, where the wordmark would be unreadable anyway.
 *
 * Usage:
 *   <AppLogo />                    // 160px wide lockup
 *   <AppLogo variant="icon" width={40} />
 */
import { Image } from 'react-native';
import type { StyleProp, ImageStyle } from 'react-native';

// Ratios come from the intrinsic asset dimensions (1672x941 and 1254x1254).
// Hardcoded rather than measured so layout never jumps while the image decodes.
const FULL_RATIO = 1672 / 941;
const ICON_RATIO = 1;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_FULL = require('../../../assets/images/sixfour24-logo.png') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_ICON = require('../../../assets/images/sixfour24-icon.png') as number;

interface AppLogoProps {
  /** Rendered width in px. Height is derived from the lockup's aspect ratio. */
  width?: number;
  variant?: 'full' | 'icon';
  style?: StyleProp<ImageStyle>;
}

export function AppLogo({
  width = 160,
  variant = 'full',
  style,
}: AppLogoProps): React.ReactNode {
  const isIcon = variant === 'icon';
  return (
    <Image
      source={isIcon ? LOGO_ICON : LOGO_FULL}
      style={[{ width, height: width / (isIcon ? ICON_RATIO : FULL_RATIO) }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="sixfour24"
    />
  );
}
