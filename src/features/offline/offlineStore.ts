import * as SQLite from 'expo-sqlite';
import type * as Location from 'expo-location';
import type { RoutePlan, SavedPlaceCategory, SavedPlaceCategoryDetails } from '../routing/routingTypes';

import { distanceBetweenMeters, type ResolvedPlace } from '../location/placeResolver';

export type RecentRoute = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  sampleCount: number;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  startPlace: string | null;
  endPlace: string | null;
};

export type CachedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
};

type CachedPlaceRow = {
  latitude: number;
  longitude: number;
  title: string;
  subtitle: string;
  address_json: string;
  cached_at: number;
};

const DATABASE_NAME = 'navdiret-offline.db';
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS cached_places (
          cache_key TEXT PRIMARY KEY NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          title TEXT NOT NULL,
          subtitle TEXT NOT NULL,
          address_json TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS cached_places_coords ON cached_places(latitude, longitude);
        CREATE TABLE IF NOT EXISTS location_fixes (
          id INTEGER PRIMARY KEY NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy REAL,
          place_title TEXT,
          place_subtitle TEXT,
          recorded_at INTEGER NOT NULL,
          source TEXT NOT NULL,
          route_id TEXT
        );
        CREATE INDEX IF NOT EXISTS location_fixes_recorded ON location_fixes(recorded_at DESC);
        CREATE TABLE IF NOT EXISTS route_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS saved_destinations (
          id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL,
          latitude REAL NOT NULL, longitude REAL NOT NULL, saved_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'favorite', category_label TEXT NOT NULL DEFAULT 'Favorites',
          category_icon TEXT NOT NULL DEFAULT '★', category_color TEXT NOT NULL DEFAULT '#72E5D1'
        );
        CREATE TABLE IF NOT EXISTS saved_routes (
          id TEXT PRIMARY KEY NOT NULL, destination_id TEXT NOT NULL, route_json TEXT NOT NULL, saved_at INTEGER NOT NULL,
          FOREIGN KEY(destination_id) REFERENCES saved_destinations(id) ON DELETE CASCADE
        );
        DROP TABLE IF EXISTS sync_outbox;
      `);
      const destinationColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(saved_destinations)');
      const existingColumns = new Set(destinationColumns.map((column) => column.name));
      if (!existingColumns.has('category')) await database.execAsync("ALTER TABLE saved_destinations ADD COLUMN category TEXT NOT NULL DEFAULT 'favorite'");
      if (!existingColumns.has('category_label')) await database.execAsync("ALTER TABLE saved_destinations ADD COLUMN category_label TEXT NOT NULL DEFAULT 'Favorites'");
      if (!existingColumns.has('category_icon')) await database.execAsync("ALTER TABLE saved_destinations ADD COLUMN category_icon TEXT NOT NULL DEFAULT '★'");
      if (!existingColumns.has('category_color')) await database.execAsync("ALTER TABLE saved_destinations ADD COLUMN category_color TEXT NOT NULL DEFAULT '#72E5D1'");
      await database.execAsync('CREATE INDEX IF NOT EXISTS saved_destinations_category ON saved_destinations(category, last_used_at DESC)');
      return database;
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function makeCacheKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
}

export async function saveCachedPlace(place: ResolvedPlace, latitude: number, longitude: number) {
  const database = await getDatabase();
  const timestamp = Date.now();
  await database.runAsync(
    `INSERT INTO cached_places (cache_key, latitude, longitude, title, subtitle, address_json, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude,
       title=excluded.title, subtitle=excluded.subtitle, address_json=excluded.address_json, cached_at=excluded.cached_at`,
    makeCacheKey(latitude, longitude), latitude, longitude, place.title, place.subtitle,
    JSON.stringify(place.address), timestamp,
  );
}

export async function findCachedPlace(latitude: number, longitude: number, radiusMeters = 350): Promise<ResolvedPlace | null> {
  const database = await getDatabase();
  const latitudeDelta = radiusMeters / 111_000;
  const longitudeDelta = radiusMeters / Math.max(11_000, 111_000 * Math.cos((latitude * Math.PI) / 180));
  const rows = await database.getAllAsync<CachedPlaceRow>(
    `SELECT latitude, longitude, title, subtitle, address_json, cached_at FROM cached_places
     WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY cached_at DESC LIMIT 40`,
    latitude - latitudeDelta, latitude + latitudeDelta, longitude - longitudeDelta, longitude + longitudeDelta,
  );
  const nearest = rows
    .map((row) => ({ row, distance: distanceBetweenMeters({ latitude, longitude }, row) }))
    .filter(({ distance }) => distance <= radiusMeters)
    .sort((first, second) => first.distance - second.distance)[0]?.row;
  if (!nearest) return null;
  try {
    return { title: nearest.title, subtitle: nearest.subtitle, address: JSON.parse(nearest.address_json) as Location.LocationGeocodedAddress };
  } catch {
    return null;
  }
}

export async function saveLocationFix(location: Location.LocationObject, source: 'foreground' | 'background') {
  const database = await getDatabase();
  const { latitude, longitude, accuracy } = location.coords;
  const timestamp = location.timestamp;
  const currentRoute = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'active_route_id'",
  );
  const routeId = currentRoute?.value ?? null;
  const cachedPlace = await findCachedPlace(latitude, longitude).catch(() => null);
  if (!routeId) {
    await database.runAsync(
      "INSERT INTO app_settings (key, value) VALUES ('latest_location_fix', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify({ latitude, longitude, accuracy, timestamp }),
    );
    return;
  }
  const previous = routeId
    ? await database.getFirstAsync<{ latitude: number; longitude: number; recorded_at: number }>(
      'SELECT latitude, longitude, recorded_at FROM location_fixes WHERE route_id = ? ORDER BY recorded_at DESC LIMIT 1', routeId,
    )
    : null;
  if (previous && timestamp - previous.recorded_at < 10_000
    && distanceBetweenMeters(previous, { latitude, longitude }) < 12) return;

  await database.runAsync(
    'INSERT INTO location_fixes (latitude, longitude, accuracy, place_title, place_subtitle, recorded_at, source, route_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    latitude, longitude, accuracy, cachedPlace?.title ?? null, cachedPlace?.subtitle ?? null, timestamp, source, routeId,
  );
  await database.runAsync(
    "INSERT INTO app_settings (key, value) VALUES ('latest_location_fix', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify({ latitude, longitude, accuracy, timestamp }),
  );
}

export async function getLatestCachedLocation(): Promise<CachedLocation | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'latest_location_fix'");
  if (!row) {
    const lastRouteFix = await database.getFirstAsync<CachedLocation>(
      'SELECT latitude, longitude, accuracy, recorded_at AS timestamp FROM location_fixes ORDER BY recorded_at DESC LIMIT 1',
    );
    return lastRouteFix ?? null;
  }
  try { return JSON.parse(row.value) as CachedLocation; } catch { return null; }
}

export async function startRouteSession() {
  const database = await getDatabase();
  const previous = await database.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'active_route_id'");
  if (previous) return previous.value;
  const id = `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  await database.runAsync('INSERT INTO route_sessions (id, started_at, ended_at) VALUES (?, ?, NULL)', id, startedAt);
  await database.runAsync(
    "INSERT INTO app_settings (key, value) VALUES ('active_route_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", id,
  );
  return id;
}

export async function finishRouteSession() {
  const database = await getDatabase();
  const active = await database.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'active_route_id'");
  if (!active) return;
  const endedAt = Date.now();
  await database.runAsync('UPDATE route_sessions SET ended_at = ? WHERE id = ?', endedAt, active.value);
  await database.runAsync("DELETE FROM app_settings WHERE key = 'active_route_id'");
}

export async function getRecentRoutes(limit = 5): Promise<RecentRoute[]> {
  const database = await getDatabase();
  return database.getAllAsync<RecentRoute>(
    `SELECT routes.id, routes.started_at AS startedAt, routes.ended_at AS endedAt,
      COUNT(fixes.id) AS sampleCount,
      (SELECT latitude FROM location_fixes WHERE route_id = routes.id ORDER BY recorded_at ASC LIMIT 1) AS startLatitude,
      (SELECT longitude FROM location_fixes WHERE route_id = routes.id ORDER BY recorded_at ASC LIMIT 1) AS startLongitude,
      (SELECT latitude FROM location_fixes WHERE route_id = routes.id ORDER BY recorded_at DESC LIMIT 1) AS endLatitude,
      (SELECT longitude FROM location_fixes WHERE route_id = routes.id ORDER BY recorded_at DESC LIMIT 1) AS endLongitude,
      (SELECT place_title FROM location_fixes WHERE route_id = routes.id ORDER BY recorded_at ASC LIMIT 1) AS startPlace,
      (SELECT place_title FROM location_fixes WHERE route_id = routes.id ORDER BY recorded_at DESC LIMIT 1) AS endPlace
     FROM route_sessions AS routes LEFT JOIN location_fixes AS fixes ON fixes.route_id = routes.id
     GROUP BY routes.id ORDER BY routes.started_at DESC LIMIT ?`, limit,
  );
}

export async function getRouteCoordinates(routeId: string) {
  const database = await getDatabase();
  return database.getAllAsync<{ latitude: number; longitude: number }>(
    'SELECT latitude, longitude FROM location_fixes WHERE route_id = ? ORDER BY recorded_at ASC', routeId,
  );
}

export type SavedDestination = {
  id: string; title: string; subtitle: string; latitude: number; longitude: number; savedAt: number; lastUsedAt: number;
  category: SavedPlaceCategory; categoryLabel: string; categoryIcon: string; categoryColor: string;
};

export async function saveDestination(
  destination: Pick<SavedDestination, 'title' | 'subtitle' | 'latitude' | 'longitude'>,
  category?: SavedPlaceCategoryDetails,
) {
  const database = await getDatabase();
  const existing = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM saved_destinations WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT 1',
    destination.latitude - 0.0005, destination.latitude + 0.0005, destination.longitude - 0.0005, destination.longitude + 0.0005,
  );
  const id = existing?.id ?? `destination-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  if (category) {
    await database.runAsync(
      `INSERT INTO saved_destinations (id, title, subtitle, latitude, longitude, saved_at, last_used_at, category, category_label, category_icon, category_color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle,
       latitude=excluded.latitude, longitude=excluded.longitude, last_used_at=excluded.last_used_at, category=excluded.category,
       category_label=excluded.category_label, category_icon=excluded.category_icon, category_color=excluded.category_color`,
      id, destination.title, destination.subtitle, destination.latitude, destination.longitude, now, now,
      category.category, category.categoryLabel, category.categoryIcon, category.categoryColor,
    );
  } else {
    await database.runAsync(
      `INSERT INTO saved_destinations (id, title, subtitle, latitude, longitude, saved_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle,
       latitude=excluded.latitude, longitude=excluded.longitude, last_used_at=excluded.last_used_at`,
      id, destination.title, destination.subtitle, destination.latitude, destination.longitude, now, now,
    );
  }
  return id;
}

export async function getSavedDestinations(limit = 12): Promise<SavedDestination[]> {
  const database = await getDatabase();
  return database.getAllAsync<SavedDestination>(
    `SELECT id, title, subtitle, latitude, longitude, saved_at AS savedAt, last_used_at AS lastUsedAt,
      category, category_label AS categoryLabel, category_icon AS categoryIcon, category_color AS categoryColor
     FROM saved_destinations ORDER BY last_used_at DESC LIMIT ?`, limit,
  );
}

export async function searchLocalDestinations(query: string, limit = 12): Promise<SavedDestination[]> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return getSavedDestinations(limit);
  const database = await getDatabase();
  const pattern = `%${normalized}%`;
  const [saved, cached, recentlyResolved] = await Promise.all([
    database.getAllAsync<SavedDestination>(
      `SELECT id, title, subtitle, latitude, longitude, saved_at AS savedAt, last_used_at AS lastUsedAt,
        category, category_label AS categoryLabel, category_icon AS categoryIcon, category_color AS categoryColor
       FROM saved_destinations WHERE lower(title) LIKE ? OR lower(subtitle) LIKE ?
       ORDER BY last_used_at DESC LIMIT ?`, pattern, pattern, limit,
    ),
    database.getAllAsync<{ latitude: number; longitude: number; title: string; subtitle: string; cached_at: number }>(
      `SELECT latitude, longitude, title, subtitle, cached_at FROM cached_places
       WHERE lower(title) LIKE ? OR lower(subtitle) LIKE ? ORDER BY cached_at DESC LIMIT ?`, pattern, pattern, limit,
    ),
    database.getAllAsync<{ latitude: number; longitude: number; place_title: string; place_subtitle: string; recorded_at: number }>(
      `SELECT latitude, longitude, place_title, place_subtitle, MAX(recorded_at) AS recorded_at
       FROM location_fixes WHERE place_title IS NOT NULL AND (lower(place_title) LIKE ? OR lower(place_subtitle) LIKE ?)
       GROUP BY round(latitude, 3), round(longitude, 3) ORDER BY recorded_at DESC LIMIT ?`, pattern, pattern, limit,
    ),
  ]);
  const matches: SavedDestination[] = [...saved];
  for (const place of cached) {
    if (matches.some((item) => distanceBetweenMeters(item, place) < 75)) continue;
    matches.push({
      id: `cached-${place.latitude.toFixed(4)}-${place.longitude.toFixed(4)}`,
      title: place.title,
      subtitle: place.subtitle,
      latitude: place.latitude,
      longitude: place.longitude,
      savedAt: place.cached_at,
      lastUsedAt: place.cached_at,
      category: 'favorite', categoryLabel: 'Saved place', categoryIcon: '⌖', categoryColor: '#72E5D1',
    });
  }
  for (const place of recentlyResolved) {
    if (matches.some((item) => distanceBetweenMeters(item, place) < 75)) continue;
    matches.push({
      id: `recent-${place.latitude.toFixed(4)}-${place.longitude.toFixed(4)}`,
      title: place.place_title,
      subtitle: place.place_subtitle,
      latitude: place.latitude,
      longitude: place.longitude,
      savedAt: place.recorded_at,
      lastUsedAt: place.recorded_at,
      category: 'favorite', categoryLabel: 'Recent place', categoryIcon: '⌖', categoryColor: '#72E5D1',
    });
  }
  return matches.slice(0, limit);
}

export async function saveRoutePlan(destinationId: string, route: RoutePlan) {
  const database = await getDatabase();
  await database.runAsync(
    'INSERT INTO saved_routes (id, destination_id, route_json, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET route_json=excluded.route_json, saved_at=excluded.saved_at',
    `plan-${destinationId}`, destinationId, JSON.stringify(route), Date.now(),
  );
}

export async function getSavedRoutePlan(destinationId: string): Promise<RoutePlan | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ route_json: string }>(
    'SELECT route_json FROM saved_routes WHERE destination_id = ? ORDER BY saved_at DESC LIMIT 1', destinationId,
  );
  if (!row) return null;
  try { return JSON.parse(row.route_json) as RoutePlan; } catch { return null; }
}

export async function getBackgroundGeocodeState() {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'background_geocode_state'");
  if (!row) return null;
  try { return JSON.parse(row.value) as { latitude: number; longitude: number; at: number }; } catch { return null; }
}

export async function setBackgroundGeocodeState(state: { latitude: number; longitude: number; at: number }) {
  const database = await getDatabase();
  await database.runAsync(
    "INSERT INTO app_settings (key, value) VALUES ('background_geocode_state', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify(state),
  );
}

export async function getLocalSetting<T>(key: string, fallback: T): Promise<T> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

export async function setLocalSetting<T>(key: string, value: T) {
  const database = await getDatabase();
  await database.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key, JSON.stringify(value),
  );
}
