import { useCallback, useEffect, useState } from 'react';

import { getLocalSetting, setLocalSetting } from '../offline/offlineStore';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type SpeedUnit = 'kmh' | 'mph';

const DEFAULTS = { voiceEnabled: true, theme: 'auto' as ThemePreference, speedUnit: 'kmh' as SpeedUnit, speedLimitKmh: 80 };

export function useNavPreferences() {
  const [voiceEnabled, setVoiceEnabledState] = useState(DEFAULTS.voiceEnabled);
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULTS.theme);
  const [speedUnit, setSpeedUnitState] = useState<SpeedUnit>(DEFAULTS.speedUnit);
  const [speedLimitKmh, setSpeedLimitState] = useState(DEFAULTS.speedLimitKmh);
  const [clock, setClock] = useState(() => Date.now());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getLocalSetting('voice_enabled', DEFAULTS.voiceEnabled),
      getLocalSetting('theme_preference', DEFAULTS.theme),
      getLocalSetting('speed_unit', DEFAULTS.speedUnit),
      getLocalSetting('speed_limit_kmh', DEFAULTS.speedLimitKmh),
    ]).then(([voice, themeValue, unit, limit]) => {
      if (!active) return;
      setVoiceEnabledState(voice);
      setThemeState(themeValue === 'light' || themeValue === 'dark' ? themeValue : 'auto');
      setSpeedUnitState(unit === 'mph' ? 'mph' : 'kmh');
      setSpeedLimitState(Number.isFinite(limit) ? Math.max(20, Math.min(160, limit)) : DEFAULTS.speedLimitKmh);
      setReady(true);
    }).catch(() => { if (active) setReady(true); });
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const setVoiceEnabled = useCallback((value: boolean) => {
    setVoiceEnabledState(value);
    void setLocalSetting('voice_enabled', value).catch(() => undefined);
  }, []);
  const setTheme = useCallback((value: ThemePreference) => {
    setThemeState(value);
    void setLocalSetting('theme_preference', value).catch(() => undefined);
  }, []);
  const setSpeedUnit = useCallback((value: SpeedUnit) => {
    setSpeedUnitState(value);
    void setLocalSetting('speed_unit', value).catch(() => undefined);
  }, []);
  const setSpeedLimitKmh = useCallback((value: number) => {
    const safeValue = Math.max(20, Math.min(160, Math.round(value / 5) * 5));
    setSpeedLimitState(safeValue);
    void setLocalSetting('speed_limit_kmh', safeValue).catch(() => undefined);
  }, []);

  const hour = new Date(clock).getHours();
  const isNight = theme === 'dark' || (theme === 'auto' && (hour >= 19 || hour < 6));
  return { ready, voiceEnabled, setVoiceEnabled, theme, setTheme, isNight, speedUnit, setSpeedUnit, speedLimitKmh, setSpeedLimitKmh };
}
