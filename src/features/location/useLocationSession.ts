import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isBackgroundTrackingActive, startBackgroundTracking, stopBackgroundTracking, type BackgroundTrackingStatus } from './backgroundTracking';
import { findCachedPlace, getLatestCachedLocation, saveCachedPlace, saveLocationFix } from '../offline/offlineStore';
import { distanceBetweenMeters, resolvePlace, type ResolvedPlace } from './placeResolver';

type SessionStatus = 'requesting' | 'ready' | 'permission-denied' | 'services-disabled' | 'unavailable';
type PlaceStatus = 'idle' | 'resolving' | 'resolved' | 'unavailable';

const MAX_FRESH_AGE_MS = 30_000;
const GEOCODE_MIN_DISTANCE_METERS = 25;
const GEOCODE_MIN_INTERVAL_MS = 20_000;
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
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundTrackingStatus>('stopped');
  const [backgroundMessage, setBackgroundMessage] = useState<string | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const positionRef = useRef<Location.LocationObject | null>(null);
  const aliveRef = useRef(true);
  const geocodeBusyRef = useRef(false);
  const queuedCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastGeocodedRef = useRef<{ latitude: number; longitude: number; at: number } | null>(null);

  const updatePlace = useCallback(async (latitude: number, longitude: number, force = false) => {
    const previous = lastGeocodedRef.current;
    if (!force && previous) {
      const moved = distanceBetweenMeters(previous, { latitude, longitude });
      if (moved < GEOCODE_MIN_DISTANCE_METERS && Date.now() - previous.at < GEOCODE_MIN_INTERVAL_MS) return;
    }
    if (geocodeBusyRef.current) {
      queuedCoordinateRef.current = { latitude, longitude };
      return;
    }

    geocodeBusyRef.current = true;
    setPlaceStatus('resolving');
    try {
      const cached = await findCachedPlace(latitude, longitude);
      if (!aliveRef.current) return;
      if (cached) {
        setPlace(cached);
        setPlaceStatus('resolved');
      }
      const network = await Network.getNetworkStateAsync();
      if (network.isInternetReachable === false || network.isConnected === false) {
        if (cached) {
          setError('Offline · showing the closest saved place name.');
        } else {
          setPlaceStatus('unavailable');
          setError('You are offline. A place name will appear when this area has been resolved online.');
        }
        return;
      }
      let coordinate: { latitude: number; longitude: number } | null = { latitude, longitude };
      while (coordinate && aliveRef.current) {
        const resolved = await resolvePlace(coordinate.latitude, coordinate.longitude);
        if (!aliveRef.current) return;
        if (resolved) {
          setPlace(resolved);
          setPlaceStatus('resolved');
          setError(null);
          await saveCachedPlace(resolved, coordinate.latitude, coordinate.longitude);
        } else if (!cached) {
          setPlaceStatus('unavailable');
          setError('Your coordinates are available, but no nearby place name was returned.');
        }
        lastGeocodedRef.current = { ...coordinate, at: Date.now() };
        coordinate = queuedCoordinateRef.current;
        queuedCoordinateRef.current = null;
      }
    } catch {
      if (aliveRef.current) {
        const cached = await findCachedPlace(latitude, longitude).catch(() => null);
        if (cached) {
          setPlace(cached);
          setPlaceStatus('resolved');
          setError('Offline place name · showing the closest saved match.');
        } else {
          setPlaceStatus('unavailable');
          setError('Place lookup is temporarily unavailable. Your live position is still updating.');
        }
      }
    } finally {
      geocodeBusyRef.current = false;
    }
  }, []);

  const receivePosition = useCallback((next: Location.LocationObject) => {
    if (!aliveRef.current) return;
    positionRef.current = next;
    setNow(Date.now());
    setPosition(next);
    setStatus('ready');
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
        if (!cancelled && cached) {
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
          setNow(Date.now());
          setStatus('ready');
          const cachedPlace = await findCachedPlace(cached.latitude, cached.longitude);
          if (!cancelled && cachedPlace) {
            setPlace(cachedPlace);
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
    void isBackgroundTrackingActive().then((running) => {
      if (!cancelled && running) setBackgroundStatus('running');
    });

    const freshnessTimer = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      cancelled = true;
      aliveRef.current = false;
      clearInterval(freshnessTimer);
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

  const ageMs = position ? Math.max(0, now - position.timestamp) : null;
  const isFresh = ageMs !== null && ageMs <= MAX_FRESH_AGE_MS;
  const accuracy = position?.coords.accuracy ?? null;
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
