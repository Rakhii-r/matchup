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
