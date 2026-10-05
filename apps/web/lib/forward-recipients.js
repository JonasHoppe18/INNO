export const MAX_FORWARD_RECIPIENTS = 20;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asString(value) {
  return String(value ?? "");
}

function normalizeCandidate(value) {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? value.email ?? value.address
      : value;
  const rawString = asString(raw);
  if (/[\u0000-\u001f\u007f]/.test(rawString)) return "";
  const normalized = rawString.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

function emailCandidates(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export function normalizeForwardRecipients(value, { max = MAX_FORWARD_RECIPIENTS } = {}) {
  const recipients = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();

  for (const candidate of emailCandidates(value)) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) {
      const raw = asString(
        candidate && typeof candidate === "object" ? candidate.email ?? candidate.address : candidate,
      ).trim();
      if (raw) invalid.push(raw);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }
    seen.add(normalized);
    recipients.push(normalized);
  }

  const tooMany = recipients.length > max;
  return {
    recipients: tooMany ? recipients.slice(0, max) : recipients,
    invalid,
    duplicates,
    tooMany,
    valid: !invalid.length && !duplicates.length && !tooMany && recipients.length > 0,
  };
}

export function resolveForwardRecipients({ payload = {}, detail = "" } = {}) {
  const sourcePayload = payload && typeof payload === "object" ? payload : {};
  const hasExplicitRecipients = Object.prototype.hasOwnProperty.call(sourcePayload, "recipients");
  const explicitValue = hasExplicitRecipients
    ? sourcePayload.recipients
    : sourcePayload.target_email ?? sourcePayload.forward_to_email;
  const explicit = normalizeForwardRecipients(explicitValue);
  if (hasExplicitRecipients || explicit.recipients.length) {
    return { ...explicit, source: hasExplicitRecipients ? "recipients" : "legacy" };
  }

  const detailEmails = asString(detail).match(/[^\s@]+@[^\s@]+\.[^\s@.,;:!?]+/gi) || [];
  return {
    ...normalizeForwardRecipients(detailEmails.slice(0, 1)),
    source: "detail",
  };
}

export function formatForwardRecipients(recipients) {
  return normalizeForwardRecipients(recipients).recipients.join(", ");
}

export function formatForwardRecipientList(recipients) {
  const normalized = normalizeForwardRecipients(recipients).recipients;
  if (!normalized.length) return "";
  if (normalized.length === 1) return normalized[0];
  if (normalized.length === 2) return `${normalized[0]} and ${normalized[1]}`;
  return `${normalized.slice(0, -1).join(", ")}, and ${normalized.at(-1)}`;
}

export function addForwardRecipient(currentRecipients, value, { max = MAX_FORWARD_RECIPIENTS } = {}) {
  const current = normalizeForwardRecipients(currentRecipients, { max });
  const candidate = normalizeForwardRecipients([value]);
  if (!candidate.valid) {
    return { ok: false, error: "Enter a valid forwarding email address.", recipients: current.recipients };
  }
  const email = candidate.recipients[0];
  if (current.recipients.includes(email)) {
    return {
      ok: false,
      error: "That forwarding recipient has already been added.",
      recipients: current.recipients,
    };
  }
  if (current.recipients.length >= max) {
    return {
      ok: false,
      error: `You can forward to up to ${max} recipients.`,
      recipients: current.recipients,
    };
  }
  return { ok: true, error: "", recipients: [...current.recipients, email] };
}

export function removeForwardRecipient(currentRecipients, value) {
  const email = normalizeForwardRecipients([value]).recipients[0];
  return normalizeForwardRecipients(currentRecipients).recipients.filter(
    (recipient) => recipient !== email,
  );
}
