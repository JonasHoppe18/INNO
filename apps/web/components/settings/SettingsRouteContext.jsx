"use client";

import { createContext, useContext, useEffect } from "react";

export const SettingsRouteContext = createContext(null);

export function useSettingsRoute() {
  const value = useContext(SettingsRouteContext);
  if (!value) throw new Error("useSettingsRoute must be used inside SettingsWorkspace.");
  return value;
}

// Sections report unsaved changes so navigation can ask before discarding them.
export function useSettingsDirty(isDirty) {
  const { setDirty } = useSettingsRoute();
  useEffect(() => {
    setDirty(Boolean(isDirty));
    return () => setDirty(false);
  }, [setDirty, isDirty]);
}
