import { describe, it, expect } from "vitest";
import {
  getLifecycleStatus,
  threadTab,
  isAutomated,
  resolveInboxSlug,
  deriveReason,
  assigneeInitials,
  queueCompare,
  waitingGroup,
  wakeInDays,
  formatWakeCountdown,
  formatWaitAge,
  groupWaitingThreads,
  groupNeedsAttentionThreads,
  sortForQueue,
  resolveViewRoute,
  computeSidebarCounts,
} from "../view-model.js";

const base = { id: "t1", status: "needs_attention", tags: [], unread_count: 0 };

describe("getLifecycleStatus", () => {
  it("normalizes legacy values", () => {
    expect(getLifecycleStatus({ ...base, status: "Open" })).toBe("needs_attention");
    expect(getLifecycleStatus({ ...base, status: "pending" })).toBe("waiting_customer");
    expect(getLifecycleStatus({ ...base, status: "Solved" })).toBe("resolved");
  });
  it("passes canonical values through", () => {
    expect(getLifecycleStatus({ ...base, status: "waiting_third_party" })).toBe("waiting_third_party");
  });
});

describe("threadTab", () => {
  it("maps lifecycle statuses to tabs", () => {
    expect(threadTab({ ...base, status: "needs_attention" })).toBe("needs_attention");
    expect(threadTab({ ...base, status: "waiting_customer" })).toBe("waiting");
    expect(threadTab({ ...base, status: "waiting_third_party" })).toBe("waiting");
    expect(threadTab({ ...base, status: "resolved" })).toBe("resolved");
    expect(threadTab({ ...base, status: "blocked" })).toBe("blocked");
  });
  it("close_pending forces needs_attention even while waiting", () => {
    expect(threadTab({ ...base, status: "waiting_customer", close_pending: true })).toBe("needs_attention");
  });
  it("maps legacy values through normalization", () => {
    expect(threadTab({ ...base, status: "open" })).toBe("needs_attention");
    expect(threadTab({ ...base, status: "waiting" })).toBe("waiting");
  });
});

describe("isAutomated", () => {
  it("flags notification-classified threads", () => {
    expect(isAutomated({ ...base, classification_key: "notification" })).toBe(true);
    expect(isAutomated({ ...base, classification_key: "support" })).toBe(false);
    expect(isAutomated(base)).toBe(false);
  });
  it("normalizes case and whitespace before comparing", () => {
    expect(isAutomated({ ...base, classification_key: "Notification" })).toBe(true);
    expect(isAutomated({ ...base, classification_key: "  notification  " })).toBe(true);
    expect(isAutomated({ ...base, classification_key: "NOTIFICATION" })).toBe(true);
  });
});

describe("resolveInboxSlug", () => {
  it("returns the slug when the inbox exists", () => {
    expect(resolveInboxSlug({ ...base, tags: ["inbox:returns", "vip"] }, ["returns"])).toBe("returns");
  });
  it("falls back to null for a stale/deleted inbox", () => {
    expect(resolveInboxSlug({ ...base, tags: ["inbox:deleted-inbox"] }, ["returns"])).toBe(null);
  });
  it("handles no inbox tag and bad tags input", () => {
    expect(resolveInboxSlug({ ...base, tags: ["vip"] }, ["returns"])).toBe(null);
    expect(resolveInboxSlug({ ...base, tags: null }, ["returns"])).toBe(null);
  });
});

describe("deriveReason", () => {
  it("uses stored attention_reason", () => {
    expect(deriveReason({ ...base, attention_reason: "customer_replied" })).toEqual({
      key: "customer_replied",
      label: "Customer replied",
    });
    expect(deriveReason({ ...base, attention_reason: "new" })).toEqual({ key: "new", label: "New" });
    expect(deriveReason({ ...base, attention_reason: "wake_timer" })).toEqual({ key: "wake_timer", label: "Woke up" });
    expect(deriveReason({ ...base, attention_reason: "approve_close" })).toEqual({ key: "approve_close", label: "Approve close" });
  });
  it("falls back to New for unread threads with no stored reason", () => {
    expect(deriveReason({ ...base, attention_reason: null, unread_count: 2 })).toEqual({ key: "new", label: "New" });
  });
  it("returns null when nothing applies", () => {
    expect(deriveReason({ ...base, attention_reason: null, unread_count: 0 })).toBe(null);
    expect(deriveReason({ ...base, attention_reason: "garbage" })).toBe(null);
  });
});

