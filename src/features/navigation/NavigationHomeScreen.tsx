import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { addCustomHeader, removeCustomHeader, Camera, CircleLayer, FillLayer, LineLayer, MapView, RasterLayer, RasterSource, ShapeSource, type CameraRef } from '@maplibre/maplibre-react-native';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useLocationSession } from '../location/useLocationSession';
import { useBatteryAwareTracking } from '../location/useBatteryAwareTracking';
import { finishRouteSession, getRecentRoutes, getRouteCoordinates, getSavedDestinations, saveDestination, startRouteSession, type RecentRoute, type SavedDestination } from '../offline/offlineStore';
import { useConnectivity } from '../offline/useConnectivity';
import { distanceBetweenMeters } from '../location/placeResolver';
import type { LocationTelemetry } from '../location/locationTelemetry';
import { formatDistance, getGuidanceSnapshot } from '../routing/routeGeometry';
import { useNavigationSession } from '../routing/useNavigationSession';
import type { Destination, SavedPlaceCategoryDetails } from '../routing/routingTypes';
import { RecoveryBoundary } from '../../components/RecoveryBoundary';
import { useNavPreferences, type SpeedUnit, type ThemePreference } from './useNavPreferences';
import { useVoiceGuidance } from './useVoiceGuidance';

const COLORS = {
  ink: '#09131B',
  panel: '#101E28',
  panelRaised: '#192A35',
  cyan: '#72E5D1',
  white: '#F5F8F7',
  muted: '#A5B4B9',
  line: 'rgba(237, 250, 249, 0.12)',
};

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const mapTilesUrl = (Constants.expoConfig?.extra?.mapTilesUrl as string | undefined) || OSM_TILE_URL;
const PRESET_CATEGORIES: SavedPlaceCategoryDetails[] = [
  { category: 'favorite', categoryLabel: 'Favorites', categoryIcon: '★', categoryColor: '#72E5D1' },
  { category: 'home', categoryLabel: 'Home', categoryIcon: '⌂', categoryColor: '#7BC9FF' },
  { category: 'work', categoryLabel: 'Work', categoryIcon: '▦', categoryColor: '#C1A2FF' },
];
const CATEGORY_COLORS = ['#72E5D1', '#7BC9FF', '#C1A2FF', '#FFC27D', '#F49AA8'];

