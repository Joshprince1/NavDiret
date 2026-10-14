import { distanceBetweenMeters } from '../location/placeResolver';
import type { RouteCoordinate, RouteManeuver, RoutePlan } from './routingTypes';

export function measureRouteMeters(coordinates: RouteCoordinate[]) {
  return coordinates.slice(1).reduce((total, point, index) => total + distanceBetweenMeters(coordinates[index], point), 0);
}

export function distanceToRouteMeters(point: RouteCoordinate, route: RouteCoordinate[]) {
  if (route.length < 2) return Number.POSITIVE_INFINITY;
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos((point.latitude * Math.PI) / 180);
  const local = (coordinate: RouteCoordinate) => ({
    x: (coordinate.longitude - point.longitude) * longitudeScale,
    y: (coordinate.latitude - point.latitude) * latitudeScale,
  });
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < route.length; index += 1) {
    const start = local(route[index - 1]);
    const end = local(route[index]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared));
    nearest = Math.min(nearest, Math.hypot(start.x + ratio * dx, start.y + ratio * dy));
  }
  return nearest;
}

export function remainingRouteMeters(position: RouteCoordinate, route: RouteCoordinate[]) {
  if (route.length < 2) return Number.POSITIVE_INFINITY;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  route.forEach((point, index) => {
    const distance = distanceBetweenMeters(position, point);
    if (distance < closestDistance) { closestDistance = distance; closestIndex = index; }
  });
  return distanceBetweenMeters(position, route[closestIndex])
    + route.slice(closestIndex + 1).reduce((total, point, index) => total + distanceBetweenMeters(route[closestIndex + index], point), 0);
}

function nearestRouteVertex(position: RouteCoordinate, route: RouteCoordinate[]) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  route.forEach((point, index) => {
    const distance = distanceBetweenMeters(position, point);
    if (distance < closestDistance) { closestDistance = distance; closestIndex = index; }
  });
  return { index: closestIndex, distance: closestDistance };
}

export function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.max(0, Math.round(meters / 10) * 10)} m`;
}

export function getGuidanceSnapshot(position: RouteCoordinate, route: RoutePlan, offRouteThresholdMeters = 50) {
  const distanceFromRoute = distanceToRouteMeters(position, route.geometry);
  const positionAlongRoute = nearestRouteVertex(position, route.geometry);
  const maneuversAhead = route.maneuvers.filter((maneuver) => maneuver.kind !== 'depart').map((maneuver) => ({
    maneuver,
    routeIndex: nearestRouteVertex(maneuver.coordinate, route.geometry).index,
  })).filter(({ maneuver, routeIndex }) => routeIndex > positionAlongRoute.index
    || (routeIndex === positionAlongRoute.index && distanceBetweenMeters(position, maneuver.coordinate) > 18));
  const next = maneuversAhead[0];
  const nextManeuver: RouteManeuver | null = next?.maneuver ?? null;
  const remainingMeters = remainingRouteMeters(position, route.geometry);
  const remainingRatio = route.distanceMeters > 0 ? Math.min(1, remainingMeters / route.distanceMeters) : 0;
  const distanceToNextManeuver = next ? positionAlongRoute.distance
    + route.geometry.slice(positionAlongRoute.index + 1, next.routeIndex + 1).reduce((total, point, index) => {
      return total + distanceBetweenMeters(route.geometry[positionAlongRoute.index + index], point);
    }, 0)
    + distanceBetweenMeters(route.geometry[next.routeIndex], next.maneuver.coordinate) : null;
  return {
    distanceFromRoute,
    isOffRoute: distanceFromRoute > offRouteThresholdMeters,
    remainingMeters,
    remainingSeconds: Math.round(route.durationSeconds * remainingRatio),
    nextManeuver,
    distanceToNextManeuver,
  };
}
