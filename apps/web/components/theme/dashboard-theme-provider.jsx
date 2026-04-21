"use client";

import { useEffect } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { DEFAULT_THEME, normalizeThemePreference } from "@/lib/theme-options";

function DashboardThemeSync() {
  const { setTheme } = useTheme();

  useEffect(() => {
    let isActive = true;

    const syncThemeFromServer = async () => {
      try {
        const response = await fetch("/api/settings/theme", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        const nextTheme = normalizeThemePreference(payload?.theme_preference, DEFAULT_THEME);
        if (!isActive) return;
        setTheme(nextTheme);
      } catch {
        // Keep local theme fallback when request fails.
      }
    };

    syncThemeFromServer().catch(() => null);

    return () => {
      isActive = false;
    };
  }, [setTheme]);

  return null;
}

export function DashboardThemeProvider({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      enableSystem={false}
      defaultTheme={DEFAULT_THEME}
      storageKey="sona-dashboard-theme"
    >
      <DashboardThemeSync />
      {children}
    </ThemeProvider>
  );
}
