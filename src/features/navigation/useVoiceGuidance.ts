import * as Speech from 'expo-speech';
import { useEffect, useRef } from 'react';

import type { RoutePlan } from '../routing/routingTypes';
import type { getGuidanceSnapshot } from '../routing/routeGeometry';

function cleanInstruction(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[.;,]+$/, '').trim();
}

export function useVoiceGuidance(
  active: boolean,
  fresh: boolean,
  enabled: boolean,
  route: RoutePlan | null,
  guidance: ReturnType<typeof getGuidanceSnapshot> | null,
  ready: boolean,
) {
  const spokenMilestones = useRef(new Set<string>());
  const previousRouteId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !active || !route) void Speech.stop().catch(() => undefined);
  }, [active, enabled, route?.id]);

  useEffect(() => {
    if (previousRouteId.current !== route?.id) {
      previousRouteId.current = route?.id ?? null;
      spokenMilestones.current.clear();
      void Speech.stop().catch(() => undefined);
    }
    if (!ready || !active || !fresh || !enabled || !route || !guidance) return;

    const maneuver = guidance.nextManeuver;
    if (!maneuver && guidance.remainingMeters <= 25) {
      const arrivalKey = `${route.id}:arrival`;
      if (spokenMilestones.current.has(arrivalKey)) return;
      spokenMilestones.current.add(arrivalKey);
      Speech.speak(`You have arrived at ${route.destination.title}.`, { rate: 0.96, pitch: 1 });
      return;
    }
    if (!maneuver || guidance.distanceToNextManeuver === null) return;

    const distance = guidance.distanceToNextManeuver;
    const milestone = distance <= 40 ? 'now' : distance <= 220 ? 'approach' : null;
    if (!milestone) return;
    const maneuverKey = `${route.id}:${maneuver.coordinate.latitude.toFixed(5)}:${maneuver.coordinate.longitude.toFixed(5)}`;
    const key = `${maneuverKey}:${milestone}`;
    if (spokenMilestones.current.has(key)) return;
    spokenMilestones.current.add(key);

    const instruction = cleanInstruction(maneuver.instruction);
    const phrase = milestone === 'approach'
      ? maneuver.kind === 'arrive'
        ? `In ${Math.round(distance / 10) * 10} meters, arrive at ${route.destination.title}.`
        : `In ${Math.round(distance / 10) * 10} meters, ${instruction}.`
      : maneuver.kind === 'arrive'
        ? `Arriving at ${route.destination.title}.`
        : `${instruction} now.`;
    Speech.speak(route.mode === 'simulation' ? `Practice route. ${phrase}` : phrase, { rate: 0.96, pitch: 1 });
  }, [active, enabled, fresh, guidance, ready, route]);
}
