// Canonical inbound transition. Keep in sync with
// apps/web/lib/inbox/status-model.js (Node side handles the outbound/agent-reply patch).
export interface InboundInput {
  currentStatus: string | null;
  waitingReason: string | null;
  isBlockedSender: boolean;
  isNewThread: boolean;
}

export interface ThreadStatusPatch {
  status: string;
  waiting_reason: string | null;
  close_pending: boolean;
  attention_reason: string | null;
  status_changed_at: string;
}

export function statusOnInboundCustomerMessage(
  input: InboundInput,
  nowIso: string,
): ThreadStatusPatch {
  if (input.isBlockedSender) {
    return {
      status: "blocked",
      waiting_reason: null,
      close_pending: false,
      attention_reason: null,
      status_changed_at: nowIso,
    };
  }
  const keepsThirdPartyWait =
    String(input.waitingReason || "").trim() === "third_party";
  return {
    status: "needs_attention",
    waiting_reason: keepsThirdPartyWait ? "third_party" : null,
    close_pending: false,
    attention_reason: input.isNewThread ? "new" : "customer_replied",
    status_changed_at: nowIso,
  };
}

// Minimal patch: flags a thread ready-to-close on a pure closing acknowledgment
// WITHOUT changing `status` (never force "resolved" — suggest only).
export function statusOnClosingAcknowledgment(): { close_pending: true } {
  return { close_pending: true };
}

// Hard-close patch: used when the workspace's `auto_close_mode` is `'auto'`.
// Resolves the thread outright instead of merely flagging it for approval.
export function statusOnAutoResolvedAcknowledgment(): {
  status: "resolved";
  close_pending: false;
} {
  return { status: "resolved", close_pending: false };
}
