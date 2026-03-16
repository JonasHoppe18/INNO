export function normalizeEmailAddress(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ? match[0].trim().toLowerCase() : text.toLowerCase();
}

export function getEffectiveSenderEmail(message) {
  return String(
    message?.extracted_customer_email || message?.from_email || ""
  ).trim();
}

export function getEffectiveSenderName(message) {
  return String(
    message?.extracted_customer_name || message?.from_name || ""
  ).trim();
}

export function getSenderLabel(message) {
  return getEffectiveSenderName(message) || getEffectiveSenderEmail(message) || "Unknown sender";
}

export function getReplyTargetEmail(message) {
  return getEffectiveSenderEmail(message);
}
