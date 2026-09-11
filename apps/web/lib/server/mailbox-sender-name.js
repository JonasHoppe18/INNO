export const MAX_MAILBOX_SENDER_NAME_LENGTH = 120;

const INVALID_SENDER_NAME_CHARACTERS = /[\u0000-\u001f\u007f"<>;,\\:]/;

export function validateMailboxSenderName(value) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    return { value: null, error: "Sender name must be text." };
  }
  const normalized = String(value ?? "").trim();
  if (!normalized) return { value: null, error: null };
  if (normalized.length > MAX_MAILBOX_SENDER_NAME_LENGTH) {
    return {
      value: null,
      error: `Sender name must be ${MAX_MAILBOX_SENDER_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (INVALID_SENDER_NAME_CHARACTERS.test(normalized) || /[\r\n]/.test(normalized)) {
    return {
      value: null,
      error: "Sender name contains characters that are not allowed in an email header.",
    };
  }
  return { value: normalized, error: null };
}

export function requireValidMailboxSenderName(value) {
  const result = validateMailboxSenderName(value);
  if (result.error) throw new Error(result.error);
  return result.value;
}

export function resolveMailboxSenderName({ mailbox = {}, provider, fallback = null } = {}) {
  const configuredName = requireValidMailboxSenderName(mailbox?.from_name);
  if (configuredName) return configuredName;

  // Postmark/SMTP already has an application fallback. Gmail and Outlook
  // should keep their provider-configured identity when no mailbox name is set.
  if (provider === "smtp" || provider === "postmark") {
    return requireValidMailboxSenderName(fallback);
  }
  return null;
}

export function buildNamedFromAddress({ name = null, email } = {}) {
  const safeEmail = String(email || "").trim();
  if (
    !safeEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail) ||
    /[\r\n<>]/.test(safeEmail)
  ) {
    throw new Error("Sender email is invalid.");
  }
  const safeName = requireValidMailboxSenderName(name);
  return safeName ? `${safeName} <${safeEmail}>` : safeEmail;
}

export function buildOutlookFrom({ name = null, email } = {}) {
  const safeEmail = String(email || "").trim();
  const safeName = requireValidMailboxSenderName(name);
  buildNamedFromAddress({ name: safeName, email: safeEmail });
  return {
    emailAddress: {
      address: safeEmail,
      ...(safeName ? { name: safeName } : {}),
    },
  };
}

export function mailboxMatchesScope(mailbox, scope) {
  if (scope?.workspaceId) return mailbox?.workspace_id === scope.workspaceId;
  if (scope?.supabaseUserId) return mailbox?.user_id === scope.supabaseUserId;
  return false;
}
