import { normalizeLifecycleStatus } from "./status-model.js";

export function buildManualStatusPatch(body, nowIso) {
  const payload = {};
  if (typeof body?.status !== "string" || !body.status.trim()) {
    return { payload };
  }
  const status = normalizeLifecycleStatus(body.status);
  payload.status = status;
  payload.status_changed_at = nowIso;

  if (status === "waiting_customer" || status === "waiting_third_party") {
    const requested = String(body?.waitingReason || "").trim();
    payload.waiting_reason =
      requested === "third_party" || status === "waiting_third_party"
        ? "third_party"
        : "customer";
    if (body?.wakeAt !== undefined && body?.wakeAt !== null) {
      const parsed = Date.parse(String(body.wakeAt));
      if (Number.isNaN(parsed)) {
        return { error: "Invalid wakeAt timestamp." };
      }
      payload.wake_at = new Date(parsed).toISOString();
    } else {
      payload.wake_at = null;
    }
    payload.close_pending = false;
    payload.attention_reason = null;
  } else {
    payload.waiting_reason = null;
    payload.wake_at = null;
    payload.close_pending = false;
    payload.attention_reason = null;
  }
  return { payload };
}
