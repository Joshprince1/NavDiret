export type RouteCoordinate = { latitude: number; longitude: number };
export type SavedPlaceCategory = 'home' | 'work' | 'favorite' | 'custom';
export type SavedPlaceCategoryDetails = {
  category: SavedPlaceCategory;
  categoryLabel: string;
  categoryIcon: string;
  categoryColor: string;
};
export type Destination = RouteCoordinate & {
  id: string;
  title: string;
  subtitle: string;
  source?: 'saved' | 'cached' | 'recent' | 'osm' | 'simulation';
} & Partial<SavedPlaceCategoryDetails>;
export type RouteManeuver = {
  instruction: string;
  coordinate: RouteCoordinate;
  distanceMeters: number;
  kind: 'depart' | 'turn' | 'arrive' | 'continue';
};
export type RoutePlan = {
  id: string;
  destination: Destination;
  geometry: RouteCoordinate[];
  maneuvers: RouteManeuver[];
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  mode: 'live' | 'cached' | 'simulation';
  createdAt: number;
};

export interface RoutingProvider {
  search(query: string, near?: RouteCoordinate): Promise<Destination[]>;
  route(origin: RouteCoordinate, destination: Destination): Promise<RoutePlan>;
}
