// The Dashboard only shows returns someone may still need to act on. Once the
// refund is completed there is nothing left to check.
const FINISHED_RETURN_STATUSES = new Set(["refund_completed"]);

export function openReturnShipments(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => !FINISHED_RETURN_STATUSES.has(String(row?.status || "").trim().toLowerCase()));
}
