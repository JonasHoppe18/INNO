// Canonical thread lifecycle model. Keep in sync with
// supabase/functions/_shared/thread-status/transitions.ts (Deno side).
export const LIFECYCLE_STATUSES = [
  "needs_attention",
  "waiting_customer",
  "waiting_third_party",
  "resolved",
];

const LEGACY_TO_LIFECYCLE = {
  new: "needs_attention",
  open: "needs_attention",
  pending: "waiting_customer",
  waiting: "waiting_customer",
  solved: "resolved",
  resolved: "resolved",
};

export function normalizeLifecycleStatus(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "needs_attention";
  if (LIFECYCLE_STATUSES.includes(value)) return value;
  if (value === "blocked") return "blocked";
  return LEGACY_TO_LIFECYCLE[value] || "needs_attention";
}

const LIFECYCLE_TO_UI_LABEL = {
  needs_attention: "Open",
  waiting_customer: "Waiting",
  waiting_third_party: "Waiting",
  resolved: "Solved",
};

const LEGACY_TO_UI_LABEL = {
  new: "New",
  open: "Open",
  pending: "Pending",
  waiting: "Waiting",
  solved: "Solved",
  resolved: "Solved",
};

export function toLegacyUiStatus(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  return LIFECYCLE_TO_UI_LABEL[value] || LEGACY_TO_UI_LABEL[value] || raw;
}

export function buildAgentReplyStatusPatch(thread, nowIso) {
  const waitingReason =
    String(thread?.waiting_reason || "").trim() === "third_party"
      ? "third_party"
      : "customer";
  return {
    status:
      waitingReason === "third_party" ? "waiting_third_party" : "waiting_customer",
    waiting_reason: waitingReason,
    close_pending: false,
    attention_reason: null,
    status_changed_at: nowIso,
    is_read: true,
    unread_count: 0,
  };
}
