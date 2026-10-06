export function buildForwardRecipientResult({
  recipient,
  attemptId,
  state,
  providerMessageId = null,
  errorCode = null,
}) {
  return {
    email: recipient,
    state,
    attempt_id: attemptId || null,
    provider_message_id: providerMessageId || null,
    error_code: errorCode || null,
  };
}

function formatForwardRecipientFailure(result) {
  const reason =
    result.error_code === "recipient_suppressed" || result.error_code === "recipient_rejected"
      ? "delivery rejected"
      : "delivery failed";
  return `${result.email} — ${reason}`;
}

export function summarizeForwardRecipientResults(results = []) {
  const recipientResults = Array.isArray(results) ? results : [];
  const succeeded = recipientResults.filter((result) => result.state === "sent");
  const unknown = recipientResults.filter((result) => result.state === "unknown");
  const failed = recipientResults.filter((result) => result.state === "failed");
  const inProgress = recipientResults.filter((result) => result.state === "in_progress");

  if (inProgress.length) {
    return {
      kind: "in_progress",
      detail: `Forwarding is still in progress for: ${inProgress.map((result) => result.email).join(", ")}.`,
      error: "This forward is already in progress. Verify the thread before trying again.",
    };
  }
  if (unknown.length) {
    const unknownText = `Delivery status could not be confirmed for: ${unknown.map((result) => result.email).join(", ")}.`;
    const failedText = failed.length
      ? ` Could not forward to: ${failed.map(formatForwardRecipientFailure).join(", ")}.`
      : "";
    return {
      kind: "unknown_outcome",
      detail: `${unknownText}${failedText}`,
      error: `${unknownText}${failedText} The provider may have accepted the unknown delivery; do not retry those recipients automatically.`,
    };
  }
  if (failed.length) {
    const prefix = succeeded.length
      ? `Forwarded to ${succeeded.length} of ${recipientResults.length} recipients.`
      : "The forward could not be delivered.";
    return {
      kind: succeeded.length ? "partial_failure" : "failed",
      detail: `${prefix} Could not forward to: ${failed.map(formatForwardRecipientFailure).join(", ")}.`,
      error: `${prefix} Could not forward to: ${failed.map(formatForwardRecipientFailure).join(", ")}.`,
    };
  }
  return {
    kind: "all_succeeded",
    detail: `Forwarded to ${succeeded.length} recipient${succeeded.length === 1 ? "" : "s"}.`,
    error: null,
  };
}
