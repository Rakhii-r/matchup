import * as Location from 'expo-location';

import { logger } from '@core/logging/logger';

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Best-effort device location for stamping a match's coordinates. Requests foreground
 * permission once; returns null (never throws) if permission is denied or the lookup
 * fails, so callers can fall back to the user's saved home area.
 */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return null;
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
