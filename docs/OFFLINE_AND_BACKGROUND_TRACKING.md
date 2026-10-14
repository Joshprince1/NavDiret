# Offline data, routing, and background trip tracking

## Local-first storage

NavDiret stores reverse-geocoded place names, saved destinations, recent place names, saved road routes, the latest location fix, trip sessions, and breadcrumbs in on-device SQLite (`navdiret-offline.db`). There is no automatic sync endpoint, upload queue, or background data drain. Existing outbox tables from earlier builds are dropped when the database opens; the canonical place and route data remain in their local tables. The connectivity badge reports network state only.

Native Apple Maps and Google Maps basemaps are supplied by their respective map providers. NavDiret does not download offline map regions or guarantee street tiles remain available without a connection. Saved destination and route data remain available independently.

## Routing and search adapters

The routing layer uses an adapter interface and an OSRM-compatible implementation. Configure these build-time environment values to activate it:

- `NAVDIRET_ROUTING_URL`: private OSRM-compatible server root (the app requests `/route/v1/{profile}/{lon,lat;lon,lat}` with full GeoJSON geometry and maneuver steps).
- `NAVDIRET_GEOCODING_URL`: private Nominatim-compatible server root (the app requests `/search` in `jsonv2` format).
- `NAVDIRET_ROUTING_PROFILE`: optional profile, default `driving`.

No URL is configured in source. Until configured, search uses only SQLite and road routing stays disabled. Search input is debounced, and remote queries are made only while online. Building a route sends the current origin and selected destination coordinates to the configured private router. Search results and route plans are then cached locally; when offline, a previously saved route can still be opened and followed. Automatic off-route recalculation also requires network access to the configured router.

For development and demos without configured endpoints, the app adds clearly labeled synthetic destinations near the current fix and creates a local bent waypoint path with illustrative distance, ETA, and maneuver labels. It makes no network requests, does not change the device GPS position or trip breadcrumbs, and is marked `SIMULATION · LOCAL ONLY` / `NOT ROAD DATA` in the UI. Simulation routes are saved locally for repeatable previews. They are not suitable for real-world navigation. If a configured private service fails, the app falls back to this same local practice mode and displays a warning.

Do not point this client autocomplete at the public `nominatim.openstreetmap.org` service. Its policy explicitly prohibits autocomplete and limits usage; use a privately operated Nominatim-compatible service. Nominatim search data is attributed to OpenStreetMap contributors in the search view. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/), [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/), and [OSRM Route API](https://project-osrm.org/docs/v5.24.0/api/).

## Background tracking and geocoding

Background tracking is opt-in from the expanded place sheet. The app requests foreground permission first and background/Always permission only after the user starts a trip. Android displays its foreground-service notification; iOS shows its background location indicator. Route points and nearby cached place labels are stored locally in SQLite even when the UI is not mounted.

When tracking is active, background reverse-geocoding is considered only if the device is online, no nearby cached place exists, and both at least 120 seconds and 200 meters have elapsed since the prior attempt. The attempt time and coordinates are persisted before calling the platform geocoder, so task restarts and failed lookups do not bypass the throttle. Results are cached locally; no route or location payload is sent to a NavDiret cloud server.

Background location requires a native development or production build; Expo Go does not support it. Rebuild after changing location permissions in `app.json`. Operating systems can pause location updates, and force-quitting/terminating the app stops tracking; Android vendors can also apply battery restrictions.

The tracking service samples at a balanced 10-second / 15-meter profile normally. Low-power mode or an unplugged battery at or below 20% switches to 30 seconds / 45 meters. While battery saver is active or an unplugged battery is at or below 15%, optional background reverse-geocoding is skipped while local breadcrumb recording continues. When GPS freshness is lost during guidance, distance and reroute decisions pause until a fresh fix arrives. Haptic turn cues are limited to configured live routes and trigger once as a maneuver approaches; practice simulations do not vibrate for synthetic turns.

## Guidance, favorites, appearance, and speed

Voice guidance uses the device speech engine through `expo-speech`; it does not call a speech or navigation cloud service. For each maneuver, it announces once when first observed within 220 meters and once within 40 meters, then announces arrival once. Disabling voice stops current speech. The preference is stored in SQLite. Practice routes are explicitly introduced as practice directions. On iOS, the device silent switch can prevent audible speech.

Saved destinations include a local category, label, icon, and color. Home, Work, and Favorites are available as presets, and custom labels/icons/colors can be saved from the destination preview. Existing databases add these columns with a safe migration. Saved places appear in the quick-access shelf and remain available offline; choosing one uses a cached route when available or the app's clearly marked local practice route.

Appearance and speed preferences are persisted in the same local SQLite settings table. Auto appearance currently follows local device time, using night styling from 7 p.m. through 5:59 a.m.; Light and Dark can be selected manually. The active guidance HUD shows GPS speed in km/h or mph, and suppresses the value when the location fix is stale. Its amber alert threshold is a user-configured personal reminder (default 80 km/h), not a detected or official posted road speed limit.