describe("assigneeInitials", () => {
  it("builds initials from first + last name", () => {
    expect(assigneeInitials("Jane Doe")).toBe("JD");
  });
  it("uses the first two characters for a single-word name", () => {
    expect(assigneeInitials("Cher")).toBe("CH");
  });
  it("takes first + last of multi-word names", () => {
    expect(assigneeInitials("Mary Jane Watson")).toBe("MW");
  });
  it("returns null for empty/missing input", () => {
    expect(assigneeInitials("")).toBe(null);
    expect(assigneeInitials(null)).toBe(null);
    expect(assigneeInitials(undefined)).toBe(null);
  });
  it("strips punctuation before computing initials", () => {
    expect(assigneeInitials("o'brien, sean")).toBe("OS");
  });
});

describe("queueCompare + sortForQueue", () => {
  const at = (iso) => ({ ...base, customer_last_inbound_at: iso });
  it("puts the oldest customer wait first", () => {
    const older = at("2026-07-01T10:00:00Z");
    const newer = at("2026-07-03T10:00:00Z");
    expect(queueCompare(older, newer)).toBeLessThan(0);
    expect(sortForQueue([newer, older])[0]).toBe(older);
  });
  it("falls back to last_message_at when customer_last_inbound_at is missing", () => {
    const noInbound = { ...base, customer_last_inbound_at: null, last_message_at: "2026-07-01T10:00:00Z" };
    const withInbound = at("2026-07-02T10:00:00Z");
    expect(queueCompare(noInbound, withInbound)).toBeLessThan(0);
  });
  it("treats fully missing timestamps as newest (last)", () => {
    const nothing = { ...base, customer_last_inbound_at: null, last_message_at: null };
    const real = at("2026-07-01T10:00:00Z");
    expect(sortForQueue([nothing, real])[0]).toBe(real);
  });
  it("does not mutate the input array", () => {
    const arr = [at("2026-07-03T10:00:00Z"), at("2026-07-01T10:00:00Z")];
    const copy = [...arr];
    sortForQueue(arr);
    expect(arr).toEqual(copy);
  });
});

describe("waitingGroup", () => {
  it("groups by waiting_reason with customer as the default", () => {
    expect(waitingGroup({ ...base, waiting_reason: "third_party" })).toBe("third_party");
    expect(waitingGroup({ ...base, waiting_reason: "customer" })).toBe("customer");
    expect(waitingGroup({ ...base, waiting_reason: null })).toBe("customer");
    expect(waitingGroup(base)).toBe("customer");
  });
});

describe("wakeInDays", () => {
  const NOW = Date.parse("2026-07-03T12:00:00Z");
  it("computes whole days until wake_at", () => {
    expect(wakeInDays({ ...base, wake_at: "2026-07-08T12:00:00Z" }, NOW)).toBe(5);
  });
  it("clamps past-due to 0", () => {
    expect(wakeInDays({ ...base, wake_at: "2026-07-01T12:00:00Z" }, NOW)).toBe(0);
  });
  it("returns null for missing or invalid wake_at", () => {
    expect(wakeInDays(base, NOW)).toBe(null);
    expect(wakeInDays({ ...base, wake_at: "garbage" }, NOW)).toBe(null);
  });
});

