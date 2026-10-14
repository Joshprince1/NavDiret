import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { findCachedPlace, getBackgroundGeocodeState, saveCachedPlace, saveLocationFix, setBackgroundGeocodeState } from '../offline/offlineStore';
import { distanceBetweenMeters, resolvePlace } from './placeResolver';

export const BACKGROUND_LOCATION_TASK = 'navdiret-background-location-v1';

type LocationTaskPayload = { locations?: Location.LocationObject[] };
const MIN_BACKGROUND_GEOCODE_INTERVAL_MS = 2 * 60 * 1000;
const MIN_BACKGROUND_GEOCODE_DISTANCE_METERS = 200;
let geocodeInProgress = false;

async function resolveBackgroundPlace(location: Location.LocationObject) {
  if (geocodeInProgress) return;
  const { latitude, longitude } = location.coords;
  if (await findCachedPlace(latitude, longitude).catch(() => null)) return;

  const network = await Network.getNetworkStateAsync().catch(() => null);
  if (!network || network.isInternetReachable === false || network.isConnected === false) return;
  const power = await Battery.getPowerStateAsync().catch(() => null);
  if (power && (power.lowPowerMode || (power.batteryState === Battery.BatteryState.UNPLUGGED
    && power.batteryLevel >= 0 && power.batteryLevel <= 0.15))) return;

  const previous = await getBackgroundGeocodeState().catch(() => null);
  const now = Date.now();
  if (previous && (now - previous.at < MIN_BACKGROUND_GEOCODE_INTERVAL_MS
    || distanceBetweenMeters(previous, { latitude, longitude }) < MIN_BACKGROUND_GEOCODE_DISTANCE_METERS)) return;

  geocodeInProgress = true;
  try {
    // Persist the attempt first so task restarts and failed lookups remain throttled.
    await setBackgroundGeocodeState({ latitude, longitude, at: now });
    const place = await resolvePlace(latitude, longitude);
    if (place) await saveCachedPlace(place, latitude, longitude);
  } finally {
    geocodeInProgress = false;
  }
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask<LocationTaskPayload>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    for (const location of data.locations) {
      await saveLocationFix(location, 'background');
      try { await resolveBackgroundPlace(location); } catch { /* Keep background tracking alive if lookup or storage fails. */ }
    }
  });
}
