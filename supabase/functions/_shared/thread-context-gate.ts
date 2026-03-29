type ThreadContextGateInput = {
  hasReplyHeaders: boolean;
  dbHistoryCount: number;
  quotedFallbackCount: number;
};

type ThreadContextGateResult = {
  is_follow_up: boolean;
  has_sufficient_context: boolean;
  should_block_normal_reply: boolean;
  context_source: "db_history" | "quoted_fallback" | "none";
};

export function hasThreadReplyHeaders(
  headers: Array<{ name: string; value: string }> | null | undefined,
): boolean {
  if (!Array.isArray(headers) || !headers.length) return false;
  return headers.some((header) => {
    const name = String(header?.name || "").trim().toLowerCase();
    if (!name) return false;
    return name === "in-reply-to" || name === "references";
  });
}

export function evaluateThreadContextGate(
  input: ThreadContextGateInput,
): ThreadContextGateResult {
  const dbCount = Number.isFinite(input.dbHistoryCount) ? Math.max(0, input.dbHistoryCount) : 0;
  const quotedCount = Number.isFinite(input.quotedFallbackCount)
    ? Math.max(0, input.quotedFallbackCount)
    : 0;

  const isFollowUp = Boolean(input.hasReplyHeaders) || dbCount > 0 || quotedCount > 0;
  const hasSufficientContext = dbCount > 0 || quotedCount > 0;
  const contextSource = dbCount > 0 ? "db_history" : quotedCount > 0 ? "quoted_fallback" : "none";

  return {
    is_follow_up: isFollowUp,
    has_sufficient_context: hasSufficientContext,
    should_block_normal_reply: isFollowUp && !hasSufficientContext,
    context_source: contextSource,
  };
}

