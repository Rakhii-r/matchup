export interface MapDirectionsParams {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  name?: string | null;
}

type LinkingType = {
  openURL: (url: string) => Promise<any>;
  canOpenURL?: (url: string) => Promise<boolean>;
};

type PlatformType = {
  OS: 'ios' | 'android' | 'windows' | 'macos' | 'web';
};

function getNativeModules(): { Linking: LinkingType; Platform: PlatformType } {
  try {
    const rnPackage = 'react-native';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = typeof require !== 'undefined' ? require(rnPackage) : null;
    if (rn && rn.Linking && rn.Platform) {
      return { Linking: rn.Linking, Platform: rn.Platform };
    }
  } catch {
    // Fallback in Node.js test environments
  }

  return {
    Platform: { OS: 'web' },
    Linking: {
      openURL: async () => Promise.resolve(),
      canOpenURL: async () => false,
    },
  };
}

/**
 * Builds the platform-specific navigation URL or universal Google Maps fallback URL.
 */
export function getMapDirectionsUrl(
  params: MapDirectionsParams,
  platform?: 'ios' | 'android' | 'web',
): string {
  const targetPlatform = platform || getNativeModules().Platform.OS;
  const { lat, lng, address, name } = params;
  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    (lat !== 0 || lng !== 0);

  const cleanAddress = address?.trim() || '';
  const cleanName = name?.trim() || '';
  const label = cleanName || cleanAddress || 'Venue';
  const queryFallback = cleanAddress || cleanName || '';

  if (!hasCoords && !queryFallback) {
    return 'https://www.google.com/maps';
  }

  if (targetPlatform === 'ios') {
    if (hasCoords) {
      return `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`;
    }
    return `http://maps.apple.com/?daddr=${encodeURIComponent(queryFallback)}`;
  }

  if (targetPlatform === 'android') {
    if (hasCoords) {
      return `geo:0,0?q=${lat},${lng}(${encodeURIComponent(label)})`;
    }
    return `geo:0,0?q=${encodeURIComponent(queryFallback)}`;
  }

  // Web fallback (Universal Google Maps Directions URL)
  if (hasCoords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(queryFallback)}`;
}

/**
 * Launches the device's native map application (Apple Maps on iOS, geo URI on Android)
 * with graceful fallback to the universal Google Maps web directions URL.
 */
export async function openMapDirections(params: MapDirectionsParams): Promise<boolean> {
  const { Linking, Platform } = getNativeModules();
  const { lat, lng, address, name } = params;
  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    (lat !== 0 || lng !== 0);

  const cleanAddress = address?.trim() || '';
  const cleanName = name?.trim() || '';

  if (!hasCoords && !cleanAddress && !cleanName) {
    return false;
  }

  const webUrl = getMapDirectionsUrl(params, 'web');

  try {
    if (Platform.OS === 'ios') {
      const appleUrl = getMapDirectionsUrl(params, 'ios');
      const canOpen = Linking.canOpenURL ? await Linking.canOpenURL(appleUrl).catch(() => false) : true;
      if (canOpen) {
        await Linking.openURL(appleUrl);
        return true;
      }
    } else if (Platform.OS === 'android') {
      const geoUrl = getMapDirectionsUrl(params, 'android');
      const canOpen = Linking.canOpenURL ? await Linking.canOpenURL(geoUrl).catch(() => false) : true;
      if (canOpen) {
        await Linking.openURL(geoUrl);
        return true;
      }
    }

    // Universal web directions fallback
    await Linking.openURL(webUrl);
    return true;
  } catch {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
}
