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

// Pure formatting helper for the queue row meta line — turns an assignee
// display name/email into 1-2 uppercase initials. No React, no I/O.
export function assigneeInitials(label) {
  const base = String(label || "").trim();
  if (!base) return null;
  const parts = base
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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

export function waitTimestamp(thread) {
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

// Compact "how long has the customer been waiting" fallback, shown in the
// reason slot whenever deriveReason() has nothing to say (no stored
// attention_reason and the thread is already read) — replaces an empty gap
// with the single most useful piece of information a queue row can carry:
// how old this wait actually is, matching the queue's own sort key
// (waitTimestamp, the same function queueCompare uses).
//
// Days are shown out to 90 (not the usual 30) specifically so that threads a
// few weeks apart don't collapse into the same "Nmo" bucket and read as
// identical/stale-looking in a list — exact day counts stay distinguishable
// for the entire range legacy/abandoned threads actually fall into.
export function formatWaitAge(thread, nowMs) {
  const ts = waitTimestamp(thread);
  if (!Number.isFinite(ts)) return null;
  const diffMs = Math.max(0, nowMs - ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  const dayTierLimit = 90 * day;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < dayTierLimit) return `${Math.floor(diffMs / day)}d`;
  if (diffMs < year) return `${Math.floor(diffMs / month)}mo`;
  return `${Math.floor(diffMs / year)}y`;
}

// Pure formatting helper for the Waiting-tab wake countdown. Mirrors the
// wording contract in the Task 8 brief: null (unset/invalid wake_at) renders
// nothing, 0 is "wakes today", N is "wakes in N days" (singular "day" for 1).
export function formatWakeCountdown(days) {
  if (days === null || days === undefined) return null;
  if (days === 0) return "wakes today";
  return `wakes in ${days} day${days === 1 ? "" : "s"}`;
}

const WAITING_GROUP_DEFS = [
  { key: "customer", label: "Waiting on customer" },
  { key: "third_party", label: "Waiting on third party" },
];

// Partitions an already-scoped (Waiting tab) thread list into the two
// waiting-reason groups, preserving each thread's relative order. A group is
// included only when it has at least one thread — so if every thread is
// "customer" (e.g. pre-migration data with no waiting_reason column), only
// that one group/header renders; "third_party" simply doesn't appear.
export function groupWaitingThreads(threads) {
  const buckets = { customer: [], third_party: [] };
  (threads || []).forEach((thread) => {
    buckets[waitingGroup(thread)].push(thread);
  });
  const nonEmpty = WAITING_GROUP_DEFS.filter((def) => buckets[def.key].length > 0);
  return nonEmpty.map((def) => ({
    key: def.key,
    label: def.label,
    threads: buckets[def.key],
  }));
}

// Task 9, Plan 2: partitions an already-scoped (needs-attention tab) thread
// list into the default group and a trailing "Approve close" group for
// threads the auto-close tick flagged (close_pending === true). Mirrors
// groupWaitingThreads' shape/omit-when-empty semantics above, except the
// default group's label is null (TicketList only renders a header row for
// groups with a non-null label, so the primary needs-attention list keeps
// its current no-header look; only the new bottom group gets a header).
// filteredThreads already stably sorts close_pending threads to the bottom
// (Task 6's needsAttentionQueue in InboxSplitView.jsx), so this partition
// does no re-sorting of its own — it only splits, preserving order.
export function groupNeedsAttentionThreads(threads) {
  const list = threads || [];
  const defaultThreads = list.filter((thread) => thread?.close_pending !== true);
  const approveCloseThreads = list.filter((thread) => thread?.close_pending === true);
  const groups = [];
  if (defaultThreads.length) {
    groups.push({ key: "default", label: null, threads: defaultThreads });
  }
  if (approveCloseThreads.length) {
    groups.push({ key: "approve_close", label: "Approve close", threads: approveCloseThreads });
  }
  return groups;
}

function isUnreadThread(thread) {
  return Number(thread?.unread_count ?? 0) > 0;
}

// Sidebar badge counts, unread-only across every bucket — a bucket with 20
// threads but 0 unread reads as 0, never the total sitting in it. mineIds:
// set of assignee ids counted as "assigned to me" (still scoped to the
// needs_attention bucket, matching the existing "mine" view). knownInboxSlugs:
// custom inbox slugs to tally separately, each defaulting to 0 so a slug with
// no unread threads still appears in the result (callers render every known
// inbox, not just ones with matches).
export function computeSidebarCounts(threads, { mineIds, knownInboxSlugs } = {}) {
  const ids = mineIds instanceof Set ? mineIds : new Set(mineIds || []);
  const slugs = Array.isArray(knownInboxSlugs) ? knownInboxSlugs : [];
  const counts = {
    needsAttentionCount: 0,
    mineCount: 0,
    waitingCustomerCount: 0,
    waitingThirdPartyCount: 0,
    notificationsCount: 0,
    inboxUnreadCounts: {},
  };
  for (const slug of slugs) counts.inboxUnreadCounts[slug] = 0;
  (threads || []).forEach((thread) => {
    if (!isUnreadThread(thread)) return;
    if (isAutomated(thread)) {
      counts.notificationsCount += 1;
      return;
    }
    const tabKey = threadTab(thread);
    if (tabKey === "needs_attention") {
      counts.needsAttentionCount += 1;
      const assignee = String(thread?.assignee_id ?? "");
      if (assignee && ids.has(assignee)) counts.mineCount += 1;
      const slug = resolveInboxSlug(thread, slugs);
      if (slug) counts.inboxUnreadCounts[slug] += 1;
    } else if (tabKey === "waiting") {
      if (waitingGroup(thread) === "third_party") {
        counts.waitingThirdPartyCount += 1;
      } else {
        counts.waitingCustomerCount += 1;
      }
    }
  });
  return counts;
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
