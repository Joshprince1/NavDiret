import { useCallback, useEffect, useRef, useState } from 'react';

import { getSavedRoutePlan, saveDestination, saveRoutePlan, searchLocalDestinations } from '../offline/offlineStore';
import { localMockRoutingProvider } from './localMockProvider';
import { getRoutingProvider, isGeocodingConfigured, isRoutingConfigured } from './routingProvider';
import type { Destination, RouteCoordinate, RoutePlan, SavedPlaceCategoryDetails } from './routingTypes';

function savedCategory(destination: Destination): SavedPlaceCategoryDetails | undefined {
  if (!destination.category || !destination.categoryLabel || !destination.categoryIcon || !destination.categoryColor) return undefined;
  return {
    category: destination.category,
    categoryLabel: destination.categoryLabel,
    categoryIcon: destination.categoryIcon,
    categoryColor: destination.categoryColor,
  };
}

export function useNavigationSession(query: string, origin: RouteCoordinate | null, isOnline: boolean | null) {
  const [suggestions, setSuggestions] = useState<Destination[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const refreshLocal = useCallback(async () => {
    const local = await searchLocalDestinations(query).catch(() => []);
    const matches = local.map((item) => ({
      id: item.id, title: item.title, subtitle: item.subtitle, latitude: item.latitude, longitude: item.longitude,
      source: item.id.startsWith('cached-') ? 'cached' as const : item.id.startsWith('recent-') ? 'recent' as const : 'saved' as const,
      category: item.category, categoryLabel: item.categoryLabel, categoryIcon: item.categoryIcon, categoryColor: item.categoryColor,
    }));
    const demos = query.trim().length >= 2 && (!isGeocodingConfigured() || isOnline !== true)
      ? await localMockRoutingProvider.search(query, origin ?? undefined) : [];
    setSuggestions([...matches, ...demos].slice(0, 10));
  }, [query, origin, isOnline]);

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;
    const normalized = query.trim();
    const provider = getRoutingProvider();
    const canSearchRemotely = normalized.length >= 3 && Boolean(provider) && isGeocodingConfigured() && isOnline === true;
    void searchLocalDestinations(query).then((items) => {
      if (cancelled || generation !== generationRef.current) return;
      setSearchError(null);
      const local = items.map((item) => ({
        id: item.id, title: item.title, subtitle: item.subtitle, latitude: item.latitude, longitude: item.longitude,
        source: item.id.startsWith('cached-') ? 'cached' as const : item.id.startsWith('recent-') ? 'recent' as const : 'saved' as const,
        category: item.category, categoryLabel: item.categoryLabel, categoryIcon: item.categoryIcon, categoryColor: item.categoryColor,
      }));
      const useLocalSimulation = normalized.length >= 2 && (!isGeocodingConfigured() || isOnline !== true);
      void (useLocalSimulation ? localMockRoutingProvider.search(normalized, origin ?? undefined) : Promise.resolve([])).then((demos) => {
        if (!cancelled && generation === generationRef.current) setSuggestions([...local, ...demos].slice(0, 10));
      });
      if (!canSearchRemotely) setSearching(false);
    }).catch(() => undefined);
    if (!canSearchRemotely || !provider) {
      return () => { cancelled = true; };
    }
    const searchingTimer = setTimeout(() => setSearching(true), 0);
    const timer = setTimeout(() => {
      void provider.search(normalized, origin ?? undefined).then((remote) => {
        if (cancelled || generation !== generationRef.current) return;
        setSuggestions((local) => {
          const merged = [...local];
          for (const item of remote) {
            if (merged.some((existing) => Math.abs(existing.latitude - item.latitude) < 0.0005
              && Math.abs(existing.longitude - item.longitude) < 0.0005)) continue;
            merged.push(item);
          }
          return merged.slice(0, 10);
        });
      }).catch((error: unknown) => {
        if (!cancelled && generation === generationRef.current) {
          setSearchError(error instanceof Error ? error.message : 'Place search is temporarily unavailable.');
          if (normalized.length >= 2) {
            void localMockRoutingProvider.search(normalized, origin ?? undefined).then((demos) => {
              if (!cancelled && generation === generationRef.current) setSuggestions((local) => [...local, ...demos].slice(0, 10));
            });
          }
        }
      }).finally(() => {
        if (!cancelled && generation === generationRef.current) setSearching(false);
      });
    }, 650);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(searchingTimer); };
  }, [query, origin, isOnline]);

  const previewRoute = useCallback(async (destination: Destination, start: RouteCoordinate | null) => {
    if (!start) { setRouteError('Waiting for a GPS fix before building your route.'); return null; }
    const localId = await saveDestination(destination, savedCategory(destination)).catch(() => null);
    if (isOnline !== true || !isRoutingConfigured()) {
      const cached = localId ? await getSavedRoutePlan(localId).catch(() => null) : null;
      if (cached) {
        const restored = { ...cached, mode: cached.mode === 'simulation' ? 'simulation' as const : 'cached' as const, destination };
        setRoute(restored);
        setRouteError(null);
        return restored;
      }
      const simulated = await localMockRoutingProvider.route(start, destination);
      setRoute(simulated);
      setRouteError(isOnline === true
        ? 'Local simulation · route shape and ETA are illustrative, not road-accurate.'
        : 'Offline simulation · no saved road route exists yet. Route shape and ETA are illustrative.');
      if (localId) await saveRoutePlan(localId, simulated);
      return simulated;
    }
    const provider = getRoutingProvider();
    if (!provider) { setRouteError('Routing is not configured yet.'); return null; }
    setRouteBusy(true);
    setRouteError(null);
    try {
      const nextRoute = await provider.route(start, destination);
      setRoute(nextRoute);
      if (localId) await saveRoutePlan(localId, nextRoute);
      return nextRoute;
    } catch (error) {
      const simulated = await localMockRoutingProvider.route(start, destination);
      setRoute(simulated);
      setRouteError(`Private routing is unavailable. Local simulation is active; route shape and ETA are illustrative. ${error instanceof Error ? error.message : ''}`.trim());
      if (localId) await saveRoutePlan(localId, simulated);
      return simulated;
    } finally { setRouteBusy(false); }
  }, [isOnline]);

  const reroute = useCallback(async (destination: Destination, start: RouteCoordinate | null) => {
    if (!start) { setRouteError('Waiting for a GPS fix before rerouting.'); return null; }
    if (isOnline !== true || !isRoutingConfigured()) {
      const simulated = await localMockRoutingProvider.route(start, destination);
      setRoute(simulated);
      setRouteError('Local simulation reroute · the shape is illustrative, not road-accurate.');
      const localId = await saveDestination(destination, savedCategory(destination)).catch(() => null);
      if (localId) await saveRoutePlan(localId, simulated);
      return simulated;
    }
    const provider = getRoutingProvider();
    if (!provider) return null;
    setRerouting(true);
    setRouteError(null);
    try {
      const nextRoute = await provider.route(start, destination);
      setRoute(nextRoute);
      const localId = await saveDestination(destination, savedCategory(destination)).catch(() => null);
      if (localId) await saveRoutePlan(localId, nextRoute);
      return nextRoute;
    } catch (error) {
      const simulated = await localMockRoutingProvider.route(start, destination);
      setRoute(simulated);
      setRouteError(`Router unavailable · switched to local simulation. ${error instanceof Error ? error.message : ''}`.trim());
      const localId = await saveDestination(destination, savedCategory(destination)).catch(() => null);
      if (localId) await saveRoutePlan(localId, simulated);
      return simulated;
    } finally { setRerouting(false); }
  }, [isOnline]);

  const clearRoute = useCallback(() => { setRoute(null); setRouteError(null); }, []);
  return {
    suggestions, searching, searchError, refreshLocal,
    route, routeBusy, rerouting, routeError, previewRoute, reroute, clearRoute,
    routingConfigured: isRoutingConfigured(), geocodingConfigured: isGeocodingConfigured(),
  };
}
