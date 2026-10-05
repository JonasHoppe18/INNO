"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import { tokenMatchesScope } from "@/lib/client/token-scope";
import { scopedReadCache } from "@/lib/client/scoped-read-cache";

export function useScopedReadResource() {
  const { isLoaded, userId, sessionId, orgId, getToken } = useAuth();
  const scopeKey = isLoaded && userId && sessionId
    ? JSON.stringify([userId, sessionId, orgId || null])
    : null;
  const getCached = useCallback((url) => scopedReadCache.get(scopeKey, url), [scopeKey]);
  const readResponse = useCallback(async (url, options = {}) => {
    if (!url.startsWith("/api/") || new URL(url, window.location.origin).origin !== window.location.origin) {
      throw new Error("Read resource must be a local API.");
    }
    const identity = { userId, sessionId, orgId: orgId || null };
    let token = await getToken({ organizationId: orgId || undefined });
    if (!tokenMatchesScope(token, identity)) {
      token = await getToken({ organizationId: orgId || undefined, skipCache: true });
    }
    if (!tokenMatchesScope(token, identity)) {
      const error = new Error("Workspace changed while loading data.");
      error.name = "AbortError";
      throw error;
    }
    return fetch(url, {
      ...options, method: "GET", credentials: "include", cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [getToken, orgId, userId, sessionId]);
  const readJson = useCallback((url, { force = false } = {}) =>
    scopedReadCache.load(scopeKey, url, async (signal) => {
      const response = await readResponse(url, { signal });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload?.error || "Could not load data.");
        error.status = response.status;
        throw error;
      }
      return payload;
    }, { force }), [scopeKey, readResponse]);
  const invalidate = useCallback((url) => scopedReadCache.invalidate(scopeKey, url), [scopeKey]);
  return { scopeKey, ready: Boolean(scopeKey), getCached, readJson, readResponse, invalidate };
}
