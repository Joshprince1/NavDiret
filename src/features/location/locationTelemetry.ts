import type * as Location from 'expo-location';

export type TelemetryFreshness = 'fresh' | 'stale' | 'unavailable';
export type AddressSource = 'online' | 'cached' | 'offline' | 'unresolved';
export type TelemetryAddressStatus = 'resolving' | 'resolved' | 'unavailable' | 'idle';

export type LocationTelemetry = {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  street: string | null;
  area: string | null;
  nearbyRoad: string | null;
  city: string | null;
  country: string | null;
  timestamp: number | null;
  freshness: TelemetryFreshness;
  coordinateSource: 'gps' | 'cached' | 'unavailable';
  addressSource: AddressSource;
  addressStatus: TelemetryAddressStatus;
};

export type TelemetryPlace = {
  address: Location.LocationGeocodedAddress;
  source?: 'online' | 'cached';
};

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function getLocationFreshness(
  timestamp: number | null | undefined,
  now: number,
  maxAgeMs = 30_000,
): TelemetryFreshness {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp! > now + 5_000) return 'unavailable';
  return now - timestamp! <= maxAgeMs ? 'fresh' : 'stale';
}

export function isLocationFixNewer(currentTimestamp: number | null | undefined, nextTimestamp: number): boolean {
  if (!Number.isFinite(nextTimestamp)) return false;
  return !Number.isFinite(currentTimestamp) || nextTimestamp >= currentTimestamp!;
}

export function getBackgroundRecoveryStatus(isRunning: boolean, permissionGranted: boolean): 'running' | 'stopped' | 'permission-needed' {
  if (!isRunning) return 'stopped';
  return permissionGranted ? 'running' : 'permission-needed';
}

export function isAddressRelevantToCurrentPosition(
  requested: { latitude: number; longitude: number },
  current: { latitude: number; longitude: number } | null,
  maxDistanceMeters = 100,
): boolean {
  if (!current || !isValidCoordinate(requested.latitude, requested.longitude)
    || !isValidCoordinate(current.latitude, current.longitude)) return false;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(current.latitude - requested.latitude);
  const longitudeDelta = radians(current.longitude - requested.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(requested.latitude)) * Math.cos(radians(current.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const distanceMeters = 12_742_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
  return distanceMeters <= maxDistanceMeters;
}

export function shouldAttemptAddressLookup(
  previous: { latitude: number; longitude: number; at: number } | null,
  current: { latitude: number; longitude: number },
  now: number,
  force = false,
  minIntervalMs = 30_000,
  minDistanceMeters = 50,
): boolean {
  if (force || !previous) return true;
  return isValidCoordinate(current.latitude, current.longitude)
    && isValidCoordinate(previous.latitude, previous.longitude)
    && now - previous.at >= minIntervalMs
    && distanceBetween(previous, current) >= minDistanceMeters;
}

function distanceBetween(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

export function buildLocationTelemetry(input: {
  position: Location.LocationObject | null;
  place: TelemetryPlace | null;
  placeStatus: TelemetryAddressStatus;
  offline: boolean;
  freshness: TelemetryFreshness;
  coordinateSource?: 'gps' | 'cached';
}): LocationTelemetry {
  const { position, place, placeStatus, offline, freshness } = input;
  const latitude = position?.coords.latitude;
  const longitude = position?.coords.longitude;
  const validPosition = position && latitude !== undefined && longitude !== undefined && isValidCoordinate(latitude, longitude)
    ? position : null;
  const hasCoordinates = Boolean(validPosition);
  const address = validPosition ? place?.address : undefined;
  const street = address?.street || null;
  const namedRoad = address?.name || null;
  return {
    latitude: validPosition?.coords.latitude ?? null,
    longitude: validPosition?.coords.longitude ?? null,
    accuracyMeters: validPosition && Number.isFinite(validPosition.coords.accuracy) ? validPosition.coords.accuracy : null,
    street,
    area: address?.district || address?.subregion || null,
    nearbyRoad: namedRoad && namedRoad !== street ? namedRoad : null,
    city: address?.city || null,
    country: address?.country || null,
    timestamp: validPosition && Number.isFinite(validPosition.timestamp) ? validPosition.timestamp : null,
    freshness: hasCoordinates ? freshness : 'unavailable',
    coordinateSource: hasCoordinates ? input.coordinateSource ?? 'gps' : 'unavailable',
    addressSource: validPosition && place ? (place.source ?? 'online') : offline && hasCoordinates ? 'offline' : 'unresolved',
    addressStatus: hasCoordinates ? placeStatus : 'unavailable',
  };
}
