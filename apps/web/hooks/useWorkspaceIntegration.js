"use client";

import { useCallback, useEffect, useState } from "react";

export function useWorkspaceIntegration(provider) {
  const [integration, setIntegration] = useState(null);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    if (!provider) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/integrations/status?provider=${encodeURIComponent(provider)}`,
        { cache: "no-store", credentials: "include" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not load integration status.");
      setIntegration(payload?.integration || null);
      setShop(payload?.shop || null);
    } catch (_error) {
      setIntegration(null);
      setShop(null);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return { integration, shop, loading, loadStatus };
}
