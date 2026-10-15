import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { PermissionsAndroid, Platform } from 'react-native';

import { BACKGROUND_LOCATION_TASK } from './backgroundLocationTask';
import { finishRouteSession, startRouteSession } from '../offline/offlineStore';

export type BackgroundTrackingStatus = 'stopped' | 'starting' | 'running' | 'permission-needed' | 'unavailable' | 'error';
let activePowerSaveProfile: boolean | null = null;
let profileUpdatePromise: Promise<void> | null = null;

function trackingOptions(powerSave: boolean) {
  return {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: powerSave ? 30_000 : 10_000,
    distanceInterval: powerSave ? 45 : 15,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'NavDiret is tracking your trip',
      notificationBody: powerSave
        ? 'Battery saver is on · GPS updates are less frequent. Trip details stay on this device. Tap to return.'
        : 'GPS tracking is active · trip details stay on this device. Tap to return to NavDiret.',
      notificationColor: '#146B68',
      killServiceOnDestroy: false,
    },
  };
}

async function getPowerSaveProfile() {
  try {
    const power = await Battery.getPowerStateAsync();
    return power.lowPowerMode || (power.batteryState === Battery.BatteryState.UNPLUGGED
      && power.batteryLevel >= 0 && power.batteryLevel <= 0.2);
  } catch { return false; }
}

async function requestTrackingNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  try {
    if (await PermissionsAndroid.check(permission)) return true;
    const result = await PermissionsAndroid.request(permission, {
      title: 'Show trip tracking status',
      message: 'NavDiret uses an ongoing notification while screen-off location tracking is active. It shows tracking status and provides a way back to the app. Your trip details stay on this device.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function isBackgroundTrackingActive() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startBackgroundTracking() {
  if (!(await Location.isBackgroundLocationAvailableAsync())) {
    return { status: 'unavailable' as const, message: 'Background location is not available on this device.' };
  }

  let foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return { status: 'permission-needed' as const, message: 'Allow location access while using NavDiret first.' };
  }

  let background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted') background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    return { status: 'permission-needed' as const, message: 'Allow all-the-time location access in system settings to track with the screen off.' };
  }

  const notificationsAllowed = await requestTrackingNotificationPermission();

  if (await isBackgroundTrackingActive()) return { status: 'running' as const, message: null };

  await startRouteSession();
  const powerSave = await getPowerSaveProfile();
  try {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      ...trackingOptions(powerSave),
    });
    activePowerSaveProfile = powerSave;
    return {
      status: 'running' as const,
      message: [
        powerSave ? 'Battery saver is active. Background location samples will be less frequent to extend battery life.' : null,
        !notificationsAllowed ? 'Notification access is off. Android keeps the tracking service visible in Task Manager, but may hide it from the notification drawer.' : null,
      ].filter(Boolean).join(' ') || null,
    };
  } catch (error) {
    await finishRouteSession();
    return {
      status: 'error' as const,
      message: error instanceof Error ? error.message : 'Background tracking could not start.',
    };
  }
}

export async function refreshBackgroundTrackingPowerProfile() {
  if (profileUpdatePromise) return profileUpdatePromise;
  profileUpdatePromise = (async () => {
    if (!(await isBackgroundTrackingActive())) return;
    const nextProfile = await getPowerSaveProfile();
    if (nextProfile === activePowerSaveProfile) return;
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, trackingOptions(nextProfile));
      activePowerSaveProfile = nextProfile;
    } catch (error) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, trackingOptions(activePowerSaveProfile ?? false)).catch(() => undefined);
      throw error;
    }
  })().finally(() => { profileUpdatePromise = null; });
  return profileUpdatePromise;
}

export async function stopBackgroundTracking() {
  if (await isBackgroundTrackingActive()) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  activePowerSaveProfile = null;
  await finishRouteSession();
}
