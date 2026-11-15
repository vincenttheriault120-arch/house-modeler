import { useEffect, useState } from 'react';
import type { ViewSettings } from './model/types';

const KEY = 'house-modeler:view-settings';

const DEFAULTS: ViewSettings = { units: 'imperial', gridSpacing: 304.8 };

function load(): ViewSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return DEFAULTS;
}

/** View settings (units, grid) remembered in this browser. */
export function useViewSettings() {
  const [settings, setSettings] = useState<ViewSettings>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Ignore: settings just won't be remembered.
    }
  }, [settings]);
  return [settings, setSettings] as const;
}
