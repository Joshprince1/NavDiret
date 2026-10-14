import Constants from 'expo-constants';

import type { Destination, RouteCoordinate, RouteManeuver, RoutePlan, RoutingProvider } from './routingTypes';

type ExpoExtra = { routingBaseUrl?: unknown; geocodingBaseUrl?: unknown; routingProfile?: unknown };
type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: { steps?: {
      name?: string;
      ref?: string;
      distance?: number;
      maneuver?: { type?: string; modifier?: string; location?: [number, number] };
    }[] }[];
  }[];
};
type GazetteerEntry = {
  place_id: number | string;
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
const asUrl = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : null;
const routingBaseUrl = asUrl(extra.routingBaseUrl);
const geocodingBaseUrl = asUrl(extra.geocodingBaseUrl);
const profile = typeof extra.routingProfile === 'string' ? extra.routingProfile : 'driving';

function assertPrivateEndpoint(value: string) {
  const host = new URL(value).hostname.toLowerCase();
  if (host === 'nominatim.openstreetmap.org' || host === 'router.project-osrm.org') {
    throw new Error('Use a privately operated endpoint to keep search and route coordinates off public service logs.');
  }
}

function instructionFor(type = '', modifier = '', road = '') {
  const direction = modifier.replaceAll('_', ' ');
  const action = type === 'arrive' ? 'Arrive at your destination'
    : type === 'depart' ? 'Start on'
      : type === 'roundabout' || type === 'rotary' ? 'Enter the roundabout'
        : type === 'merge' ? 'Merge'
          : type === 'fork' ? 'Keep'
            : type === 'end of road' ? 'At the end of the road, turn'
              : type === 'new name' ? 'Continue onto'
                : type === 'turn' ? `Turn ${direction || 'ahead'}`
                  : 'Continue';
  const place = road.trim();
  return place && !['Arrive at your destination', 'Turn ahead'].includes(action) ? `${action} ${place}` : action;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Routing service returned ${response.status}.`);
  return response.json() as Promise<T>;
}

class OsrmCompatibleProvider implements RoutingProvider {
  async search(query: string, near?: RouteCoordinate): Promise<Destination[]> {
    if (!geocodingBaseUrl) return [];
    assertPrivateEndpoint(geocodingBaseUrl);
    const url = new URL(`${geocodingBaseUrl}/search`);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '8');
    if (near) {
      const delta = 0.25;
      url.searchParams.set('viewbox', `${near.longitude - delta},${near.latitude + delta},${near.longitude + delta},${near.latitude - delta}`);
      url.searchParams.set('bounded', '0');
    }
    const results = await getJson<GazetteerEntry[]>(url.toString());
    return results.map((item) => ({
      id: `osm-${item.place_id}`,
      title: item.address?.amenity || item.address?.shop || item.address?.tourism || item.address?.road
        || item.display_name.split(',')[0] || 'Unnamed destination',
      subtitle: item.display_name,
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      source: 'osm' as const,
    })).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  }

  async route(origin: RouteCoordinate, destination: Destination): Promise<RoutePlan> {
    if (!routingBaseUrl) throw new Error('A private OSRM-compatible routing URL has not been configured.');
    assertPrivateEndpoint(routingBaseUrl);
    const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url = `${routingBaseUrl}/route/v1/${encodeURIComponent(profile)}/${coordinates}?overview=full&geometries=geojson&steps=true`;
    const response = await getJson<OsrmResponse>(url);
    const route = response.routes?.[0];
    if (response.code !== 'Ok' || !route) throw new Error(response.message || 'No drivable route was found for this destination.');
    const geometry = (route.geometry?.coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude }));
    if (geometry.length < 2) throw new Error('The routing service returned an incomplete route.');
    const maneuvers: RouteManeuver[] = (route.legs ?? []).flatMap((leg) => (leg.steps ?? []).flatMap((step) => {
      const location = step.maneuver?.location;
      if (!location) return [];
      const type = step.maneuver?.type ?? '';
      const modifier = step.maneuver?.modifier ?? '';
      return [{
        instruction: instructionFor(type, modifier, step.name || step.ref || ''),
        coordinate: { latitude: location[1], longitude: location[0] },
        distanceMeters: step.distance ?? 0,
        kind: type === 'depart' ? 'depart' as const : type === 'arrive' ? 'arrive' as const
          : type === 'new name' ? 'continue' as const : 'turn' as const,
      }];
    }));
    return {
      id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      destination,
      geometry,
      maneuvers,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      provider: 'OSRM-compatible',
      mode: 'live',
      createdAt: Date.now(),
    };
  }
}

export function getRoutingProvider(): RoutingProvider | null {
  return routingBaseUrl || geocodingBaseUrl ? new OsrmCompatibleProvider() : null;
}

export function isRoutingConfigured() { return Boolean(routingBaseUrl); }
export function isGeocodingConfigured() { return Boolean(geocodingBaseUrl); }
