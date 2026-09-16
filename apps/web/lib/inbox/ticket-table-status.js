import { toLegacyUiStatus } from "./status-model.js";

const TABLE_STATUS_LABELS = new Set(["New", "Open", "Pending", "Waiting"]);

export function normalizeTicketStatusLabel(value) {
  const label = toLegacyUiStatus(value);
  if (label === "Solved") return "Resolved";
  if (TABLE_STATUS_LABELS.has(label)) return label;
  return "Open";
}

export function isWaitingTicketStatus(status) {
  return status === "Waiting" || status === "Pending";
}
