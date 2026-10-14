import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';

import { refreshBackgroundTrackingPowerProfile } from './backgroundTracking';

export function useBatteryAwareTracking(isTracking: boolean) {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [lowPowerMode, setLowPowerMode] = useState(false);
  const [isLowBattery, setIsLowBattery] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Battery.getPowerStateAsync().then((power) => {
        if (!active) return;
        const lowBattery = power.batteryLevel >= 0 && power.batteryLevel <= 0.2
          && power.batteryState === Battery.BatteryState.UNPLUGGED;
        setBatteryLevel(power.batteryLevel >= 0 ? power.batteryLevel : null);
        setLowPowerMode(power.lowPowerMode);
        setIsLowBattery(lowBattery || power.lowPowerMode);
        if (isTracking) void refreshBackgroundTrackingPowerProfile().catch(() => undefined);
      }).catch(() => undefined);
    };
    refresh();
    const level = Battery.addBatteryLevelListener(refresh);
    const powerMode = Battery.addLowPowerModeListener(refresh);
    const state = Battery.addBatteryStateListener(refresh);
    return () => {
      active = false;
      level.remove();
      powerMode.remove();
      state.remove();
    };
  }, [isTracking]);

  return { batteryLevel, lowPowerMode, isLowBattery };
}
