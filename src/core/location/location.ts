import { Alert } from 'react-native';
import * as Location from 'expo-location';

import { logger } from '@core/logging/logger';

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Prominent In-App Disclosure for Google Play compliance.
 * Must be presented BEFORE invoking the OS permission request dialog.
 */
async function showLocationDisclosure(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Location Access',
      'SIXFOUR 24 uses your location to find nearby box cricket venues, match opponents on the radar, and show local open games. Your location is used solely for gameplay and venue discovery and is never shared for advertising.',
      [
        {
          text: 'Not Now',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: 'Continue',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: false }
    );
  });
}

/**
 * Best-effort device location for stamping a match's coordinates.
 * Prominently discloses location use before requesting foreground permission.
 * Returns null (never throws) if permission is denied or lookup fails.
 */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.status !== Location.PermissionStatus.GRANTED) {
      if (existing.canAskAgain) {
        const accepted = await showLocationDisclosure();
        if (!accepted) return null;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) return null;
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch (error) {
    logger.warn('getCurrentCoords failed', { error: String(error) });
    return null;
  }
}

/**
 * Reverse-geocode coordinates to a human-readable area/locality name (e.g. "Baner, Pune").
 */
export async function getAreaNameFromCoords(coords: Coords): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    if (results && results.length > 0 && results[0]) {
      const first = results[0];
      const area = first.district || first.subregion || first.name || first.city;
      const city = first.city || first.region;
      if (area && city && area !== city) {
        return `${area}, ${city}`;
      }
      return area || city || null;
    }
    return null;
  } catch (error) {
    logger.warn('getAreaNameFromCoords failed', { error: String(error) });
    return null;
  }
}
