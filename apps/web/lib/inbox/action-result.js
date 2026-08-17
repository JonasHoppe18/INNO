const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@.,;:!?]+/i;

export function getForwardTargetEmail(payload = {}, detail = "") {
  const payloadEmail = String(payload?.target_email || payload?.forward_to_email || "")
    .trim()
    .toLowerCase();
  if (payloadEmail) return payloadEmail;
  return String(detail || "").match(EMAIL_PATTERN)?.[0]?.toLowerCase() || "";
}

export function getForwardActionResult({ actionType = "", payload = {}, detail = "" } = {}) {
  if (String(actionType).trim().toLowerCase() !== "forward_email") return null;

  const recipient = getForwardTargetEmail(payload, detail);
  return {
    recipient,
    title: recipient || "Email forwarded",
  };
}
