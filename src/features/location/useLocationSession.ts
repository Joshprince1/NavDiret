import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { isBackgroundTrackingActive, startBackgroundTracking, stopBackgroundTracking, type BackgroundTrackingStatus } from './backgroundTracking';
import { findCachedPlace, getLatestCachedLocation, saveCachedPlace, saveLocationFix } from '../offline/offlineStore';
import { distanceBetweenMeters, resolvePlace, type ResolvedPlace } from './placeResolver';
import { buildLocationTelemetry, getBackgroundRecoveryStatus, getLocationFreshness, isAddressRelevantToCurrentPosition, isLocationFixNewer, isValidCoordinate, shouldAttemptAddressLookup } from './locationTelemetry';
import type { LocationTelemetry } from './locationTelemetry';

type SessionStatus = 'requesting' | 'ready' | 'permission-denied' | 'services-disabled' | 'unavailable';
type PlaceStatus = 'idle' | 'resolving' | 'resolved' | 'unavailable';

const MAX_FRESH_AGE_MS = 30_000;
const GEOCODE_MIN_DISTANCE_METERS = 50;
const GEOCODE_MIN_INTERVAL_MS = 30_000;
const MAX_DISPLAYED_PLACE_DISTANCE_METERS = 100;
const LOCATION_TIMEOUT_MS = 20_000;

function getCurrentPositionWithTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
      mayShowUserSettingsDialog: true,
    }),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('GPS request timed out')), LOCATION_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function useLocationSession() {
  const [status, setStatus] = useState<SessionStatus>('requesting');
  const [placeStatus, setPlaceStatus] = useState<PlaceStatus>('idle');
  const [permission, setPermission] = useState<Location.LocationPermissionResponse | null>(null);
  const [position, setPosition] = useState<Location.LocationObject | null>(null);
  const [place, setPlace] = useState<ResolvedPlace | null>(null);
  const [coordinateSource, setCoordinateSource] = useState<'gps' | 'cached'>('gps');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [offlineGeocoding, setOfflineGeocoding] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundTrackingStatus>('stopped');
  const [backgroundMessage, setBackgroundMessage] = useState<string | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const positionRef = useRef<Location.LocationObject | null>(null);
  const placeCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const aliveRef = useRef(true);
  const geocodeBusyRef = useRef(false);
  const queuedCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastGeocodedRef = useRef<{ latitude: number; longitude: number; at: number } | null>(null);

  const updatePlace = useCallback(async (latitude: number, longitude: number, force = false) => {
    const nextCoordinate = { latitude, longitude };
    const previous = lastGeocodedRef.current;
    if (!shouldAttemptAddressLookup(previous, nextCoordinate, Date.now(), force, GEOCODE_MIN_INTERVAL_MS, GEOCODE_MIN_DISTANCE_METERS)) return;
    if (geocodeBusyRef.current) {
      queuedCoordinateRef.current = nextCoordinate;
      return;
    }

    geocodeBusyRef.current = true;
    setPlaceStatus('resolving');
    try {
      let coordinate: { latitude: number; longitude: number } | null = nextCoordinate;
      while (coordinate && aliveRef.current) {
        const priorAttempt = lastGeocodedRef.current;
        if (coordinate !== nextCoordinate && !shouldAttemptAddressLookup(
          priorAttempt, coordinate, Date.now(), force, GEOCODE_MIN_INTERVAL_MS, GEOCODE_MIN_DISTANCE_METERS,
        )) {
          setPlaceStatus(placeCoordinateRef.current ? 'resolved' : 'unavailable');
          break;
        }
        const attemptAt = Date.now();
        lastGeocodedRef.current = { ...coordinate, at: attemptAt };
        const cached = await findCachedPlace(coordinate.latitude, coordinate.longitude).catch(() => null);
        if (!aliveRef.current) return;
        const livePosition = positionRef.current;
        const cachedCoordinate = cached?.cacheCoordinate ?? coordinate;
        const cacheCanRepresentCurrentPosition = isAddressRelevantToCurrentPosition(
          cachedCoordinate,
          livePosition ? { latitude: livePosition.coords.latitude, longitude: livePosition.coords.longitude } : null,
          MAX_DISPLAYED_PLACE_DISTANCE_METERS,
        );
        if (cached && cacheCanRepresentCurrentPosition) {
          setPlace({ ...cached, source: 'cached' });
          placeCoordinateRef.current = cachedCoordinate;
          setPlaceStatus('resolved');
        }

        const network = await Network.getNetworkStateAsync().catch(() => null);
        if (!network || network.isInternetReachable === false || network.isConnected === false) {
          setOfflineGeocoding(true);
          if (aliveRef.current && !queuedCoordinateRef.current) {
            setPlaceStatus(cached && cacheCanRepresentCurrentPosition ? 'resolved' : 'unavailable');
            setError(cached && cacheCanRepresentCurrentPosition
              ? 'Offline · showing a nearby place saved on this device.'
              : 'You are offline. Your GPS position is still available; a place name will appear after a lookup can run.');
          }
          coordinate = queuedCoordinateRef.current;
          queuedCoordinateRef.current = null;
          continue;
        }

        setOfflineGeocoding(false);
        const resolved = await resolvePlace(coordinate.latitude, coordinate.longitude);
        if (!aliveRef.current) return;
        const latestPosition = positionRef.current;
        const resultStillRelevant = isAddressRelevantToCurrentPosition(
          coordinate,
          latestPosition ? { latitude: latestPosition.coords.latitude, longitude: latestPosition.coords.longitude } : null,
          MAX_DISPLAYED_PLACE_DISTANCE_METERS,
        );
        const hasNewerQueuedCoordinate = queuedCoordinateRef.current !== null;
        if (resolved) {
          await saveCachedPlace(resolved, coordinate.latitude, coordinate.longitude).catch(() => undefined);
          if (aliveRef.current && !hasNewerQueuedCoordinate && resultStillRelevant) {
            setPlace(resolved);
            placeCoordinateRef.current = coordinate;
            setPlaceStatus('resolved');
            setError(null);
          }
        } else if ((!cached || !cacheCanRepresentCurrentPosition) && !hasNewerQueuedCoordinate && resultStillRelevant) {
          setPlaceStatus('unavailable');
          setError('Your GPS coordinates are available, but the address provider returned no place name.');
        } else if (!hasNewerQueuedCoordinate && !resultStillRelevant) {
          setPlaceStatus(placeCoordinateRef.current ? 'resolved' : 'unavailable');
        }
        coordinate = queuedCoordinateRef.current;
        queuedCoordinateRef.current = null;
      }
    } catch {
      queuedCoordinateRef.current = null;
      if (aliveRef.current) {
        const cached = await findCachedPlace(latitude, longitude).catch(() => null);
        const latestPosition = positionRef.current;
        const canShowCached = Boolean(cached && latestPosition && distanceBetweenMeters(
          cached.cacheCoordinate ?? { latitude, longitude },
          { latitude: latestPosition.coords.latitude, longitude: latestPosition.coords.longitude },
        ) <= MAX_DISPLAYED_PLACE_DISTANCE_METERS);
        if (cached && canShowCached) {
          setPlace({ ...cached, source: 'cached' });
          placeCoordinateRef.current = cached.cacheCoordinate ?? { latitude, longitude };
          setPlaceStatus('resolved');
          setError('Place lookup failed · showing a nearby place saved on this device.');
        } else {
          setPlace(null);
          placeCoordinateRef.current = null;
          setPlaceStatus('unavailable');
          setError('Place lookup is temporarily unavailable. Your GPS coordinates continue updating.');
        }
      }
    } finally {
      geocodeBusyRef.current = false;
    }
  }, []);

  const receivePosition = useCallback((next: Location.LocationObject) => {
    if (!aliveRef.current) return;
    if (!isValidCoordinate(next.coords.latitude, next.coords.longitude)) {
      if (!positionRef.current) setStatus('unavailable');
      setError('The device returned an invalid GPS fix. Keeping the last valid position if one is available.');
      return;
    }
    if (!isLocationFixNewer(positionRef.current?.timestamp, next.timestamp)) return;
    positionRef.current = next;
    setNow(Date.now());
    setPosition(next);
    setCoordinateSource('gps');
    setStatus('ready');
    if (placeCoordinateRef.current && distanceBetweenMeters(placeCoordinateRef.current, {
      latitude: next.coords.latitude,
      longitude: next.coords.longitude,
    }) > MAX_DISPLAYED_PLACE_DISTANCE_METERS) {
      placeCoordinateRef.current = null;
      setPlace(null);
      setPlaceStatus('idle');
    }
    void saveLocationFix(next, 'foreground').catch(() => undefined);
    void updatePlace(next.coords.latitude, next.coords.longitude);
  }, [updatePlace]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const currentPermission = await Location.getForegroundPermissionsAsync();
      if (!aliveRef.current) return;
      setPermission(currentPermission);
      if (currentPermission.status !== 'granted') {
        const requested = await Location.requestForegroundPermissionsAsync();
        if (!aliveRef.current) return;
        setPermission(requested);
        if (requested.status !== 'granted') {
          setStatus('permission-denied');
          setError('Allow location access to see your live position and nearby place names.');
          return;
        }
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!aliveRef.current) return;
      if (!servicesEnabled) {
        setStatus('services-disabled');
        setError('Turn on device location services to find your current position.');
        return;
      }

      setStatus('requesting');
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 300_000, requiredAccuracy: 200 });
      if (lastKnown && aliveRef.current) receivePosition(lastKnown);
      const fresh = await getCurrentPositionWithTimeout();
      receivePosition(fresh);
    } catch (caught) {
      if (!aliveRef.current) return;
      setStatus('unavailable');
      setError(caught instanceof Error && caught.message.includes('timed out')
        ? 'A GPS fix is taking longer than expected. Move to an open area and try again.'
        : 'We could not get a GPS fix. Check signal and location settings, then try again.');
    }
  }, [receivePosition]);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    const startSession = async () => {
      try {
        const cached = await getLatestCachedLocation();
        if (!cancelled && cached && isValidCoordinate(cached.latitude, cached.longitude)) {
          const cachedPosition: Location.LocationObject = {
            coords: {
              latitude: cached.latitude,
              longitude: cached.longitude,
              accuracy: cached.accuracy,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: cached.timestamp,
            mocked: false,
          };
          positionRef.current = cachedPosition;
          setPosition(cachedPosition);
          setCoordinateSource('cached');
          setNow(Date.now());
          setStatus('ready');
          const cachedPlace = await findCachedPlace(cached.latitude, cached.longitude);
          if (!cancelled && cachedPlace) {
            setPlace({ ...cachedPlace, source: 'cached' });
            placeCoordinateRef.current = { latitude: cached.latitude, longitude: cached.longitude };
            setPlaceStatus('resolved');
          }
        }
      } catch {
        // A new install or unavailable database should not block GPS startup.
      }
      await refresh();
      if (cancelled || !aliveRef.current) return;
      try {
        const response = await Location.getForegroundPermissionsAsync();
        if (cancelled || response.status !== 'granted') return;
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 8_000, distanceInterval: 15 },
          receivePosition,
        );
        if (cancelled) subscription.remove();
        else subscriptionRef.current = subscription;
      } catch {
        if (aliveRef.current) setError('Live tracking could not start. Tap recenter to retry your location.');
      }
    };
    void startSession();
    const reconcileBackgroundTracking = async () => {
      try {
        const running = await isBackgroundTrackingActive();
        if (cancelled || !aliveRef.current) return;
        if (!running) {
          setBackgroundStatus(getBackgroundRecoveryStatus(false, false));
          return;
        }
        const permission = await Location.getBackgroundPermissionsAsync();
        if (cancelled || !aliveRef.current) return;
        const recoveredStatus = getBackgroundRecoveryStatus(true, permission.status === 'granted');
        if (recoveredStatus === 'permission-needed') {
          await stopBackgroundTracking();
          if (!cancelled && aliveRef.current) {
            setBackgroundStatus('permission-needed');
            setBackgroundMessage('Background location permission was removed. Tracking has stopped; enable it again to continue screen-off tracking.');
          }
          return;
        }
        setBackgroundStatus(recoveredStatus);
        setBackgroundMessage(null);
      } catch {
        if (!cancelled && aliveRef.current) {
          setBackgroundStatus('error');
          setBackgroundMessage('Tracking status could not be confirmed. Reopen NavDiret and check location permissions.');
        }
      }
    };
    void reconcileBackgroundTracking();
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void reconcileBackgroundTracking();
        void refresh();
      }
    });

    const freshnessTimer = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      cancelled = true;
      aliveRef.current = false;
      clearInterval(freshnessTimer);
      appStateSubscription.remove();
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [receivePosition, refresh]);

  const toggleBackgroundTracking = useCallback(async () => {
    setBackgroundMessage(null);
    if (backgroundStatus === 'running') {
      setBackgroundStatus('starting');
      try {
        await stopBackgroundTracking();
        setBackgroundStatus('stopped');
      } catch {
        setBackgroundStatus('error');
        setBackgroundMessage('Background tracking could not be stopped cleanly.');
      }
      return;
    }
    setBackgroundStatus('starting');
    try {
      const result = await startBackgroundTracking();
      setBackgroundStatus(result.status);
      setBackgroundMessage(result.message);
    } catch {
      setBackgroundStatus('error');
      setBackgroundMessage('Background location could not be started. Check permissions and try again.');
    }
  }, [backgroundStatus]);

  const ageMs = position && Number.isFinite(position.timestamp) ? Math.max(0, now - position.timestamp) : null;
  const freshness = getLocationFreshness(position?.timestamp, now, MAX_FRESH_AGE_MS);
  const isFresh = freshness === 'fresh';
  const accuracy = position?.coords.accuracy ?? null;
  const telemetry: LocationTelemetry = buildLocationTelemetry({
    position,
    place,
    placeStatus,
    offline: offlineGeocoding,
    freshness,
    coordinateSource,
  });
  const retryPlaceLookup = useCallback(() => {
    const latest = positionRef.current;
    if (latest) void updatePlace(latest.coords.latitude, latest.coords.longitude, true);
  }, [updatePlace]);

  return {
    status,
    placeStatus,
    permission,
    position,
    place,
    telemetry,
    error,
    ageMs,
    isFresh,
    accuracy,
    backgroundStatus,
    backgroundMessage,
    refresh,
    toggleBackgroundTracking,
    retryPlaceLookup,
  };
}
