import { distanceBetweenMeters } from '../location/placeResolver';
import type { Destination, RouteCoordinate, RoutePlan, RoutingProvider } from './routingTypes';

const METERS_PER_LATITUDE_DEGREE = 111_320;

export class LocalMockRoutingProvider implements RoutingProvider {
  search(query: string, near?: RouteCoordinate) {
    if (!near || query.trim().length < 2) return Promise.resolve([]);
    const destinations: Destination[] = [
      { id: 'demo-north', title: 'Demo destination · North', subtitle: 'Synthetic waypoint · local simulation', latitude: near.latitude + 0.008, longitude: near.longitude, source: 'simulation' },
      { id: 'demo-east', title: 'Demo destination · East', subtitle: 'Synthetic waypoint · local simulation', latitude: near.latitude, longitude: near.longitude + 0.009 / Math.max(0.2, Math.cos(near.latitude * Math.PI / 180)), source: 'simulation' },
      { id: 'demo-southwest', title: 'Demo destination · Southwest', subtitle: 'Synthetic waypoint · local simulation', latitude: near.latitude - 0.006, longitude: near.longitude - 0.007 / Math.max(0.2, Math.cos(near.latitude * Math.PI / 180)), source: 'simulation' },
    ];
    return Promise.resolve(destinations);
  }

  route(origin: RouteCoordinate, destination: Destination): Promise<RoutePlan> {
    const middleLatitude = (origin.latitude + destination.latitude) / 2;
    const middleLongitude = (origin.longitude + destination.longitude) / 2;
    const latitudeScale = METERS_PER_LATITUDE_DEGREE;
    const longitudeScale = latitudeScale * Math.max(0.2, Math.cos(middleLatitude * Math.PI / 180));
    const east = (destination.longitude - origin.longitude) * longitudeScale;
    const north = (destination.latitude - origin.latitude) * latitudeScale;
    const directMeters = Math.hypot(east, north);
    const offsetMeters = Math.min(140, Math.max(32, directMeters * 0.13));
    const offsetEast = directMeters > 0 ? (-north / directMeters) * offsetMeters : offsetMeters;
    const offsetNorth = directMeters > 0 ? (east / directMeters) * offsetMeters : 0;
    const waypoint = {
      latitude: middleLatitude + offsetNorth / latitudeScale,
      longitude: middleLongitude + offsetEast / longitudeScale,
    };
    const geometry = [origin, waypoint, destination];
    const distanceMeters = geometry.slice(1).reduce((sum, point, index) => sum + distanceBetweenMeters(geometry[index], point), 0);
    const turnDirection = (destination.latitude - origin.latitude) * (waypoint.longitude - origin.longitude)
      - (destination.longitude - origin.longitude) * (waypoint.latitude - origin.latitude) > 0 ? 'left' : 'right';
    return Promise.resolve({
      id: `simulation-${Date.now()}`,
      destination,
      geometry,
      maneuvers: [
        { instruction: 'Begin your local practice route', coordinate: origin, distanceMeters: directMeters / 2, kind: 'depart' },
        { instruction: `Turn ${turnDirection} onto the simulated path`, coordinate: waypoint, distanceMeters: distanceMeters / 2, kind: 'turn' },
        { instruction: 'Arrive at your simulated destination', coordinate: destination, distanceMeters: 0, kind: 'arrive' },
      ],
      distanceMeters,
      durationSeconds: Math.max(60, distanceMeters / 7.5),
      provider: 'Local mock provider',
      mode: 'simulation',
      createdAt: Date.now(),
    });
  }
}

export const localMockRoutingProvider = new LocalMockRoutingProvider();
