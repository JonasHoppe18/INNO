// Pure queue semantics — no React, no I/O. The UI consumes these decisions.
// Status vocabulary comes from status-model.js; keep the two in sync.
import { normalizeLifecycleStatus } from "./status-model.js";

export function getLifecycleStatus(thread) {
  return normalizeLifecycleStatus(thread?.status);
}

export function threadTab(thread) {
  if (thread?.close_pending === true) return "needs_attention";
  const status = getLifecycleStatus(thread);
  if (status === "waiting_customer" || status === "waiting_third_party") return "waiting";
  if (status === "resolved") return "resolved";
  if (status === "blocked") return "blocked";
  return "needs_attention";
}

export function isAutomated(thread) {
  return String(thread?.classification_key || "").trim().toLowerCase() === "notification";
}

export function resolveInboxSlug(thread, knownSlugs) {
  const tags = Array.isArray(thread?.tags) ? thread.tags : [];
  const hit = tags.find((tag) => String(tag || "").startsWith("inbox:"));
  if (!hit) return null;
  const slug = String(hit).slice("inbox:".length).trim();
  if (!slug) return null;
  return Array.isArray(knownSlugs) && knownSlugs.includes(slug) ? slug : null;
}

const REASON_LABELS = {
  customer_replied: "Customer replied",
  new: "New",
  wake_timer: "Woke up",
  approve_close: "Approve close",
};

export function deriveReason(thread) {
  const stored = String(thread?.attention_reason || "").trim();
  if (REASON_LABELS[stored]) return { key: stored, label: REASON_LABELS[stored] };
  if (stored) return null;
  if (Number(thread?.unread_count ?? 0) > 0) return { key: "new", label: REASON_LABELS.new };
  return null;
}

function waitTimestamp(thread) {
  const inbound = Date.parse(thread?.customer_last_inbound_at || "");
  if (!Number.isNaN(inbound)) return inbound;
  const last = Date.parse(thread?.last_message_at || "");
  if (!Number.isNaN(last)) return last;
  return Number.POSITIVE_INFINITY;
}

export function queueCompare(a, b) {
  return waitTimestamp(a) - waitTimestamp(b);
}

export function sortForQueue(threads) {
  return [...(threads || [])].sort(queueCompare);
}

export function waitingGroup(thread) {
  return String(thread?.waiting_reason || "").trim() === "third_party" ? "third_party" : "customer";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function wakeInDays(thread, nowMs) {
  const wake = Date.parse(thread?.wake_at || "");
  if (Number.isNaN(wake)) return null;
  return Math.max(0, Math.ceil((wake - nowMs) / DAY_MS));
}

// Legacy `?view=` values still linked from older bookmarks/emails map onto
// the new lifecycle-view vocabulary. Anything unrecognized (including "",
// the omitted-default) passes through unchanged — callers decide what the
// empty string means (needs_attention default).
const LEGACY_VIEW_ALIASES = {
  resolved: "resolved",
  notifications: "automated",
};

const VALID_TABS = new Set(["needs_attention", "waiting", "resolved"]);

// Normalizes the raw `view`/`tab` URL params into the canonical scheme:
// "" | "needs_attention" | "mine" | "waiting" | "resolved" | "automated" |
// "all" | "inbox:<slug>", plus a tab within inbox views. Pure — no React,
// no I/O — so the legacy-alias mapping can be unit-tested directly.
export function resolveViewRoute(rawView, rawTab) {
  const view = String(rawView || "").trim();
  const mappedView = LEGACY_VIEW_ALIASES[view] || view;
  const tab = String(rawTab || "").trim();
  return {
    view: mappedView,
    tab: VALID_TABS.has(tab) ? tab : "needs_attention",
  };
}