function NavigationHomeScreenView() {
  const session = useLocationSession();
  const offline = useConnectivity();
  const cameraRef = useRef<CameraRef>(null);
  const [northUp, setNorthUp] = useState(true);
  const [bearing, setBearing] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [selectedDestination, setSelectedDestination] = useState<Destination | null>(null);
  const [activeGuidance, setActiveGuidance] = useState(false);
  const [demoPosition, setDemoPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedDestination[]>([]);
  const [customCategoryLabel, setCustomCategoryLabel] = useState('Personal');
  const [customCategoryIcon, setCustomCategoryIcon] = useState('✦');
  const [customCategoryColor, setCustomCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [customCategoryEditing, setCustomCategoryEditing] = useState(false);
  const [quickStartId, setQuickStartId] = useState<string | null>(null);
  const [recentRouteCoordinates, setRecentRouteCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const [sheetProgress] = useState(() => new Animated.Value(0));
  const [guidanceProgress] = useState(() => new Animated.Value(0));
  const [speedPulse] = useState(() => new Animated.Value(1));
  const previousOnlineRef = useRef<boolean | null>(null);
  const rerouteAttemptRef = useRef(false);
  const hapticManeuverRef = useRef<string | null>(null);
  const refreshLocation = session.refresh;
  const retryPlaceLookup = session.retryPlaceLookup;
  const position = session.position;
  const coordinates = useMemo(() => position
    ? { latitude: position.coords.latitude, longitude: position.coords.longitude }
    : null, [position]);
  const navigation = useNavigationSession(destinationQuery, coordinates, offline.isOnline);
  const battery = useBatteryAwareTracking(session.backgroundStatus === 'running');
  const preferences = useNavPreferences();
  const guidancePosition = activeGuidance && navigation.route?.mode === 'simulation' && demoPosition ? demoPosition : coordinates;
  const guidance = useMemo(() => navigation.route && guidancePosition
    ? getGuidanceSnapshot(guidancePosition, navigation.route) : null, [guidancePosition, navigation.route]);
  const guidanceFresh = navigation.route?.mode === 'simulation' ? Boolean(demoPosition) : session.isFresh;
  useVoiceGuidance(activeGuidance, guidanceFresh, preferences.voiceEnabled, navigation.route, guidance, preferences.ready);
  const ageLabel = session.ageMs === null
    ? 'Waiting for GPS'
    : session.ageMs < 5_000
      ? 'Updated just now'
      : `Updated ${Math.max(1, Math.round(session.ageMs / 1_000))} sec ago`;
  const accuracyLabel = session.accuracy === null ? '—' : `±${Math.max(1, Math.round(session.accuracy))} m`;
  const active = session.status === 'ready' && session.isFresh;
  const speedKmh = session.isFresh && position?.coords.speed !== null && position?.coords.speed !== undefined && position.coords.speed >= 0
    ? position.coords.speed * 3.6 : null;
  const speedDisplay = speedKmh === null ? '—' : Math.round(preferences.speedUnit === 'kmh' ? speedKmh : speedKmh / 1.609344).toString();
  const speedLimitDisplay = preferences.speedUnit === 'kmh' ? preferences.speedLimitKmh : Math.round(preferences.speedLimitKmh / 1.609344);
  const overSpeedLimit = speedKmh !== null && speedKmh > preferences.speedLimitKmh;

  useEffect(() => {
    if (!overSpeedLimit) { speedPulse.stopAnimation(); speedPulse.setValue(1); return; }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(speedPulse, { toValue: 1.035, duration: 700, useNativeDriver: true }),
      Animated.timing(speedPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [overSpeedLimit, speedPulse]);

  const refreshSavedPlaces = useCallback(async () => {
    setSavedPlaces(await getSavedDestinations(50).catch(() => []));
  }, []);

  const refreshLocalDestinations = navigation.refreshLocal;
  const assignSelectedCategory = useCallback(async (category: SavedPlaceCategoryDetails) => {
    if (!selectedDestination) return;
    const id = await saveDestination(selectedDestination, category);
    const saved: Destination = { ...selectedDestination, ...category, id, source: 'saved' };
    setSelectedDestination(saved);
    await Promise.all([refreshSavedPlaces(), refreshLocalDestinations()]);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [refreshLocalDestinations, refreshSavedPlaces, selectedDestination]);

  const startSavedPlace = useCallback(async (place: SavedDestination) => {
    if (!coordinates) return;
    const destination: Destination = { ...place, source: 'saved' };
    setSelectedDestination(destination);
    setQuickStartId(place.id);
    try {
      const plan = await navigation.previewRoute(destination, coordinates);
      if (!plan) return;
      await startRouteSession();
      setDemoPosition(plan.mode === 'simulation' ? coordinates : null);
      setActiveGuidance(true);
      setSearchVisible(false);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    } finally { setQuickStartId(null); }
  }, [coordinates, navigation.previewRoute]);

  useEffect(() => {
    let cancelled = false;
    void getRecentRoutes(3).then((routes) => { if (!cancelled) setRecentRoutes(routes); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [session.backgroundStatus]);

  const openSearch = useCallback(() => {
    void refreshSavedPlaces();
    setSearchVisible(true);
  }, [refreshSavedPlaces]);

  useEffect(() => {
    let cancelled = false;
    const routeId = recentRoutes[0]?.id;
    if (!routeId) return () => { cancelled = true; };
    void getRouteCoordinates(routeId).then((points) => {
      if (!cancelled) setRecentRouteCoordinates(points);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [recentRoutes]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void getRecentRoutes(3).then((routes) => setRecentRoutes(routes)).catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (offline.isOnline && previousOnlineRef.current === false) retryPlaceLookup();
    previousOnlineRef.current = offline.isOnline;
  }, [offline.isOnline, retryPlaceLookup]);

  const reroute = navigation.reroute;
  const routeDestination = navigation.route?.destination;
  const isOffRoute = guidance?.isOffRoute;
  const routingConfigured = navigation.routingConfigured;

  useEffect(() => {
    if (!activeGuidance || !routeDestination || navigation.route?.mode !== 'live' || !session.isFresh || isOffRoute === undefined) { rerouteAttemptRef.current = false; return; }
    if (!isOffRoute) { rerouteAttemptRef.current = false; return; }
    if (offline.isOnline !== true || !routingConfigured || rerouteAttemptRef.current) return;
    rerouteAttemptRef.current = true;
    void reroute(routeDestination, coordinates);
  }, [activeGuidance, routeDestination, navigation.route?.mode, isOffRoute, offline.isOnline, routingConfigured, reroute, coordinates, session.isFresh]);

  useEffect(() => {
    const maneuver = guidance?.nextManeuver;
    const distance = guidance?.distanceToNextManeuver;
    const routeId = navigation.route?.id;
    if (!activeGuidance || navigation.route?.mode === 'simulation' || !session.isFresh || !maneuver || distance === null || distance === undefined || distance > 75 || distance <= 18 || !routeId) return;
    const key = `${routeId}:${maneuver.coordinate.latitude.toFixed(5)}:${maneuver.coordinate.longitude.toFixed(5)}`;
    if (hapticManeuverRef.current === key) return;
    hapticManeuverRef.current = key;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined);
  }, [activeGuidance, session.isFresh, guidance?.nextManeuver, guidance?.distanceToNextManeuver, navigation.route?.id, navigation.route?.mode]);

  useEffect(() => {
    Animated.spring(sheetProgress, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 180,
      mass: 0.85,
    }).start();
  }, [expanded, sheetProgress]);

  useEffect(() => {
    Animated.spring(guidanceProgress, {
      toValue: activeGuidance ? 1 : 0,
      useNativeDriver: true,
      damping: 19,
      stiffness: 170,
      mass: 0.8,
    }).start();
  }, [activeGuidance, guidanceProgress]);

  const recenter = useCallback(() => {
    if (!position) {
      void refreshLocation();
      return;
    }
    cameraRef.current?.setCamera({
      centerCoordinate: [position.coords.longitude, position.coords.latitude],
      zoomLevel: 17,
      animationDuration: 500,
      animationMode: 'easeTo',
    });
  }, [position, refreshLocation]);

  const resetNorth = useCallback(() => {
    setNorthUp(true);
    setBearing(0);
    recenter();
  }, [recenter]);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const cycleTheme = useCallback(() => preferences.setTheme(preferences.theme === 'auto' ? 'dark' : preferences.theme === 'dark' ? 'light' : 'auto'), [preferences.setTheme, preferences.theme]);
  const onBearingChange = useCallback((value: number) => {
    setBearing(value);
    if (Math.abs(value) > 1) setNorthUp(false);
  }, []);

  const sheetOffset = useMemo(() => sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [252, 0] }), [sheetProgress]);
  const extraOpacity = sheetProgress;
  const statusMessage = session.status === 'requesting'
    ? 'Finding your location'
    : session.status === 'permission-denied'
      ? 'Location access needed'
      : session.status === 'services-disabled'
        ? 'Location services are off'
        : session.status === 'unavailable'
          ? 'Signal unavailable'
          : session.isFresh
            ? 'Live location'
            : 'Location may be stale';

  return (
    <SafeAreaView style={[styles.safeArea, preferences.isNight && styles.nightSafeArea]}>
      <StatusBar style={preferences.isNight ? 'light' : 'dark'} />
      <View style={[styles.screen, preferences.isNight && styles.nightScreen]}>
        <RecoveryBoundary scope="map"><MapCanvas
          coordinates={coordinates}
          routeCoordinates={activeGuidance && navigation.route ? navigation.route.geometry : recentRouteCoordinates}
          accuracy={session.accuracy}
          cameraRef={cameraRef}
          northUp={northUp}
          isNight={preferences.isNight}
          onBearingChange={onBearingChange}
        /></RecoveryBoundary>
        <View pointerEvents="none" style={[styles.mapVignette, preferences.isNight && styles.nightMapVignette]} />
        {!activeGuidance ? <Pressable accessibilityRole="button" accessibilityLabel="Search saved destinations" onPress={openSearch} style={({ pressed }) => [styles.searchLaunch, pressed && styles.controlPressed]}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <Text style={styles.searchLaunchText}>Where to?</Text>
          <View style={styles.searchLaunchHint}><Text style={styles.searchLaunchHintText}>⌘</Text></View>
        </Pressable> : null}
        <View style={styles.topBar}>
          <Pressable onLongPress={() => setDiagnosticsVisible(true)} style={styles.brandLockup}>
            <View style={styles.brandMark}><Text style={styles.brandArrow}>↗</Text></View>
            <View>
              <Text style={styles.brand}>NAVDIRECT</Text>
              <Text style={styles.brandCaption}>MOVE WITH CONFIDENCE</Text>
            </View>
          </Pressable>
          <View style={styles.statusStack}>
            <View style={styles.livePill}>
              <View style={[styles.liveDot, { backgroundColor: active ? COLORS.cyan : '#E5B66B' }]} />
              <Text style={styles.liveText}>{statusMessage}</Text>
            </View>
            <View style={[styles.modePill, !offline.isOnline && styles.offlineModePill]}>
              <Text style={[styles.modeText, !offline.isOnline && styles.offlineModeText]}>
                {offline.isOnline === null
                  ? 'CHECKING CONNECTION'
                  : offline.isOnline
                    ? 'ONLINE · ON DEVICE'
                    : 'OFFLINE · SAVING LOCALLY'}
              </Text>
            </View>
            {session.backgroundStatus === 'running' ? (
              <View style={[styles.backgroundPill, battery.isLowBattery && styles.batterySaverPill]}><View style={[styles.backgroundDot, battery.isLowBattery && styles.batterySaverDot]} /><Text style={[styles.backgroundText, battery.isLowBattery && styles.batterySaverText]}>{battery.isLowBattery ? 'BATTERY-SAVER TRACKING' : 'BACKGROUND TRACKING'}</Text></View>
            ) : null}
          </View>
        </View>

        <Animated.View style={[styles.controls, { bottom: activeGuidance ? 238 : 552, transform: activeGuidance ? undefined : [{ translateY: sheetOffset }] }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Reset map to north" onPress={resetNorth} style={({ pressed }) => [styles.mapControl, pressed && styles.controlPressed]}>
            <View style={[styles.compassNeedle, { transform: [{ rotate: `${bearing}deg` }] }]}>
              <Text style={styles.compassNorth}>N</Text>
              <Text style={styles.compassSouth}>⌄</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Recenter on my location" onPress={recenter} style={({ pressed }) => [styles.mapControl, styles.recenterControl, pressed && styles.controlPressed]}>
            <Text style={styles.recenterIcon}>◎</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Theme ${preferences.theme}. Switch appearance`} onPress={cycleTheme} style={({ pressed }) => [styles.mapControl, preferences.isNight && styles.nightMapControl, pressed && styles.controlPressed]}>
            <Text style={styles.themeControlIcon}>{preferences.theme === 'auto' ? 'A' : preferences.isNight ? '☾' : '☼'}</Text>
          </Pressable>
        </Animated.View>

        {activeGuidance && navigation.route ? (
          <RecoveryBoundary scope="guidance"><>
            <Animated.View style={[styles.guidanceBanner, preferences.isNight && styles.nightGuidanceBanner, { opacity: guidanceProgress, transform: [{ translateY: guidanceProgress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>
              <View style={[styles.turnIcon, (!guidanceFresh || guidance?.isOffRoute) && styles.turnIconAlert]}><Text style={styles.turnIconText}>{!guidanceFresh ? '⌖' : guidance?.isOffRoute ? '!' : maneuverGlyph(guidance?.nextManeuver?.instruction ?? 'Continue')}</Text></View>
              <View style={styles.guidanceBannerCopy}>
                <Text style={styles.guidanceDistance}>{!guidanceFresh ? 'GPS SIGNAL LOST' : guidance?.isOffRoute ? 'ROUTE DEVIATION' : navigation.route.mode === 'simulation' ? 'LOCAL SIMULATION' : guidance?.distanceToNextManeuver === null ? 'ARRIVING' : `IN ${formatDistance(guidance?.distanceToNextManeuver ?? 0)}`}</Text>
                <Text numberOfLines={2} style={styles.guidanceInstruction}>{!guidanceFresh ? 'Last position may be outdated' : guidance?.isOffRoute ? 'You are off route' : guidance?.nextManeuver?.instruction ?? `Continue to ${navigation.route.destination.title}`}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={preferences.voiceEnabled ? 'Mute voice guidance' : 'Unmute voice guidance'} onPress={() => { preferences.setVoiceEnabled(!preferences.voiceEnabled); void Haptics.selectionAsync().catch(() => undefined); }} style={({ pressed }) => [styles.voiceToggle, !preferences.voiceEnabled && styles.voiceToggleMuted, pressed && styles.controlPressed]}>
                <Text style={[styles.voiceToggleGlyph, !preferences.voiceEnabled && styles.voiceToggleGlyphMuted]}>{preferences.voiceEnabled ? '◖))' : '◖×'}</Text>
                <Text style={[styles.voiceToggleLabel, !preferences.voiceEnabled && styles.voiceToggleLabelMuted]}>{preferences.voiceEnabled ? 'VOICE ON' : 'MUTED'}</Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[styles.speedHud, overSpeedLimit && styles.speedHudAlert, { transform: [{ scale: speedPulse }] }]}>
              <View style={styles.speedHudTop}><Text style={styles.speedValue}>{speedDisplay}</Text><Text style={styles.speedUnit}>{preferences.speedUnit === 'kmh' ? 'KM/H' : 'MPH'}</Text></View>
              <Text style={styles.speedLimitCaption}>{overSpeedLimit ? 'SPEED ALERT' : `LIMIT · ${speedLimitDisplay}`}</Text>
            </Animated.View>
            <Animated.View style={[styles.guidanceSheet, preferences.isNight && styles.nightGuidanceSheet, { opacity: guidanceProgress, transform: [{ translateY: guidanceProgress.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }] }]}>
              <View style={[styles.routeModeBadge, navigation.route.mode === 'simulation' && styles.routeModeSimulation, (navigation.route.mode === 'cached' || offline.isOnline !== true) && styles.routeModeCached]}><Text style={styles.routeModeText}>{navigation.route.mode === 'simulation'
                ? 'SIMULATION · LOCAL ONLY'
                : navigation.route.mode === 'cached' || offline.isOnline !== true ? 'SAVED ROUTE · OFFLINE' : 'PRIVATE ROUTE SERVICE'}</Text></View>
              {!guidanceFresh ? <View style={styles.gpsWarning}><Text style={styles.gpsWarningTitle}>LOCATION SIGNAL NEEDS ATTENTION</Text><Text style={styles.gpsWarningText}>Last fix: {ageLabel}. Guidance distance is paused until a fresh GPS position returns.</Text><Pressable onPress={() => void session.refresh()} style={({ pressed }) => [styles.gpsRetry, pressed && styles.controlPressed]}><Text style={styles.gpsRetryText}>REFRESH LOCATION</Text></Pressable></View> : null}
              {guidanceFresh && guidance?.isOffRoute ? <View style={styles.rerouteStatus}><View style={styles.rerouteDot} /><Text style={styles.rerouteStatusText}>{navigation.rerouting
                ? 'FINDING A NEW ROUTE'
                : navigation.routeError ?? (offline.isOnline !== true
                  ? 'OFFLINE · CURRENT ROUTE REMAINS AVAILABLE'
                  : navigation.routingConfigured ? 'ROUTE DEVIATION · READY TO RECALCULATE' : 'CONFIGURE PRIVATE ROUTER TO REROUTE')}</Text></View> : null}
              <View style={styles.guidanceSummary}>
                <View><Text style={styles.guidanceEta}>{guidance && guidanceFresh ? formatDuration(guidance.remainingSeconds) : '—'}</Text><Text style={styles.guidanceMeta}>{guidance && guidanceFresh ? `${navigation.route.mode === 'simulation' ? 'simulated · ' : ''}remaining · ${formatDistance(guidance.remainingMeters)}` : 'Waiting for a fresh GPS fix'}</Text></View>
                <View style={styles.destinationMini}><Text style={styles.destinationMiniEyebrow}>DESTINATION</Text><Text numberOfLines={1} style={styles.destinationMiniTitle}>{navigation.route.destination.title}</Text></View>
              </View>
              <LocationTelemetryHud telemetry={session.telemetry} isNight={preferences.isNight} trackingStatus={session.backgroundStatus} />
              {navigation.routeError && !(guidanceFresh && guidance?.isOffRoute) ? <Text numberOfLines={2} style={styles.featureMessage}>{navigation.routeError}</Text> : null}
              <View style={styles.guidanceActions}>
                {navigation.route.mode === 'simulation' ? <Pressable disabled={!guidance?.nextManeuver || !guidanceFresh} onPress={() => {
                  if (!guidance) return;
                  const next = guidance.nextManeuver;
                  setDemoPosition(next?.coordinate ?? navigation.route?.destination ?? null);
                  void Haptics.selectionAsync().catch(() => undefined);
                }} style={({ pressed }) => [styles.rerouteButton, (!guidance?.nextManeuver || !guidanceFresh) && styles.saveCurrentDisabled, pressed && styles.controlPressed]}><Text style={styles.rerouteButtonText}>{guidance?.nextManeuver ? 'NEXT DEMO STEP  →' : 'DEMO ARRIVED'}</Text></Pressable> : null}
                {guidanceFresh && guidance?.isOffRoute && navigation.route.mode !== 'simulation' ? <Pressable disabled={navigation.rerouting || !session.isFresh} onPress={() => void navigation.reroute(navigation.route!.destination, coordinates)} style={({ pressed }) => [styles.rerouteButton, (navigation.rerouting || !session.isFresh) && styles.saveCurrentDisabled, pressed && styles.controlPressed]}><Text style={styles.rerouteButtonText}>{navigation.rerouting ? 'REROUTING…' : navigation.routingConfigured && offline.isOnline === true ? '↻  REROUTE' : '↻  LOCAL REROUTE'}</Text></Pressable> : null}
                <Pressable accessibilityRole="button" onPress={() => { setActiveGuidance(false); setDemoPosition(null); navigation.clearRoute(); if (session.backgroundStatus !== 'running') void finishRouteSession(); }} style={({ pressed }) => [styles.endGuidanceButton, pressed && styles.controlPressed]}><Text style={styles.endGuidanceText}>END</Text></Pressable>
              </View>
            </Animated.View>
          </></RecoveryBoundary>
        ) : <PlaceBottomSheet
          offset={sheetOffset}
          opacity={extraOpacity}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          placeTitle={session.place?.title ?? (position ? 'Finding this place…' : 'Your location')}
          placeSubtitle={session.place?.subtitle ?? (position ? 'Resolving nearby address' : 'A precise place name is on its way')}
          placeResolving={session.placeStatus === 'resolving'}
          onRefreshPlace={session.retryPlaceLookup}
          isLive={active}
          ageLabel={ageLabel}
          accuracyLabel={accuracyLabel}
          telemetry={session.telemetry}
          backgroundStatus={session.backgroundStatus}
          backgroundMessage={session.backgroundMessage}
          onToggleBackground={session.toggleBackgroundTracking}
          recentRoutes={recentRoutes}
          coordinatesLabel={coordinates ? `${coordinates.latitude.toFixed(5)}°, ${coordinates.longitude.toFixed(5)}°` : 'Waiting for a GPS fix'}
          error={session.error}
          isNight={preferences.isNight}
          theme={preferences.theme}
          onSetTheme={preferences.setTheme}
          speedUnit={preferences.speedUnit}
          onSetSpeedUnit={preferences.setSpeedUnit}
          speedLimitKmh={preferences.speedLimitKmh}
          onSetSpeedLimitKmh={preferences.setSpeedLimitKmh}
        />}
        {session.error && !expanded ? (
          <Pressable onPress={() => void session.refresh()} style={styles.retryPill}>
            <Text style={styles.retryText}>LOCATION NEEDS ATTENTION · TAP TO RETRY</Text>
          </Pressable>
        ) : null}
        <Animated.Text style={[styles.mapAttribution, { bottom: 530, transform: [{ translateY: sheetOffset }] }]}>© OpenStreetMap contributors</Animated.Text>
      </View>
      <Modal visible={searchVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSearchVisible(false)}>
        <SafeAreaView style={styles.searchModal}>
          <View style={styles.searchModalHeader}>
            <View><Text style={styles.searchEyebrow}>YOUR NEXT STOP</Text><Text style={styles.searchTitle}>Where to?</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close destination search" onPress={() => { setSearchVisible(false); setSelectedDestination(null); }} style={styles.diagnosticsClose}><Text style={styles.diagnosticsCloseText}>×</Text></Pressable>
          </View>
          <View style={styles.searchInputWrap}>
            <Text style={styles.searchInputGlyph}>⌕</Text>
            <TextInput value={destinationQuery} onChangeText={setDestinationQuery} placeholder="Search for a place" placeholderTextColor="#85979D" style={styles.searchInput} returnKeyType="search" />
            {destinationQuery ? <Pressable onPress={() => setDestinationQuery('')}><Text style={styles.clearQuery}>×</Text></Pressable> : null}
          </View>
          {!destinationQuery.trim() && !selectedDestination && savedPlaces.length > 0 ? <View style={styles.quickAccessBlock}>
            <View style={styles.quickAccessHeader}><Text style={styles.savedHeading}>QUICK ACCESS</Text><Text style={styles.quickAccessHint}>ON THIS DEVICE</Text></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickAccessShelf}>
              {savedPlaces.slice(0, 12).map((place) => <Pressable key={place.id} disabled={!coordinates || quickStartId !== null} onPress={() => void startSavedPlace(place)} style={({ pressed }) => [styles.quickPlaceCard, { borderColor: `${place.categoryColor}55` }, pressed && styles.destinationPressed]}>
                <View style={[styles.quickPlaceIcon, { backgroundColor: `${place.categoryColor}20` }]}><Text style={[styles.quickPlaceIconText, { color: place.categoryColor }]}>{place.categoryIcon}</Text></View>
                <Text numberOfLines={1} style={styles.quickPlaceTitle}>{quickStartId === place.id ? 'ROUTING…' : place.title}</Text>
                <Text numberOfLines={1} style={styles.quickPlaceCategory}>{place.categoryLabel.toUpperCase()}</Text>
              </Pressable>)}
            </ScrollView>
          </View> : null}
          {selectedDestination ? (
            <View style={styles.destinationPreview}>
              <Text style={styles.detailsLabel}>{selectedDestination.source === 'simulation' ? 'LOCAL PRACTICE DESTINATION' : selectedDestination.source === 'osm' ? 'OPENSTREETMAP DESTINATION' : 'ON-DEVICE DESTINATION'}</Text>
              <Text style={styles.destinationPreviewTitle}>{selectedDestination.title}</Text>
              <Text style={styles.destinationPreviewSubtitle}>{selectedDestination.subtitle || 'On-device saved place'}</Text>
              {coordinates ? <Text style={styles.destinationDistance}>{formatDistance(distanceBetweenMeters(coordinates, selectedDestination))} direct distance</Text> : <Text style={styles.destinationDistance}>Waiting for your location</Text>}
              <Text style={styles.categoryPickerEyebrow}>SAVE TO QUICK ACCESS</Text>
              <View style={styles.categoryPickerRow}>{PRESET_CATEGORIES.map((category) => <Pressable key={category.category} onPress={() => { setCustomCategoryEditing(false); void assignSelectedCategory(category); }} style={[styles.categoryPickerOption, selectedDestination.category === category.category && { borderColor: category.categoryColor, backgroundColor: `${category.categoryColor}18` }]}>
                <Text style={[styles.categoryPickerIcon, { color: category.categoryColor }]}>{category.categoryIcon}</Text><Text style={styles.categoryPickerText}>{category.categoryLabel.toUpperCase()}</Text>
              </Pressable>)}
                <Pressable onPress={() => setCustomCategoryEditing((value) => !value)} style={[styles.categoryPickerOption, selectedDestination.category === 'custom' && styles.customCategorySelected]}><Text style={styles.categoryPickerIcon}>✦</Text><Text style={styles.categoryPickerText}>CUSTOM</Text></Pressable>
              </View>
              {customCategoryEditing ? <View style={styles.customCategoryEditor}>
                <View style={styles.customEditorInputs}>
                  <TextInput value={customCategoryIcon} onChangeText={(value) => setCustomCategoryIcon(value.slice(0, 2))} maxLength={2} placeholder="Icon" placeholderTextColor="#81979D" style={styles.customIconInput} />
                  <TextInput value={customCategoryLabel} onChangeText={setCustomCategoryLabel} maxLength={20} placeholder="Category name" placeholderTextColor="#81979D" style={styles.customLabelInput} />
                </View>
                <View style={styles.categoryColorRow}>{CATEGORY_COLORS.map((color) => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Choose category color ${color}`} onPress={() => setCustomCategoryColor(color)} style={[styles.categoryColorOption, { backgroundColor: color }, customCategoryColor === color && styles.categoryColorSelected]} />)}</View>
                <Pressable disabled={!customCategoryLabel.trim()} onPress={() => { void assignSelectedCategory({ category: 'custom', categoryLabel: customCategoryLabel.trim(), categoryIcon: customCategoryIcon || '✦', categoryColor: customCategoryColor }); setCustomCategoryEditing(false); }} style={[styles.customCategorySave, !customCategoryLabel.trim() && styles.saveCurrentDisabled]}><Text style={styles.customCategorySaveText}>SAVE CUSTOM CATEGORY</Text></Pressable>
              </View> : null}
              {navigation.route?.destination.id === selectedDestination.id ? (
                <>
                  <View style={styles.roadRouteSummary}><Text style={styles.roadRouteEyebrow}>{navigation.route.mode === 'simulation' ? 'SIMULATED · NOT ROAD DATA' : navigation.route.mode === 'cached' ? 'SAVED ROUTE · ON THIS DEVICE' : 'PRIVATE ROUTE PREVIEW'}</Text><Text style={styles.roadRouteDistance}>{formatDistance(navigation.route.distanceMeters)}</Text><Text style={styles.roadRouteDuration}>{navigation.route.mode === 'simulation' ? `Simulated ETA · ${formatDuration(navigation.route.durationSeconds)}` : `Estimated · ${formatDuration(navigation.route.durationSeconds)}`}</Text></View>
                  <Pressable onPress={() => {
                    void startRouteSession();
                    setDemoPosition(navigation.route?.mode === 'simulation' ? coordinates : null);
                    setActiveGuidance(true);
                    setSearchVisible(false);
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                  }} style={({ pressed }) => [styles.startGuidanceButton, pressed && styles.controlPressed]}><Text style={styles.startGuidanceText}>{navigation.route.mode === 'simulation' ? 'START PRACTICE ROUTE  →' : 'START GUIDANCE  →'}</Text></Pressable>
                </>
              ) : (
                <>
                  <View style={styles.providerNotice}><Text style={styles.providerNoticeText}>{navigation.routingConfigured ? 'Route request goes to your configured private routing service. Straight-line distance is not a road route.' : 'Configure a private OSRM-compatible service to calculate road distance, ETA and turn instructions.'}</Text></View>
                  <Pressable disabled={navigation.routeBusy || !coordinates} onPress={() => void navigation.previewRoute(selectedDestination, coordinates)} style={({ pressed }) => [styles.startGuidanceButton, (navigation.routeBusy || !coordinates) && styles.saveCurrentDisabled, pressed && styles.controlPressed]}>
                    {navigation.routeBusy ? <ActivityIndicator color="#0C2D31" /> : <Text style={styles.startGuidanceText}>CALCULATE ROAD ROUTE  →</Text>}
                  </Pressable>
                </>
              )}
              {navigation.routeError ? <Text style={styles.searchError}>{navigation.routeError}</Text> : null}
            </View>
          ) : (
            <>
              {destinationQuery.trim() && !navigation.geocodingConfigured ? <View style={styles.providerNotice}><Text style={styles.providerNoticeText}>LOCAL PRACTICE MODE · Saved and cached matches stay on this device. Demo waypoints are synthetic and do not represent real places.</Text></View> : null}
              {destinationQuery.trim() && offline.isOnline === false ? <View style={styles.providerNotice}><Text style={styles.providerNoticeText}>Offline search · showing saved and cached matches from this device.</Text></View> : null}
              {navigation.searchError ? <Text style={styles.searchError}>{navigation.searchError}</Text> : null}
              <Text style={styles.savedHeading}>{destinationQuery.trim().length >= 2 ? 'PLACES NEAR YOUR SEARCH' : 'RECENT & SAVED PLACES'} <Text style={styles.savedCount}>{navigation.suggestions.length.toString().padStart(2, '0')}</Text></Text>
              {navigation.suggestions.map((destination) => (
                <Pressable key={destination.id} onPress={() => { setCustomCategoryEditing(false); setSelectedDestination(destination); void Haptics.selectionAsync().catch(() => undefined); }} style={({ pressed }) => [styles.destinationRow, pressed && styles.destinationPressed]}>
                  <View style={styles.destinationGlyph}><Text style={styles.destinationGlyphText}>⌖</Text></View>
                  <View style={styles.featureCopy}><Text numberOfLines={1} style={styles.destinationRowTitle}>{destination.title}</Text><Text numberOfLines={1} style={styles.destinationRowSubtitle}>{destination.subtitle || `${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)}`}</Text></View>
                  {destination.source === 'simulation' ? <View style={styles.demoRowBadge}><Text style={styles.demoRowBadgeText}>DEMO</Text></View> : null}
                  <Text style={styles.destinationChevron}>›</Text>
                </Pressable>
              ))}
              {navigation.searching ? <View style={styles.searchingRow}><ActivityIndicator color={COLORS.cyan} /><Text style={styles.searchingText}>Finding places…</Text></View> : null}
              {navigation.suggestions.length === 0 && !navigation.searching ? <Text style={styles.emptySaved}>{destinationQuery.trim().length < 2 ? 'Saved places and recently resolved areas appear here.' : 'No local match yet. Live search begins after three characters when your private endpoint is online.'}</Text> : null}
            </>
          )}
          <View style={styles.searchBottom}>
            <Text style={styles.localOnlyText}>{destinationQuery.trim() && navigation.geocodingConfigured && offline.isOnline === true
              ? 'SEARCH SENT ONLY TO YOUR PRIVATE ENDPOINT · © OPENSTREETMAP CONTRIBUTORS'
              : 'LOCAL-FIRST · SAVED PLACES REMAIN ON THIS DEVICE'}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={!coordinates || !session.place}
              onPress={async () => {
                if (!coordinates || !session.place) return;
                await saveDestination({ title: session.place.title, subtitle: session.place.subtitle, ...coordinates });
                await Promise.all([navigation.refreshLocal(), refreshSavedPlaces()]);
              }}
              style={({ pressed }) => [styles.saveCurrentButton, (!coordinates || !session.place) && styles.saveCurrentDisabled, pressed && styles.controlPressed]}
            ><Text style={styles.saveCurrentText}>＋  SAVE CURRENT PLACE</Text></Pressable>
          </View>
        </SafeAreaView>
      </Modal>
      {__DEV__ ? (
        <Modal visible={diagnosticsVisible} animationType="fade" transparent onRequestClose={() => setDiagnosticsVisible(false)}>
          <View style={styles.diagnosticsScrim}>
            <View style={styles.diagnosticsCard}>
              <View style={styles.diagnosticsHeader}>
                <View><Text style={styles.diagnosticsEyebrow}>DEVELOPER TOOLS</Text><Text style={styles.diagnosticsTitle}>Location session</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close developer tools" onPress={() => setDiagnosticsVisible(false)} style={styles.diagnosticsClose}><Text style={styles.diagnosticsCloseText}>×</Text></Pressable>
              </View>
              <DiagnosticRow label="Session" value={session.status} />
              <DiagnosticRow label="Permission" value={`${session.permission?.status ?? 'unknown'} · ${session.permission?.granted ? 'granted' : 'not granted'}`} />
              <DiagnosticRow label="Place resolver" value={session.placeStatus} />
              <DiagnosticRow label="Fix freshness" value={session.ageMs === null ? 'No fix' : `${Math.round(session.ageMs / 1000)} sec · ${session.isFresh ? 'fresh' : 'stale'}`} />
              <DiagnosticRow label="Accuracy" value={session.accuracy === null ? '—' : `${Math.round(session.accuracy)} m`} />
              <DiagnosticRow label="Coordinates" value={coordinates ? `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}` : '—'} />
              <DiagnosticRow label="Last error" value={session.error ?? 'None'} />
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

export default memo(NavigationHomeScreenView);

type PlaceBottomSheetProps = {
  offset: Animated.AnimatedInterpolation<number>;
  opacity: Animated.Value;
  expanded: boolean;
  onToggleExpanded: () => void;
  placeTitle: string;
  placeSubtitle: string;
  placeResolving: boolean;
  onRefreshPlace: () => void;
  isLive: boolean;
  ageLabel: string;
  accuracyLabel: string;
  telemetry: LocationTelemetry;
  backgroundStatus: string;
  backgroundMessage: string | null;
  onToggleBackground: () => void;
  recentRoutes: RecentRoute[];
  coordinatesLabel: string;
  error: string | null;
  isNight: boolean;
  theme: ThemePreference;
  onSetTheme: (theme: ThemePreference) => void;
  speedUnit: SpeedUnit;
  onSetSpeedUnit: (unit: SpeedUnit) => void;
  speedLimitKmh: number;
  onSetSpeedLimitKmh: (limit: number) => void;
};

const PlaceBottomSheet = memo(function PlaceBottomSheet({
  offset, opacity, expanded, onToggleExpanded, placeTitle, placeSubtitle, placeResolving, onRefreshPlace,
  isLive, ageLabel, accuracyLabel, telemetry, backgroundStatus, backgroundMessage, onToggleBackground, recentRoutes,
  coordinatesLabel, error, isNight, theme, onSetTheme, speedUnit, onSetSpeedUnit, speedLimitKmh, onSetSpeedLimitKmh,
}: PlaceBottomSheetProps) {
  const tracking = backgroundStatus === 'running';
  const trackingStarting = backgroundStatus === 'starting';
  return (
    <Animated.View style={[styles.placeSheet, isNight && styles.nightPlaceSheet, { transform: [{ translateY: offset }] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse place details' : 'Expand place details'} onPress={onToggleExpanded} style={styles.sheetHandleArea}><View style={styles.sheetHandle} /></Pressable>
      <View style={styles.sheetHeading}>
        <View style={styles.placeGlyph}><Text style={styles.placeGlyphText}>⌖</Text></View>
        <View style={styles.placeHeadingCopy}>
          <Text style={styles.eyebrow}>YOU ARE HERE</Text><Text numberOfLines={1} style={styles.placeTitle}>{placeTitle}</Text>
          <Text numberOfLines={1} style={styles.placeSubtitle}>{placeSubtitle}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh place name" onPress={onRefreshPlace} style={styles.refreshButton}>
          {placeResolving ? <ActivityIndicator size="small" color={COLORS.cyan} /> : <Text style={styles.refreshIcon}>↻</Text>}
        </Pressable>
      </View>
      <View style={styles.sheetDivider} />
      <View style={styles.metaRow}>
        <View style={styles.metaItem}><View style={[styles.metaStatusDot, { backgroundColor: isLive ? COLORS.cyan : '#E5B66B' }]} /><Text style={styles.metaText}>{ageLabel}</Text></View>
        <View style={styles.metaSeparator} />
        <View style={styles.metaItem}><Text style={styles.accuracyGlyph}>⌖</Text><Text style={styles.metaText}>{accuracyLabel} accuracy</Text></View>
      </View>
      <LocationTelemetryHud telemetry={telemetry} isNight={isNight} trackingStatus={backgroundStatus} />
      <Animated.ScrollView style={[styles.expandedDetails, { opacity }]} contentContainerStyle={styles.expandedDetailsContent} scrollEnabled={expanded} nestedScrollEnabled>
        <View style={styles.sheetDivider} />
        <View style={styles.featureHeadingRow}>
          <View style={styles.featureCopy}>
            <Text style={styles.detailsLabel}>SCREEN-OFF TRIP TRACKING</Text>
            <Text style={styles.featureDescription}>{tracking
              ? Platform.OS === 'android' ? 'Your route stays on this device. Android shows an ongoing tracking notification.' : 'Your route is being saved on this device.'
              : Platform.OS === 'android' ? 'Keep your route recording in the background. Android shows an ongoing status notification while tracking.' : 'Keep your route recording while NavDiret is in the background.'}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={tracking ? 'Stop background trip tracking' : 'Start background trip tracking'} disabled={trackingStarting} onPress={onToggleBackground}
            style={({ pressed }) => [styles.trackingButton, tracking && styles.stopTrackingButton, pressed && styles.controlPressed]}>
            <Text style={[styles.trackingButtonText, tracking && styles.stopTrackingText]}>{trackingStarting ? '…' : tracking ? 'STOP' : 'START'}</Text>
          </Pressable>
        </View>
        {backgroundMessage ? <Text style={styles.featureMessage}>{backgroundMessage}</Text> : null}
        <View style={styles.sheetDivider} />
        <View style={styles.syncRow}>
          <View style={styles.featureCopy}><Text style={styles.detailsLabel}>PRIVATE · STORED ON THIS DEVICE</Text><Text style={styles.featureDescription}>Place names, trip history and location breadcrumbs stay in local SQLite storage. Cloud sync is off.</Text></View>
          <View style={styles.localLock}><Text style={styles.localLockText}>⌑</Text></View>
        </View>
        {recentRoutes.length > 0 ? <View style={styles.recentRouteList}>
          <Text style={styles.detailsLabel}>RECENT ON-DEVICE ROUTES</Text>
          {recentRoutes.slice(0, 2).map((route) => <View key={route.id} style={styles.routeRow}>
            <View style={styles.routeGlyph}><Text style={styles.routeGlyphText}>↗</Text></View>
            <View style={styles.featureCopy}>
              <Text numberOfLines={1} style={styles.routeTitle}>{route.startPlace && route.endPlace && route.startPlace !== route.endPlace ? `${route.startPlace} → ${route.endPlace}` : route.endPlace || route.startPlace || 'Saved route'}</Text>
              <Text style={styles.routeSubtitle}>{new Date(route.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {route.sampleCount} fixes · {route.endedAt ? 'On this device' : 'In progress'}</Text>
            </View>
          </View>)}
        </View> : null}
        <View style={styles.sheetDivider} /><Text style={styles.detailsLabel}>COORDINATES</Text>
        <Text style={styles.coordinatesText}>{coordinatesLabel}</Text>
        {error ? <Text numberOfLines={2} style={styles.errorText}>{error}</Text> : null}
        <View style={styles.settingsBlock}>
          <View style={styles.sheetDivider} />
          <Text style={styles.detailsLabel}>APPEARANCE</Text>
          <View style={styles.preferenceOptions}>{(['light', 'auto', 'dark'] as const).map((value) => <Pressable key={value} onPress={() => onSetTheme(value)} style={[styles.preferenceOption, theme === value && styles.preferenceOptionSelected]}><Text style={[styles.preferenceOptionText, theme === value && styles.preferenceOptionTextSelected]}>{value.toUpperCase()}</Text></Pressable>)}</View>
          <View style={styles.sheetDivider} />
          <View style={styles.speedPreferenceRow}>
            <View style={styles.featureCopy}><Text style={styles.detailsLabel}>SPEED UNITS</Text><Text style={styles.featureDescription}>Live GPS speed display</Text></View>
            <View style={styles.preferenceOptionsCompact}>{(['kmh', 'mph'] as const).map((value) => <Pressable key={value} onPress={() => onSetSpeedUnit(value)} style={[styles.preferenceOption, speedUnit === value && styles.preferenceOptionSelected]}><Text style={[styles.preferenceOptionText, speedUnit === value && styles.preferenceOptionTextSelected]}>{value === 'kmh' ? 'KM/H' : 'MPH'}</Text></Pressable>)}</View>
          </View>
          <View style={styles.speedPreferenceRow}>
            <View style={styles.featureCopy}><Text style={styles.detailsLabel}>PERSONAL SPEED ALERT</Text><Text style={styles.featureDescription}>Not a posted road speed limit</Text></View>
            <View style={styles.speedLimitStepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="Lower speed alert" onPress={() => onSetSpeedLimitKmh(speedLimitKmh - (speedUnit === 'kmh' ? 5 : 8))} style={styles.stepperButton}><Text style={styles.stepperGlyph}>−</Text></Pressable>
              <Text style={styles.stepperValue}>{speedUnit === 'kmh' ? speedLimitKmh : Math.round(speedLimitKmh / 1.609344)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Raise speed alert" onPress={() => onSetSpeedLimitKmh(speedLimitKmh + (speedUnit === 'kmh' ? 5 : 8))} style={styles.stepperButton}><Text style={styles.stepperGlyph}>＋</Text></Pressable>
            </View>
          </View>
        </View>
      </Animated.ScrollView>
    </Animated.View>
  );
});

const DiagnosticRow = memo(function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagnosticRow}>
      <Text style={styles.diagnosticLabel}>{label}</Text>
      <Text selectable style={styles.diagnosticValue}>{value}</Text>
    </View>
  );
});

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
}

function maneuverGlyph(instruction: string) {
  const text = instruction.toLowerCase();
  if (text.includes('left')) return '↰';
  if (text.includes('right')) return '↱';
  if (text.includes('u-turn') || text.includes('uturn')) return '↶';
  if (text.includes('roundabout')) return '⟳';
  if (text.includes('arrive')) return '◎';
  return '↑';
}

type MapCanvasProps = {
  coordinates: { latitude: number; longitude: number } | null;
  routeCoordinates: { latitude: number; longitude: number }[];
  accuracy: number | null;
  cameraRef: React.RefObject<CameraRef | null>;
  northUp: boolean;
  isNight: boolean;
  onBearingChange: (bearing: number) => void;
};

const MapCanvas = memo(function MapCanvas({ coordinates, routeCoordinates, accuracy, cameraRef, northUp, isNight, onBearingChange }: MapCanvasProps) {
  useEffect(() => {
    // OSM asks clients to send an identifiable User-Agent. Never use this client for bulk/offline tile downloads.
    if (Platform.OS === 'web') return;
    addCustomHeader('User-Agent', 'NavDiret/1.0 (mobile map client)');
    return () => removeCustomHeader('User-Agent');
  }, []);

  const routeShape = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: routeCoordinates.length > 1 ? [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: routeCoordinates.map(({ latitude, longitude }) => [longitude, latitude]) },
    }] : [],
  }), [routeCoordinates]);
  const positionShape = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!coordinates) return { type: 'FeatureCollection', features: [] };
    const radius = Math.max(accuracy ?? 24, 18);
    const latitudeDelta = radius / 111_320;
    const longitudeDelta = radius / (111_320 * Math.max(0.15, Math.cos(coordinates.latitude * Math.PI / 180)));
    const circle: [number, number][] = [];
    for (let index = 0; index <= 48; index += 1) {
      const angle = (index / 48) * Math.PI * 2;
      circle.push([coordinates.longitude + Math.cos(angle) * longitudeDelta, coordinates.latitude + Math.sin(angle) * latitudeDelta]);
    }
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'accuracy' }, geometry: { type: 'Polygon', coordinates: [circle] } },
        { type: 'Feature', properties: { kind: 'position' }, geometry: { type: 'Point', coordinates: [coordinates.longitude, coordinates.latitude] } },
      ],
    };
  }, [accuracy, coordinates]);
  const cameraPosition = useMemo(() => coordinates ? [coordinates.longitude, coordinates.latitude] as [number, number] : undefined, [coordinates]);
  const regionChanged = useCallback((feature: GeoJSON.Feature) => {
    const heading = (feature.properties as { heading?: number } | null)?.heading;
    if (typeof heading === 'number') onBearingChange(heading);
  }, [onBearingChange]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {coordinates ? <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={{ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': isNight ? '#111D22' : '#E8EEE8' } }] }}
        attributionEnabled={true}
        attributionPosition={{ bottom: 282, left: 14 }}
        compassEnabled={false}
        logoEnabled={false}
        onRegionDidChange={regionChanged}
      >
        <Camera ref={cameraRef} centerCoordinate={cameraPosition} zoomLevel={16.5} heading={northUp ? 0 : undefined} animationMode="easeTo" animationDuration={280} />
        <RasterSource id="osm-tiles" tileUrlTemplates={[mapTilesUrl]} tileSize={256} maxZoomLevel={19} attribution="© OpenStreetMap contributors" >
          <RasterLayer id="osm-raster" style={isNight ? { rasterSaturation: -0.75, rasterBrightnessMin: 0.08, rasterBrightnessMax: 0.62 } : {}} />
        </RasterSource>
        <ShapeSource id="route-shape" shape={routeShape}><LineLayer id="route-line" style={{ lineColor: '#148F84', lineWidth: 6, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.94 }} /></ShapeSource>
        <ShapeSource id="position-shape" shape={positionShape}>
          <FillLayer id="accuracy-halo" filter={['==', ['get', 'kind'], 'accuracy']} style={{ fillColor: 'rgba(41,178,164,0.16)', fillOutlineColor: 'rgba(41,178,164,0.45)' }} />
          <CircleLayer id="user-dot" filter={['==', ['get', 'kind'], 'position']} style={{ circleColor: '#FFFFFF', circleStrokeColor: '#28AE9E', circleStrokeWidth: 4, circleRadius: 9 }} />
        </ShapeSource>
      </MapView> : <View style={[styles.mapPlaceholder, isNight && styles.nightMapPlaceholder]}><MapArtwork isNight={isNight} /></View>}
    </View>
  );
});