describe("formatWaitAge", () => {
  const NOW = Date.parse("2026-07-03T12:00:00Z");
  it("uses customer_last_inbound_at, falling back to last_message_at", () => {
    expect(
      formatWaitAge({ ...base, customer_last_inbound_at: "2026-07-03T09:00:00Z" }, NOW),
    ).toBe("3h");
    expect(
      formatWaitAge(
        { ...base, customer_last_inbound_at: null, last_message_at: "2026-07-03T09:00:00Z" },
        NOW,
      ),
    ).toBe("3h");
  });
  it("formats minutes, hours, and days at their tiers", () => {
    expect(formatWaitAge({ ...base, last_message_at: "2026-07-03T11:45:00Z" }, NOW)).toBe("15m");
    expect(formatWaitAge({ ...base, last_message_at: "2026-07-03T03:00:00Z" }, NOW)).toBe("9h");
    expect(formatWaitAge({ ...base, last_message_at: "2026-06-28T12:00:00Z" }, NOW)).toBe("5d");
  });
  it("keeps showing exact days out to 90 days, so nearby-but-distinct dates stay distinguishable", () => {
    const sixtyDaysAgo = new Date(NOW - 60 * 24 * 60 * 60 * 1000).toISOString();
    const seventyFiveDaysAgo = new Date(NOW - 75 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatWaitAge({ ...base, last_message_at: sixtyDaysAgo }, NOW)).toBe("60d");
    expect(formatWaitAge({ ...base, last_message_at: seventyFiveDaysAgo }, NOW)).toBe("75d");
  });
  it("switches to months past 90 days, and years past 365 days", () => {
    expect(formatWaitAge({ ...base, last_message_at: "2026-04-03T12:00:00Z" }, NOW)).toBe("3mo");
    const overAYearAgo = new Date(NOW - 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatWaitAge({ ...base, last_message_at: overAYearAgo }, NOW)).toBe("1y");
  });
  it("returns 'just now' for under a minute", () => {
    expect(formatWaitAge({ ...base, last_message_at: "2026-07-03T11:59:45Z" }, NOW)).toBe(
      "just now",
    );
  });
  it("returns null when neither timestamp is present or valid", () => {
    expect(formatWaitAge(base, NOW)).toBe(null);
    expect(
      formatWaitAge({ ...base, customer_last_inbound_at: "garbage", last_message_at: null }, NOW),
    ).toBe(null);
  });
});

describe("formatWakeCountdown", () => {
  it("renders nothing for null (unset/invalid wake_at)", () => {
    expect(formatWakeCountdown(null)).toBe(null);
  });
  it("renders 'wakes today' for 0", () => {
    expect(formatWakeCountdown(0)).toBe("wakes today");
  });
  it("uses singular 'day' for 1", () => {
    expect(formatWakeCountdown(1)).toBe("wakes in 1 day");
  });
  it("uses plural 'days' for N > 1", () => {
    expect(formatWakeCountdown(5)).toBe("wakes in 5 days");
  });
});

describe("groupWaitingThreads", () => {
  it("partitions threads into customer/third_party groups, preserving order", () => {
    const customerA = { ...base, id: "a", waiting_reason: "customer" };
    const thirdPartyA = { ...base, id: "b", waiting_reason: "third_party" };
    const customerB = { ...base, id: "c", waiting_reason: null };
    const groups = groupWaitingThreads([customerA, thirdPartyA, customerB]);
    expect(groups).toEqual([
      { key: "customer", label: "Waiting on customer", threads: [customerA, customerB] },
      { key: "third_party", label: "Waiting on third party", threads: [thirdPartyA] },
    ]);
  });
  it("omits the third_party group when empty (pre-migration data)", () => {
    const customerA = { ...base, id: "a", waiting_reason: null };
    const groups = groupWaitingThreads([customerA]);
    expect(groups).toEqual([
      { key: "customer", label: "Waiting on customer", threads: [customerA] },
    ]);
  });
  it("still shows the sole non-empty group's header when it's third_party only", () => {
    const thirdPartyA = { ...base, id: "b", waiting_reason: "third_party" };
    const groups = groupWaitingThreads([thirdPartyA]);
    expect(groups).toEqual([
      { key: "third_party", label: "Waiting on third party", threads: [thirdPartyA] },
    ]);
  });
  it("returns an empty array for an empty/missing input", () => {
    expect(groupWaitingThreads([])).toEqual([]);
    expect(groupWaitingThreads(null)).toEqual([]);
    expect(groupWaitingThreads(undefined)).toEqual([]);
  });
});

