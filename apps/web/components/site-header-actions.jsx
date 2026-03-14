"use client";

import { createContext, useContext, useMemo, useState } from "react";

const SiteHeaderActionsContext = createContext(null);

export function SiteHeaderActionsProvider({ children }) {
  const [actions, setActions] = useState(null);
  const [titleContent, setTitleContent] = useState(null);
  const value = useMemo(
    () => ({ actions, setActions, titleContent, setTitleContent }),
    [actions, titleContent]
  );
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
