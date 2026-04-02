"use client";

import { useEffect } from "react";
import { useSiteHeaderActions } from "@/components/site-header-actions";

export function FineTuningPageHeader() {
  const { setActions } = useSiteHeaderActions();

  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  return null;
}
