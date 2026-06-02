"use client";

import { useEffect } from "react";
import { useSiteHeaderActions } from "@/components/site-header-actions";

export function PlaygroundPageHeader() {
  const { setActions } = useSiteHeaderActions();

  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  return null;
}
