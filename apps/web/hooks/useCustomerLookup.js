import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const normalizeOrderNumber = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed;
};

const buildKey = ({ email, orderNumber, threadId, sourceMessageId }) => {
  const parts = [];
  const normalizedEmail = normalizeEmail(email);
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  if (normalizedOrder) parts.push(`order:${normalizedOrder}`);
  if (normalizedEmail) parts.push(`email:${normalizedEmail}`);
  if (threadId) parts.push(`thread:${threadId}`);
  if (sourceMessageId) parts.push(`message:${sourceMessageId}`);
  return parts.join("|");
};

// Module-level response cache. Survives component remounts so re-renders
// of the same ticket context skip the route round-trip entirely. Same
// customer across different threads still POSTs (different threadId in
// key), but the server's previousTicketsCache makes those fast.
const CUSTOMER_LOOKUP_TTL_MS = 60_000;
const customerLookupCache = new Map();

export function invalidateCustomerLookupForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const needle = `email:${normalized}`;
  for (const key of customerLookupCache.keys()) {
    if (key.includes(needle)) {
      customerLookupCache.delete(key);
    }
  }
}

export function useCustomerLookup({
  email,
  orderNumber,
  subject,
  threadId,
  sourceMessageId,
  enabled = false,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = useMemo(
    () => buildKey({ email, orderNumber, threadId, sourceMessageId }),
    [email, orderNumber, sourceMessageId, threadId]
  );
  const lastKeyRef = useRef("");

  const fetchLookup = useCallback(
    async (forceRefresh = false) => {
      if (!enabled) return;
      if (!email && !orderNumber && !sourceMessageId) {
        setData(null);
        setError(null);
        return;
      }
      if (!forceRefresh && key && lastKeyRef.current === key) {
        return;
      }
      if (!forceRefresh && key) {
        const cached = customerLookupCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < CUSTOMER_LOOKUP_TTL_MS) {
          setData(cached.data ?? null);
          setError(null);
          lastKeyRef.current = key;
          setLoading(false);
          return;
        }
      }
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/inbox/customer-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            orderNumber,
            subject,
            threadId,
            sourceMessageId,
            forceRefresh,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not fetch customer.");
        }
        setData(payload ?? null);
        lastKeyRef.current = key;
        if (key) {
          customerLookupCache.set(key, {
            data: payload ?? null,
            fetchedAt: Date.now(),
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error."));
      } finally {
        setLoading(false);
      }
    },
    [email, enabled, key, orderNumber, sourceMessageId, subject, threadId]
  );

  useEffect(() => {
    if (!enabled) return;
    fetchLookup(false);
  }, [enabled, key, fetchLookup]);

  useEffect(() => {
    if (!key || key === lastKeyRef.current) return;
    setData(null);
    setError(null);
  }, [key]);

  return {
    data,
    loading,
    error,
    refresh: () => fetchLookup(true),
  };
}