describe("groupNeedsAttentionThreads", () => {
  it("splits into a default (unlabeled) group and a trailing 'Approve close' group", () => {
    const normalA = { ...base, id: "a", close_pending: false };
    const closePendingA = { ...base, id: "b", close_pending: true };
    const normalB = { ...base, id: "c" };
    const groups = groupNeedsAttentionThreads([normalA, closePendingA, normalB]);
    expect(groups).toEqual([
      { key: "default", label: null, threads: [normalA, normalB] },
      { key: "approve_close", label: "Approve close", threads: [closePendingA] },
    ]);
  });
  it("omits the approve_close group when no thread has close_pending (pre-migration data)", () => {
    const normalA = { ...base, id: "a" };
    const groups = groupNeedsAttentionThreads([normalA]);
    expect(groups).toEqual([{ key: "default", label: null, threads: [normalA] }]);
  });
  it("omits the default group when every thread is close_pending", () => {
    const closePendingA = { ...base, id: "a", close_pending: true };
    const groups = groupNeedsAttentionThreads([closePendingA]);
    expect(groups).toEqual([
      { key: "approve_close", label: "Approve close", threads: [closePendingA] },
    ]);
  });
  it("preserves relative order within each group", () => {
    const a = { ...base, id: "a", close_pending: true };
    const b = { ...base, id: "b", close_pending: true };
    const groups = groupNeedsAttentionThreads([a, b]);
    expect(groups[0].threads).toEqual([a, b]);
  });
  it("returns an empty array for an empty/missing input", () => {
    expect(groupNeedsAttentionThreads([])).toEqual([]);
    expect(groupNeedsAttentionThreads(null)).toEqual([]);
    expect(groupNeedsAttentionThreads(undefined)).toEqual([]);
  });
});

describe("resolveViewRoute", () => {
  it("passes canonical views through unchanged", () => {
    expect(resolveViewRoute("mine", "")).toEqual({ view: "mine", tab: "needs_attention" });
    expect(resolveViewRoute("waiting", "")).toEqual({ view: "waiting", tab: "needs_attention" });
    expect(resolveViewRoute("automated", "")).toEqual({ view: "automated", tab: "needs_attention" });
    expect(resolveViewRoute("all", "")).toEqual({ view: "all", tab: "needs_attention" });
  });
  it("maps legacy view aliases", () => {
    expect(resolveViewRoute("resolved", "")).toEqual({ view: "resolved", tab: "needs_attention" });
    expect(resolveViewRoute("notifications", "")).toEqual({ view: "automated", tab: "needs_attention" });
  });
  it("passes inbox:<slug> views through unchanged", () => {
    expect(resolveViewRoute("inbox:returns", "")).toEqual({ view: "inbox:returns", tab: "needs_attention" });
  });
  it("defaults empty/missing view to the empty string (needs_attention default)", () => {
    expect(resolveViewRoute("", "")).toEqual({ view: "", tab: "needs_attention" });
    expect(resolveViewRoute(undefined, undefined)).toEqual({ view: "", tab: "needs_attention" });
    expect(resolveViewRoute(null, null)).toEqual({ view: "", tab: "needs_attention" });
  });
  it("passes through valid tab values", () => {
    expect(resolveViewRoute("inbox:returns", "waiting")).toEqual({ view: "inbox:returns", tab: "waiting" });
    expect(resolveViewRoute("inbox:returns", "resolved")).toEqual({ view: "inbox:returns", tab: "resolved" });
  });
  it("falls back to needs_attention for an invalid/unknown tab", () => {
    expect(resolveViewRoute("inbox:returns", "bogus")).toEqual({ view: "inbox:returns", tab: "needs_attention" });
  });
  it("trims whitespace on both params", () => {
    expect(resolveViewRoute("  mine  ", "  waiting  ")).toEqual({ view: "mine", tab: "waiting" });
  });
});

