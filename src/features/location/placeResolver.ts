import * as Location from 'expo-location';

export type ResolvedPlace = {
  title: string;
  subtitle: string;
  address: Location.LocationGeocodedAddress;
};

export async function resolvePlace(
  latitude: number,
  longitude: number,
): Promise<ResolvedPlace | null> {
  const results = await Location.reverseGeocodeAsync({ latitude, longitude });
  const address = results[0];

  if (!address) return null;

  const title = address.street || address.name || address.district || address.city || address.region || 'Unnamed location';
  const subtitle = [address.district, address.city, address.region, address.country]
    .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
    .filter((part) => part !== title)
    .join(', ');

  return { title, subtitle: subtitle || 'Current position', address };
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