const LocationTelemetryHud = memo(function LocationTelemetryHud({ telemetry, isNight, trackingStatus }: {
  telemetry: LocationTelemetry;
  isNight: boolean;
  trackingStatus: string;
}) {
  const address = telemetry.street || telemetry.nearbyRoad || (telemetry.addressStatus === 'resolving' ? 'Resolving nearby address…' : 'Address unavailable');
  const area = [telemetry.area, telemetry.nearbyRoad, telemetry.city, telemetry.country].filter(Boolean).join(' · ');
  const sourceLabel = telemetry.addressSource === 'online' ? 'ONLINE'
    : telemetry.addressSource === 'cached' ? 'CACHED'
      : telemetry.addressSource === 'offline' ? 'OFFLINE' : 'UNRESOLVED';
  const gpsLabel = telemetry.freshness === 'fresh' ? 'GPS LIVE'
    : telemetry.freshness === 'stale' ? 'GPS STALE' : 'GPS WAITING';
  const coordinatesLabel = telemetry.latitude !== null && telemetry.longitude !== null
    ? `${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)}${telemetry.accuracyMeters !== null ? `  ·  ±${Math.max(1, Math.round(telemetry.accuracyMeters))} m` : ''}`
    : 'Waiting for a valid location fix';
  const accessibleLabel = `Location details. ${address}. ${area || 'Area unavailable'}. ${gpsLabel}. Address ${sourceLabel.toLowerCase()}.`;
  return (
    <View accessibilityRole="summary" accessibilityLabel={accessibleLabel} style={[styles.telemetryCard, isNight && styles.nightTelemetryCard]}>
      <View style={styles.telemetryCopy}>
        <Text style={styles.telemetryEyebrow}>LOCATION DETAILS</Text>
        <Text numberOfLines={1} style={[styles.telemetryStreet, isNight && styles.nightTelemetryText]}>{address}</Text>
        <Text numberOfLines={1} style={styles.telemetryArea}>{area || (telemetry.addressStatus === 'resolving' ? 'Updating place context' : 'Area not available yet')}</Text>
        <Text numberOfLines={1} style={styles.telemetryCoordinates}>{coordinatesLabel}</Text>
      </View>
      <View style={styles.telemetryBadges}>
        <View style={[styles.telemetryBadge, telemetry.freshness === 'fresh' ? styles.telemetryBadgeLive : styles.telemetryBadgeQuiet]}>
          <Text style={[styles.telemetryBadgeText, telemetry.freshness === 'fresh' && styles.telemetryBadgeLiveText]}>{trackingStatus === 'running' ? 'BACKGROUND' : gpsLabel}</Text>
        </View>
        <View style={[styles.telemetryBadge, styles.telemetrySourceBadge]}><Text style={styles.telemetrySourceText}>{sourceLabel}</Text></View>
      </View>
    </View>
  );
});

