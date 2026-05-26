"use client";

const ALLOWED_EVENTS = new Set([
  "ticket_switch_started",
  "ticket_switch_completed",
  "thread_detail_loaded",
  "draft_saved",
  "send_completed",
  "frontend_error",
]);

function sanitizePayload(payload = {}) {
  const event = String(payload?.event || "").trim();
  if (!ALLOWED_EVENTS.has(event)) return null;
  const durationMs = Number(payload?.durationMs);
  return {
    event,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : undefined,
    threadId: payload?.threadId ? String(payload.threadId).slice(0, 120) : undefined,
    status: payload?.status ? String(payload.status).slice(0, 80) : undefined,
    errorCode: payload?.errorCode ? String(payload.errorCode).slice(0, 120) : undefined,
    timestamp: payload?.timestamp || new Date().toISOString(),
  };
}

export function reportClientEvent(payload) {
  if (typeof window === "undefined") return;
  const body = sanitizePayload(payload);
  if (!body) return;
  const json = JSON.stringify(body);
  const url = "/api/client-events";
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([json], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
    keepalive: true,
  }).catch(() => null);
}
