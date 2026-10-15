import * as Location from 'expo-location';
import { AsyncLookupCache } from './asyncLookupCache';
import { isValidCoordinate } from './locationTelemetry';

export type ResolvedPlace = {
  title: string;
  subtitle: string;
  address: Location.LocationGeocodedAddress;
  source?: 'online' | 'cached';
  cacheCoordinate?: { latitude: number; longitude: number };
  cacheDistanceMeters?: number;
  cachedAt?: number;
};

const MEMORY_PLACE_TTL_MS = 5 * 60 * 1000;
const REVERSE_GEOCODE_TIMEOUT_MS = 10_000;
const memoryPlaceCache = new AsyncLookupCache<ResolvedPlace>(MEMORY_PLACE_TTL_MS);

function coordinateKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Reverse geocoding timed out')), timeoutMs);
    }),
  ]).finally(() => { if (timeoutId) clearTimeout(timeoutId); });
}

export async function resolvePlace(
  latitude: number,
  longitude: number,
): Promise<ResolvedPlace | null> {
  if (!isValidCoordinate(latitude, longitude)) return null;
  const key = coordinateKey(latitude, longitude);
  const result = await memoryPlaceCache.getOrLoad(key, async () => {
    const results = await withTimeout(
      Location.reverseGeocodeAsync({ latitude, longitude }),
      REVERSE_GEOCODE_TIMEOUT_MS,
    );
    const address = results[0];
    if (!address) return null;

    const title = address.street || address.name || address.district || address.city || address.region || 'Unnamed location';
    const subtitle = [address.district, address.city, address.region, address.country]
      .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
      .filter((part) => part !== title)
      .join(', ');
    return { title, subtitle: subtitle || 'Current position', address };
  });
  return result ? { ...result.value, source: result.source } : null;
}

export function distanceBetweenMeters(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;

  return 12_742_000 * Math.asin(Math.sqrt(a));
}