const MapArtwork = memo(function MapArtwork({ isNight }: { isNight: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.artwork, isNight && styles.nightArtwork]}>
      <View style={[styles.artworkGlow, isNight && styles.nightArtworkGlow]} />
      <View style={[styles.road, isNight && styles.nightRoad, styles.roadOne]} />
      <View style={[styles.road, isNight && styles.nightRoad, styles.roadTwo]} />
      <View style={[styles.road, isNight && styles.nightRoad, styles.roadThree]} />
      <View style={[styles.road, isNight && styles.nightRoad, styles.roadFour]} />
      <View style={[styles.road, isNight && styles.nightRoad, styles.roadFive]} />
      <View style={[styles.road, isNight && styles.nightRoad, styles.roadSix]} />
      <View style={[styles.park, isNight && styles.nightPark, styles.parkOne]} />
      <View style={[styles.park, isNight && styles.nightPark, styles.parkTwo]} />
    </View>
  );
});

const styles = StyleSheet.create({
  nightSafeArea: { backgroundColor: '#060C12' },
  nightScreen: { backgroundColor: '#071018' },
  nightMapVignette: { backgroundColor: 'rgba(2, 7, 12, 0.16)' },
  nightMapControl: { backgroundColor: 'rgba(8, 18, 26, 0.96)', borderColor: 'rgba(114,229,209,0.26)' },
  themeControlIcon: { color: COLORS.cyan, fontSize: 19, fontWeight: '800' },
  nightGuidanceBanner: { backgroundColor: 'rgba(5,14,21,0.97)', borderColor: 'rgba(114,229,209,0.2)' },
  voiceToggle: { minWidth: 55, minHeight: 55, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(114,229,209,0.13)', borderWidth: 1, borderColor: 'rgba(114,229,209,0.26)', paddingHorizontal: 7 },
  voiceToggleMuted: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
  voiceToggleGlyph: { color: COLORS.cyan, fontSize: 17, fontWeight: '800' },
  voiceToggleGlyphMuted: { color: '#A0B0B4' },
  voiceToggleLabel: { color: COLORS.cyan, fontSize: 7, fontWeight: '900', letterSpacing: 0.5, marginTop: 3 },
  voiceToggleLabelMuted: { color: '#A0B0B4' },
  speedHud: { position: 'absolute', zIndex: 6, top: 273, left: 18, minWidth: 88, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 17, backgroundColor: 'rgba(8,22,29,0.92)', borderWidth: 1, borderColor: 'rgba(114,229,209,0.28)', shadowColor: '#02080D', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 7 },
  speedHudAlert: { backgroundColor: 'rgba(99,43,32,0.95)', borderColor: 'rgba(255,163,115,0.72)' },
  speedHudTop: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  speedValue: { color: COLORS.white, fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] },
  speedUnit: { color: '#B9CACB', fontSize: 8, fontWeight: '900' },
  speedLimitCaption: { color: '#95B3B2', fontSize: 7, fontWeight: '900', letterSpacing: 0.6, marginTop: 1 },
  nightGuidanceSheet: { backgroundColor: 'rgba(5,13,20,0.98)', borderColor: 'rgba(114,229,209,0.18)' },
  nightPlaceSheet: { backgroundColor: '#09131C', borderColor: 'rgba(114,229,209,0.17)' },
  nightMapPlaceholder: { backgroundColor: '#071018' },
  nightArtwork: { backgroundColor: '#09131C' },
  nightArtworkGlow: { backgroundColor: 'rgba(23,65,69,0.45)' },
  nightRoad: { backgroundColor: '#14242C', borderColor: '#20353D' },
  nightPark: { backgroundColor: '#102722', borderColor: 'rgba(89,157,131,0.18)' },
  expandedDetailsContent: { paddingBottom: 26 },
  settingsBlock: { paddingBottom: 12 },
  preferenceOptions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  preferenceOptionsCompact: { flexDirection: 'row', gap: 6 },
  preferenceOption: { minHeight: 36, minWidth: 58, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  preferenceOptionSelected: { backgroundColor: 'rgba(114,229,209,0.13)', borderColor: 'rgba(114,229,209,0.46)' },
  preferenceOptionText: { color: '#A5B8BA', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  preferenceOptionTextSelected: { color: COLORS.cyan },
  speedPreferenceRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  speedLimitStepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: COLORS.panelRaised },
  stepperGlyph: { color: COLORS.cyan, fontSize: 20, fontWeight: '700' },
  stepperValue: { minWidth: 26, textAlign: 'center', color: COLORS.white, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  quickAccessBlock: { marginTop: 4 },
  quickAccessHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickAccessHint: { color: '#657F83', fontSize: 8, fontWeight: '800', letterSpacing: 0.7, marginTop: 27, marginBottom: 10 },
  quickAccessShelf: { gap: 9, paddingBottom: 3 },
  quickPlaceCard: { width: 112, minHeight: 110, padding: 11, borderRadius: 18, backgroundColor: '#13232D', borderWidth: 1 },
  quickPlaceIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  quickPlaceIconText: { fontSize: 17, fontWeight: '800' },
  quickPlaceTitle: { color: COLORS.white, fontSize: 11, fontWeight: '800', marginTop: 10 },
  quickPlaceCategory: { color: '#829A9D', fontSize: 7, fontWeight: '900', letterSpacing: 0.6, marginTop: 4 },
  categoryPickerEyebrow: { color: '#91A4A8', fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: 20, marginBottom: 9 },
  categoryPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryPickerOption: { minHeight: 37, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  categoryPickerIcon: { color: COLORS.cyan, fontSize: 15, fontWeight: '800' },
  categoryPickerText: { color: '#D1DEDD', fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  customCategorySelected: { borderColor: 'rgba(114,229,209,0.55)', backgroundColor: 'rgba(114,229,209,0.10)' },
  customCategoryEditor: { marginTop: 10, padding: 12, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  customEditorInputs: { flexDirection: 'row', gap: 8 },
  customIconInput: { width: 54, height: 42, color: COLORS.white, textAlign: 'center', borderRadius: 11, backgroundColor: '#0B1821', borderWidth: 1, borderColor: COLORS.line },
  customLabelInput: { flex: 1, height: 42, color: COLORS.white, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#0B1821', borderWidth: 1, borderColor: COLORS.line },
  categoryColorRow: { flexDirection: 'row', gap: 13, paddingVertical: 13 },
  categoryColorOption: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  categoryColorSelected: { borderColor: '#FFFFFF', transform: [{ scale: 1.16 }] },
  customCategorySave: { minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: 'rgba(114,229,209,0.15)' },
  customCategorySaveText: { color: COLORS.cyan, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  safeArea: { flex: 1, backgroundColor: COLORS.ink },
  screen: { flex: 1, overflow: 'hidden', backgroundColor: '#E8EEE9' },
  mapVignette: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11, 28, 37, 0.04)' },
  topBar: {
    position: 'absolute', top: 10, left: 18, right: 18, zIndex: 3,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  searchLaunch: { position: 'absolute', zIndex: 3, top: 108, left: 18, right: 18, height: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, borderRadius: 19, backgroundColor: 'rgba(12, 27, 35, 0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', shadowColor: '#071821', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  searchGlyph: { color: COLORS.cyan, fontSize: 27, lineHeight: 32 },
  searchLaunchText: { flex: 1, color: '#D9E5E4', fontSize: 14, fontWeight: '500' },
  searchLaunchHint: { width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  searchLaunchHintText: { color: '#A2B4B6', fontSize: 11 },
  brandLockup: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18,
    backgroundColor: 'rgba(9, 19, 27, 0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#031016', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  brandMark: { width: 34, height: 34, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.cyan },
  brandArrow: { color: '#0B2025', fontSize: 25, fontWeight: '700', marginTop: -2 },
  brand: { color: COLORS.white, fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  brandCaption: { marginTop: 3, color: '#A9BBC0', fontSize: 8, fontWeight: '700', letterSpacing: 1.15 },
  livePill: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12,
    borderRadius: 20, backgroundColor: 'rgba(9, 19, 27, 0.83)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  statusStack: { alignItems: 'flex-end', gap: 6 },
  modePill: { minHeight: 23, borderRadius: 12, backgroundColor: 'rgba(17, 74, 69, 0.89)', paddingHorizontal: 9, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  modeText: { color: '#B6F1E6', fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  offlineModePill: { backgroundColor: 'rgba(112, 74, 37, 0.93)' },
  offlineModeText: { color: '#FFE0B4' },
  backgroundPill: { minHeight: 23, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: 'rgba(9, 19, 27, 0.88)', paddingHorizontal: 9, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(114,229,209,0.25)' },
  backgroundDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.cyan },
  backgroundText: { color: COLORS.cyan, fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  batterySaverPill: { backgroundColor: 'rgba(112, 74, 37, 0.93)', borderColor: 'rgba(255, 205, 145, 0.35)' },
  batterySaverDot: { backgroundColor: '#FFD49B' },
  batterySaverText: { color: '#FFE0B4' },
  controls: { position: 'absolute', right: 18, bottom: 300, gap: 10, zIndex: 3, alignItems: 'center' },
  mapControl: {
    width: 52, height: 52, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(12, 29, 38, 0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#071821', shadowOpacity: 0.22, shadowRadius: 13, shadowOffset: { width: 0, height: 5 }, elevation: 7,
  },
  recenterControl: { backgroundColor: COLORS.cyan, borderColor: 'rgba(13, 51, 50, 0.16)' },
  controlPressed: { transform: [{ scale: 0.94 }], opacity: 0.88 },
  compassNeedle: { width: 27, height: 30, alignItems: 'center', justifyContent: 'center' },
  compassNorth: { color: '#F2F6F5', fontWeight: '800', fontSize: 10, position: 'absolute', top: -5 },
  compassSouth: { color: '#78E7D2', fontSize: 25, lineHeight: 28, transform: [{ rotate: '180deg' }] },
  recenterIcon: { color: '#0C3032', fontSize: 32, fontWeight: '300', lineHeight: 38 },
  placeSheet: {
    position: 'absolute', zIndex: 4, left: 12, right: 12, bottom: 12,
    height: 510, overflow: 'hidden', borderRadius: 30, paddingHorizontal: 20, paddingBottom: 20,
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)',
    shadowColor: '#030C11', shadowOpacity: 0.28, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
  sheetHandleArea: { height: 27, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 9 },
  sheetHandle: { width: 38, height: 4, borderRadius: 4, backgroundColor: 'rgba(215,232,233,0.30)' },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingTop: 4, paddingBottom: 17 },
  placeGlyph: { width: 46, height: 46, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(114,229,209,0.12)', borderWidth: 1, borderColor: 'rgba(114,229,209,0.19)' },
  placeGlyphText: { color: COLORS.cyan, fontSize: 27, lineHeight: 32 },
  placeHeadingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: COLORS.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.6, marginBottom: 4 },
  placeTitle: { color: COLORS.white, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  placeSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  refreshButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.panelRaised, alignItems: 'center', justifyContent: 'center' },
  refreshIcon: { color: COLORS.cyan, fontSize: 25, lineHeight: 28 },
  sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
  metaRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 13 },
  telemetryCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 11, marginTop: 8, marginBottom: 4, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  nightTelemetryCard: { backgroundColor: 'rgba(3,10,14,0.40)', borderColor: 'rgba(164,207,208,0.12)' },
  telemetryCopy: { flex: 1, minWidth: 0 },
  telemetryEyebrow: { color: '#7F989D', fontSize: 8, fontWeight: '900', letterSpacing: 1.15, marginBottom: 4 },
  telemetryStreet: { color: '#E9F1EF', fontSize: 12, fontWeight: '800' },
  nightTelemetryText: { color: '#F0F5F4' },
  telemetryArea: { color: '#A7B8BA', fontSize: 9, marginTop: 3 },
  telemetryCoordinates: { color: '#7F969A', fontSize: 8, fontVariant: ['tabular-nums'], marginTop: 5 },
  telemetryBadges: { alignItems: 'flex-end', gap: 6 },
  telemetryBadge: { minHeight: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, borderRadius: 8, borderWidth: 1 },
  telemetryBadgeLive: { backgroundColor: 'rgba(45,157,132,0.13)', borderColor: 'rgba(114,229,209,0.22)' },
  telemetryBadgeQuiet: { backgroundColor: 'rgba(224,166,95,0.10)', borderColor: 'rgba(224,166,95,0.20)' },
  telemetryBadgeText: { color: '#E5BF8A', fontSize: 7, fontWeight: '900', letterSpacing: 0.45 },
  telemetryBadgeLiveText: { color: COLORS.cyan },
  telemetrySourceBadge: { backgroundColor: 'rgba(255,255,255,0.045)', borderColor: 'rgba(255,255,255,0.08)' },
  telemetrySourceText: { color: '#A7B7B9', fontSize: 7, fontWeight: '800', letterSpacing: 0.4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaStatusDot: { width: 7, height: 7, borderRadius: 4 },
  metaText: { color: '#D5DFE0', fontSize: 11, fontWeight: '600' },
  metaSeparator: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.16)' },
  accuracyGlyph: { color: COLORS.cyan, fontSize: 15, fontWeight: '700' },
  expandedDetails: { paddingTop: 10 },
  detailsLabel: { color: '#81979D', fontSize: 9, fontWeight: '800', letterSpacing: 1.35, marginTop: 14 },
  featureHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 11 },
  featureCopy: { flex: 1, minWidth: 0 },
  featureDescription: { color: '#B7C5C7', fontSize: 10, lineHeight: 14, marginTop: 4 },
  trackingButton: { minWidth: 70, minHeight: 38, borderRadius: 13, backgroundColor: COLORS.cyan, alignItems: 'center', justifyContent: 'center' },
  stopTrackingButton: { backgroundColor: 'rgba(243, 169, 139, 0.13)', borderWidth: 1, borderColor: 'rgba(243, 169, 139, 0.38)' },
  trackingButtonText: { color: '#0D3132', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  stopTrackingText: { color: '#F2B39A' },
  featureMessage: { color: '#E8C99C', fontSize: 10, lineHeight: 15, paddingBottom: 9 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
  localLock: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(114,229,209,0.12)' },
  localLockText: { color: COLORS.cyan, fontSize: 19 },
  recentRouteList: { paddingBottom: 10 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 10 },
  routeGlyph: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(114,229,209,0.10)' },
  routeGlyphText: { color: COLORS.cyan, fontSize: 18 },
  routeTitle: { color: '#E6EEEC', fontSize: 10, fontWeight: '700' },
  routeSubtitle: { color: '#85999E', fontSize: 9, marginTop: 2 },
  coordinatesText: { color: '#E5ECEA', fontSize: 13, fontVariant: ['tabular-nums'], marginTop: 5 },
  errorText: { color: '#F0B5A7', fontSize: 11, lineHeight: 16, marginTop: 10 },
  retryPill: { position: 'absolute', bottom: 285, alignSelf: 'center', backgroundColor: '#182932', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  retryText: { color: '#F1C08C', fontSize: 9, fontWeight: '800', letterSpacing: 0.65 },
  mapAttribution: { position: 'absolute', left: 22, bottom: 278, color: 'rgba(25,45,47,0.68)', fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  mapPlaceholder: { ...StyleSheet.absoluteFill, overflow: 'hidden', backgroundColor: '#DEE7E1' },
  artwork: { ...StyleSheet.absoluteFill, backgroundColor: '#E3EBE4' },
  artworkGlow: { position: 'absolute', width: 350, height: 350, borderRadius: 180, left: '10%', top: '12%', backgroundColor: 'rgba(196, 218, 205, 0.55)' },
  road: { position: 'absolute', height: 17, backgroundColor: '#F8F8F2', borderColor: '#D7DFD7', borderTopWidth: 1, borderBottomWidth: 1 },
  roadOne: { width: '150%', top: '25%', left: '-20%', transform: [{ rotate: '19deg' }] },
  roadTwo: { width: '150%', top: '57%', left: '-20%', transform: [{ rotate: '-14deg' }] },
  roadThree: { width: '145%', top: '76%', left: '-20%', transform: [{ rotate: '31deg' }] },
  roadFour: { width: '100%', top: '48%', left: '12%', transform: [{ rotate: '74deg' }] },
  roadFive: { width: '105%', top: '47%', left: '-42%', transform: [{ rotate: '103deg' }] },
  roadSix: { width: '95%', top: '12%', left: '39%', transform: [{ rotate: '63deg' }] },
  park: { position: 'absolute', backgroundColor: '#C9DDC8', borderRadius: 28, borderWidth: 1, borderColor: 'rgba(100,151,114,0.14)' },
  parkOne: { width: 95, height: 120, top: '31%', left: '12%', transform: [{ rotate: '22deg' }] },
  parkTwo: { width: 118, height: 85, top: '66%', right: '8%', transform: [{ rotate: '-18deg' }] },
  diagnosticsScrim: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(3,12,17,0.76)' },
  searchModal: { flex: 1, backgroundColor: COLORS.ink, paddingHorizontal: 22, paddingTop: 20 },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  searchEyebrow: { color: COLORS.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  searchTitle: { color: COLORS.white, fontSize: 28, fontWeight: '700', letterSpacing: -0.6, marginTop: 5 },
  searchInputWrap: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, borderRadius: 18, backgroundColor: '#182833', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  searchInputGlyph: { color: COLORS.cyan, fontSize: 25 },
  searchInput: { flex: 1, color: COLORS.white, fontSize: 15, paddingVertical: 12 },
  clearQuery: { color: '#9FB1B5', fontSize: 24, padding: 4 },
  savedHeading: { color: '#91A4A8', fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginTop: 27, marginBottom: 10 },
  savedCount: { color: COLORS.cyan },
  destinationRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  destinationPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  destinationGlyph: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(114,229,209,0.10)', alignItems: 'center', justifyContent: 'center' },
  destinationGlyphText: { color: COLORS.cyan, fontSize: 23 },
  destinationRowTitle: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  demoRowBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(234, 183, 112, 0.15)', borderWidth: 1, borderColor: 'rgba(234, 183, 112, 0.26)' },
  demoRowBadgeText: { color: '#F4C991', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  destinationRowSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  destinationChevron: { color: '#71878D', fontSize: 26 },
  emptySaved: { color: '#A3B2B5', fontSize: 13, lineHeight: 20, marginTop: 18 },
  destinationPreview: { marginTop: 26, padding: 19, borderRadius: 22, backgroundColor: '#162731', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  destinationPreviewTitle: { color: COLORS.white, fontSize: 22, fontWeight: '700', marginTop: 9 },
  destinationPreviewSubtitle: { color: COLORS.muted, fontSize: 13, marginTop: 5 },
  destinationDistance: { color: COLORS.cyan, fontSize: 14, fontWeight: '700', marginTop: 20 },
  roadRouteSummary: { marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line },
  roadRouteEyebrow: { color: '#94A9AC', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 9 },
  roadRouteDistance: { color: COLORS.white, fontSize: 20, fontWeight: '800' },
  roadRouteDuration: { color: COLORS.cyan, fontSize: 12, marginTop: 4 },
  startGuidanceButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: COLORS.cyan, marginTop: 18 },
  startGuidanceText: { color: '#0C2D31', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  searchError: { color: '#F0B5A7', fontSize: 11, lineHeight: 16, marginTop: 12 },
  searchingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 18 },
  searchingText: { color: '#C6D2D2', fontSize: 12 },
  providerNotice: { padding: 14, marginTop: 17, borderRadius: 15, backgroundColor: 'rgba(114,229,209,0.08)', borderWidth: 1, borderColor: 'rgba(114,229,209,0.15)' },
  providerNoticeText: { color: '#B6C6C7', fontSize: 11, lineHeight: 17 },
  searchBottom: { marginTop: 'auto', paddingTop: 18, paddingBottom: 18 },
  localOnlyText: { color: '#86A0A1', textAlign: 'center', fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginBottom: 13 },
  saveCurrentButton: { minHeight: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cyan },
  saveCurrentDisabled: { opacity: 0.4 },
  saveCurrentText: { color: '#0C2D31', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  guidanceBanner: { position: 'absolute', top: 169, left: 16, right: 16, zIndex: 5, minHeight: 90, flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 24, backgroundColor: 'rgba(10,25,33,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', shadowColor: '#041016', shadowOpacity: 0.24, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  turnIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(114,229,209,0.14)', borderWidth: 1, borderColor: 'rgba(114,229,209,0.23)' },
  turnIconAlert: { backgroundColor: 'rgba(240,160,124,0.16)', borderColor: 'rgba(240,160,124,0.35)' },
  turnIconText: { color: COLORS.cyan, fontSize: 31, fontWeight: '700' },
  guidanceBannerCopy: { flex: 1, minWidth: 0 },
  guidanceDistance: { color: COLORS.cyan, fontSize: 9, fontWeight: '900', letterSpacing: 1.45 },
  guidanceInstruction: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginTop: 5, lineHeight: 21 },
  guidanceSheet: { position: 'absolute', zIndex: 5, left: 12, right: 12, bottom: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 17, borderRadius: 27, backgroundColor: 'rgba(13,29,38,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', shadowColor: '#030C11', shadowOpacity: 0.29, shadowRadius: 25, shadowOffset: { width: 0, height: 10 }, elevation: 14 },
  routeModeBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 13, borderRadius: 10, backgroundColor: 'rgba(29, 105, 95, 0.24)', borderWidth: 1, borderColor: 'rgba(114,229,209,0.21)' },
  routeModeSimulation: { backgroundColor: 'rgba(146, 99, 45, 0.24)', borderColor: 'rgba(255,199,128,0.30)' },
  routeModeCached: { backgroundColor: 'rgba(84, 104, 131, 0.25)', borderColor: 'rgba(175,199,232,0.27)' },
  routeModeText: { color: '#C5F3EA', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  gpsWarning: { padding: 13, marginBottom: 13, borderRadius: 15, backgroundColor: 'rgba(153, 94, 59, 0.19)', borderWidth: 1, borderColor: 'rgba(247, 181, 132, 0.24)' },
  gpsWarningTitle: { color: '#FFD0A8', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  gpsWarningText: { color: '#E5C9B5', fontSize: 10, lineHeight: 15, marginTop: 5 },
  gpsRetry: { alignSelf: 'flex-start', minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, marginTop: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  gpsRetryText: { color: '#FFE0C7', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  rerouteStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  rerouteDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#F2A17D' },
  rerouteStatusText: { color: '#F3B397', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, flex: 1 },
  guidanceSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  guidanceEta: { color: COLORS.white, fontSize: 25, fontWeight: '800', letterSpacing: -0.5 },
  guidanceMeta: { color: '#A8B8BA', fontSize: 11, marginTop: 3 },
  destinationMini: { maxWidth: '48%', alignItems: 'flex-end' },
  destinationMiniEyebrow: { color: '#7F969B', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  destinationMiniTitle: { color: '#E4ECEA', fontSize: 12, fontWeight: '700', marginTop: 5 },
  guidanceActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  rerouteButton: { minHeight: 42, paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.cyan },
  rerouteButtonText: { color: '#0C2D31', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  endGuidanceButton: { minHeight: 42, minWidth: 74, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  endGuidanceText: { color: '#D4E0E0', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  diagnosticsCard: { borderRadius: 25, paddingHorizontal: 20, paddingVertical: 20, backgroundColor: '#101E28', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  diagnosticsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  diagnosticsEyebrow: { color: COLORS.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  diagnosticsTitle: { color: COLORS.white, fontSize: 19, fontWeight: '700', marginTop: 5 },
  diagnosticsClose: { width: 38, height: 38, borderRadius: 13, backgroundColor: COLORS.panelRaised, alignItems: 'center', justifyContent: 'center' },
  diagnosticsCloseText: { color: COLORS.white, fontSize: 25, lineHeight: 28 },
  diagnosticRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, paddingVertical: 11 },
  diagnosticLabel: { color: '#879CA2', textTransform: 'uppercase', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  diagnosticValue: { color: '#EDF3F2', fontSize: 12, marginTop: 5 },
});
