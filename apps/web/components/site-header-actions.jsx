"use client";

import { createContext, useContext, useMemo, useState } from "react";

const SiteHeaderActionsContext = createContext(null);

export function SiteHeaderActionsProvider({ children }) {
  const [actions, setActions] = useState(null);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return (
    <SiteHeaderActionsContext.Provider value={value}>
      {children}
    </SiteHeaderActionsContext.Provider>
  );
}

export function useSiteHeaderActions() {
  const ctx = useContext(SiteHeaderActionsContext);
  if (!ctx) {
    throw new Error("useSiteHeaderActions must be used within SiteHeaderActionsProvider.");
  }
  return ctx;
}