describe("computeSidebarCounts", () => {
  const unread = { ...base, unread_count: 3 };
  const read = { ...base, unread_count: 0 };

  it("Inbox count bruger unread", () => {
    const counts = computeSidebarCounts([
      { ...unread, id: "a", status: "needs_attention" },
      { ...read, id: "b", status: "needs_attention" },
    ]);
    expect(counts.needsAttentionCount).toBe(1);
  });

  it("hides a bucket entirely full of read threads (0 unread, not the total)", () => {
    const counts = computeSidebarCounts([
      { ...read, id: "a", status: "needs_attention" },
      { ...read, id: "b", status: "needs_attention" },
      { ...read, id: "c", status: "needs_attention" },
    ]);
    expect(counts.needsAttentionCount).toBe(0);
  });

  it("Assigned to me count bruger unread", () => {
    const mineIds = new Set(["u1"]);
    const counts = computeSidebarCounts(
      [
        { ...unread, id: "a", status: "needs_attention", assignee_id: "u1" },
        { ...read, id: "b", status: "needs_attention", assignee_id: "u1" },
      ],
      { mineIds },
    );
    expect(counts.mineCount).toBe(1);
  });

  it("Waiting on customer count bruger unread", () => {
    const counts = computeSidebarCounts([
      { ...unread, id: "a", status: "waiting_customer" },
      { ...read, id: "b", status: "waiting_customer" },
    ]);
    expect(counts.waitingCustomerCount).toBe(1);
  });

  it("Waiting on third party count bruger unread", () => {
    const counts = computeSidebarCounts([
      { ...unread, id: "a", status: "waiting_third_party", waiting_reason: "third_party" },
      { ...read, id: "b", status: "waiting_third_party", waiting_reason: "third_party" },
    ]);
    expect(counts.waitingThirdPartyCount).toBe(1);
  });

  it("Spam count bruger unread", () => {
    const counts = computeSidebarCounts([
      { ...unread, id: "a", classification_key: "notification" },
      { ...read, id: "b", classification_key: "notification" },
    ]);
    expect(counts.notificationsCount).toBe(1);
  });

  it("Custom inbox count bruger unread", () => {
    const knownInboxSlugs = ["returns"];
    const counts = computeSidebarCounts(
      [
        { ...unread, id: "a", status: "needs_attention", tags: ["inbox:returns"] },
        { ...read, id: "b", status: "needs_attention", tags: ["inbox:returns"] },
      ],
      { knownInboxSlugs },
    );
    expect(counts.inboxUnreadCounts.returns).toBe(1);
  });

  it("a thread in a custom inbox counts toward that inbox, NOT the main Inbox", () => {
    const knownInboxSlugs = ["returns"];
    const counts = computeSidebarCounts(
      [
        { ...unread, id: "a", status: "needs_attention" }, // main Inbox
        { ...unread, id: "b", status: "needs_attention", tags: ["inbox:returns"] }, // Lager-style
      ],
      { knownInboxSlugs },
    );
    expect(counts.needsAttentionCount).toBe(1);
    expect(counts.inboxUnreadCounts.returns).toBe(1);
  });

  it("still counts a custom-inbox thread toward mine when it's assigned to me", () => {
    const counts = computeSidebarCounts(
      [{ ...unread, id: "a", status: "needs_attention", tags: ["inbox:returns"], assignee_id: "u1" }],
      { mineIds: new Set(["u1"]), knownInboxSlugs: ["returns"] },
    );
    expect(counts.mineCount).toBe(1);
    expect(counts.needsAttentionCount).toBe(0);
  });

  it("defaults every count to 0 and every known inbox slug to 0 for an empty input", () => {
    const counts = computeSidebarCounts([], { knownInboxSlugs: ["returns"] });
    expect(counts).toEqual({
      needsAttentionCount: 0,
      mineCount: 0,
      waitingCustomerCount: 0,
      waitingThirdPartyCount: 0,
      notificationsCount: 0,
      inboxUnreadCounts: { returns: 0 },
    });
  });
});
