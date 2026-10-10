// Wording for the dashboard ticket flow and Up next.

const ACTION_NOUNS = {
  create_refund: ["refund", "refunds"],
  refund_order: ["refund", "refunds"],
  cancel_order: ["cancellation", "cancellations"],
  change_shipping_address: ["address change", "address changes"],
  update_shipping_address: ["address change", "address changes"],
  initiate_return: ["return", "returns"],
  process_return: ["return", "returns"],
};

export function formatWait(hours) {
  if (hours == null) return null;
  if (hours < 1) return "under 1h";
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function describeActionTypes(actionTypes = {}) {
  const entries = Object.entries(actionTypes).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [type, count] = entries[0];
  const [one, many] = ACTION_NOUNS[type] || ["action", "actions"];
  const lead = `${count} ${count === 1 ? one : many}`;
  const rest = entries.slice(1).reduce((sum, [, n]) => sum + n, 0);
  return rest ? `${lead}, ${rest} other` : lead;
}

export function flowDetail(stage, bucket) {
  if (!bucket?.count) {
    return { needsReply: "Nothing new", repliesReady: "No replies waiting", awaitingApproval: "Nothing to approve", waiting: "No one to wait for" }[stage];
  }
  if (stage === "needsReply" && bucket.overdue) return `${bucket.overdue} waiting over 24h`;
  if (stage === "awaitingApproval") return describeActionTypes(bucket.actionTypes) || `Oldest ${formatWait(bucket.oldestHours)}`;
  return `Oldest ${formatWait(bucket.oldestHours)}`;
}
