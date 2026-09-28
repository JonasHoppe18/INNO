export function formatTicketReference(ticketNumber: unknown): string | null {
  const numeric = Number(String(ticketNumber ?? "").replace(/\D/g, ""));
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return `T-${numeric}`;
}

type SenderMailbox = {
  provider_email?: string | null;
  from_name?: string | null;
  metadata?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getVerifiedManagedSenderEmail(mailbox: SenderMailbox): string | null {
  const metadata = mailbox?.metadata && typeof mailbox.metadata === "object"
    ? mailbox.metadata as Record<string, unknown>
    : {};
  const managed = metadata.managed_sender && typeof metadata.managed_sender === "object"
    ? metadata.managed_sender as Record<string, unknown>
    : null;
  const status = asString(managed?.status).toLowerCase();
  const domain = asString(managed?.domain).toLowerCase();
  const fromEmail = asString(managed?.from_email).toLowerCase();
  if (
    status !== "verified" ||
    !domain ||
    !isValidEmail(fromEmail) ||
    !fromEmail.endsWith(`@${domain}`)
  ) {
    return null;
  }
  return fromEmail;
}

export function resolveCustomerConfirmationSender(input: {
  mailbox: SenderMailbox;
  sharedFromEmail?: string | null;
}): { fromEmail: string; fromName: string; replyTo: string | null } {
  const managedFromEmail = getVerifiedManagedSenderEmail(input.mailbox);
  const sharedFromEmail = asString(input.sharedFromEmail).toLowerCase();
  const fromEmail = managedFromEmail || (isValidEmail(sharedFromEmail) ? sharedFromEmail : null);
  if (!fromEmail) {
    throw new Error("Customer confirmation sender email could not be resolved from a verified sender.");
  }
  return {
    fromEmail,
    fromName: asString(input.mailbox.from_name),
    replyTo: asString(input.mailbox.provider_email) || null,
  };
}

export function buildCustomerConfirmationTokens(input: {
  customerName?: string | null;
  customerEmail?: string | null;
  mailboxFromName?: string | null;
  subject?: string | null;
}): Record<string, string> {
  const customerName = asString(input.customerName);
  const fallbackEmail = asString(input.customerEmail);
  const firstName = (customerName || fallbackEmail).split(/\s+/)[0] || "there";
  return {
    customer_name: customerName,
    customer_first_name: firstName,
    team_name: asString(input.mailboxFromName),
    subject: asString(input.subject),
  };
}

export function buildCustomerConfirmationReplyHeaders(
  replyMessageId: string | null | undefined,
): Array<{ Name: string; Value: string }> | undefined {
  const normalized = asString(replyMessageId).replace(/^<|>$/g, "");
  if (!normalized) return undefined;
  return [
    { Name: "In-Reply-To", Value: `<${normalized}>` },
    { Name: "References", Value: `<${normalized}>` },
  ];
}

type ConfirmationHeader = { Name?: string; Value?: string };

function headerValue(headers: ConfirmationHeader[], name: string): string {
  return String(
    headers.find((header) => String(header?.Name || "").toLowerCase() === name.toLowerCase())?.Value || "",
  ).trim();
}

export function isAutomatedSender(input: {
  fromEmail: string | null;
  headers: ConfirmationHeader[];
}): boolean {
  const sender = String(input.fromEmail || "").toLowerCase();
  if (/no[-_.]?reply|donotreply|mailer-daemon|postmaster|noreply/.test(sender)) return true;

  const autoSubmitted = headerValue(input.headers, "Auto-Submitted").toLowerCase();
  const precedence = headerValue(input.headers, "Precedence").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (/bulk|list|junk/.test(precedence)) return true;
  if (headerValue(input.headers, "X-Auto-Response-Suppress")) return true;
  if (headerValue(input.headers, "X-Autoreply") || headerValue(input.headers, "X-Autorespond")) return true;
  if (headerValue(input.headers, "List-Id") || headerValue(input.headers, "List-Unsubscribe")) return true;
  return false;
}

export function shouldSendCustomerConfirmation(input: {
  createdNewThread: boolean;
  isEffectiveSupport: boolean;
  isBlockedSender: boolean;
  hasCustomerEmail: boolean;
  isLikelyAutoSender: boolean;
}): boolean {
  return Boolean(
    input.createdNewThread &&
      input.isEffectiveSupport &&
      !input.isBlockedSender &&
      input.hasCustomerEmail &&
      !input.isLikelyAutoSender
  );
}

export function addTicketReference(input: {
  subject: string;
  text: string;
  html: string;
  ticketNumber: unknown;
  includeTicketNumber: boolean;
}): { subject: string; text: string; html: string; ticketReference: string | null } {
  const ticketReference = formatTicketReference(input.ticketNumber);
  if (!input.includeTicketNumber || !ticketReference) {
    return {
      subject: input.subject,
      text: input.text,
      html: input.html,
      ticketReference: null,
    };
  }
  const referenceText = `Ticket reference: ${ticketReference}`;
  return {
    subject: `[${ticketReference}] ${input.subject}`,
    text: [input.text, referenceText].filter(Boolean).join("\n\n"),
    html: `${input.html}<p style="margin-top:24px;color:#64748b;font-size:13px">${referenceText}</p>`,
    ticketReference,
  };
}
