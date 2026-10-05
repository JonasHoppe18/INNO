"use client";

import { useCallback, useEffect, useState } from "react";
import { useScopedReadResource } from "@/hooks/useScopedReadResource";

const STATUS_URL = "/api/integrations/status";

export function useWorkspaceIntegration(provider) {
  const { scopeKey, ready, getCached, readJson } = useScopedReadResource();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(() => !getCached(STATUS_URL));
  const payload = snapshot?.scopeKey === scopeKey ? snapshot.payload : getCached(STATUS_URL);

  // Initial cards share one all-provider read. Explicit connection refreshes
  // bypass the short-lived snapshot after a mutation/OAuth return.
  const loadStatus = useCallback(async (force = true) => {
    if (!provider || !ready) return;
    setLoading(!getCached(STATUS_URL) || Boolean(force));
    try {
      const next = await readJson(STATUS_URL, { force: Boolean(force) });
      setSnapshot({ scopeKey, payload: next });
    } catch (_error) {
      setSnapshot({ scopeKey, payload: null });
    } finally {
      setLoading(false);
    }
  }, [provider, ready, scopeKey, getCached, readJson]);

  useEffect(() => { loadStatus(false); }, [loadStatus]);

  return {
    integration: (payload?.integrations || []).find(row => String(row.provider || "").toLowerCase() === provider) || null,
    shop: provider === "shopify" ? payload?.shop || null : null,
    loading: !ready || loading || (!payload && snapshot?.scopeKey !== scopeKey),
    loadStatus,
  };
}
