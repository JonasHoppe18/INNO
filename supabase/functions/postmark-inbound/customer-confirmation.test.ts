import {
  addTicketReference,
  buildCustomerConfirmationReplyHeaders,
  buildCustomerConfirmationTokens,
  formatTicketReference,
  isAutomatedSender,
  resolveCustomerConfirmationSender,
  shouldSendCustomerConfirmation,
} from "./customer-confirmation.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("formats the public ticket reference without padding", () => {
  assert(formatTicketReference(50001) === "T-50001", "expected T-50001");
  assert(formatTicketReference(null) === null, "invalid number should be null");
});

Deno.test("confirmation eligibility is limited to a new support ticket", () => {
  const base = {
    createdNewThread: true,
    isEffectiveSupport: true,
    isBlockedSender: false,
    hasCustomerEmail: true,
    isLikelyAutoSender: false,
  };
  assert(shouldSendCustomerConfirmation(base), "new support ticket should send");
  assert(!shouldSendCustomerConfirmation({ ...base, createdNewThread: false }), "reply must not send");
  assert(!shouldSendCustomerConfirmation({ ...base, isEffectiveSupport: false }), "notification must not send");
  assert(!shouldSendCustomerConfirmation({ ...base, isBlockedSender: true }), "blocked sender must not send");
  assert(!shouldSendCustomerConfirmation({ ...base, isLikelyAutoSender: true }), "auto sender must not send");
});

Deno.test("automated and mailing-list senders are rejected", () => {
  assert(isAutomatedSender({ fromEmail: "no-reply@example.com", headers: [] }), "no-reply should be rejected");
  assert(isAutomatedSender({
    fromEmail: "news@example.com",
    headers: [{ Name: "List-Id", Value: "newsletter.example.com" }],
  }), "mailing list should be rejected");
  assert(isAutomatedSender({
    fromEmail: "person@example.com",
    headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }],
  }), "auto responder should be rejected");
  assert(!isAutomatedSender({ fromEmail: "person@example.com", headers: [] }), "customer should be allowed");
});

Deno.test("ticket reference is system controlled in subject and body", () => {
  const rendered = addTicketReference({
    subject: "We've received your message",
    text: "Thanks for contacting us.",
    html: "<p>Thanks for contacting us.</p>",
    ticketNumber: 50001,
    includeTicketNumber: true,
  });
  assert(rendered.subject === "[T-50001] We've received your message", "subject reference missing");
  assert(rendered.text.endsWith("Ticket reference: T-50001"), "text reference missing");
  assert(rendered.html.includes("Ticket reference: T-50001"), "html reference missing");
});

Deno.test("customer confirmation uses the submitted customer name and persisted ticket number", () => {
  const tokens = buildCustomerConfirmationTokens({
    customerName: "Elias Knudsen",
    customerEmail: "customer@example.com",
    mailboxFromName: "AceZone Support",
    subject: "Website request",
  });
  assert(tokens.customer_first_name === "Elias", "submitted customer name should win");

  const rendered = addTicketReference({
    subject: "We've received your message",
    text: "Thanks.",
    html: "<p>Thanks.</p>",
    ticketNumber: 51647,
    includeTicketNumber: true,
  });
  assert(rendered.subject.startsWith("[T-51647]"), "persisted ticket number should be used");
  assert(!rendered.subject.includes("T-50001"), "preview ticket number must not leak into real rendering");
});

Deno.test("verified managed sender is used while provider email remains Reply-To", () => {
  const sender = resolveCustomerConfirmationSender({
    mailbox: {
      provider_email: "support@merchant.example",
      from_name: "Merchant Support",
      metadata: {
        managed_sender: {
          status: "verified",
          domain: "merchant.sona-ai.dk",
          from_email: "support@merchant.sona-ai.dk",
        },
      },
    },
    sharedFromEmail: "support@sona-ai.dk",
  });
  assert(sender.fromEmail === "support@merchant.sona-ai.dk", "managed sender should be From");
  assert(sender.fromName === "Merchant Support", "mailbox display name should be preserved");
  assert(sender.replyTo === "support@merchant.example", "provider email should remain Reply-To");
});

Deno.test("unverified provider email is never selected as From", () => {
  const sender = resolveCustomerConfirmationSender({
    mailbox: {
      provider_email: "unverified@merchant.example",
      metadata: { managed_sender: { status: "pending", domain: "merchant.sona-ai.dk", from_email: "support@merchant.sona-ai.dk" } },
    },
    sharedFromEmail: "support@sona-ai.dk",
  });
  assert(sender.fromEmail === "support@sona-ai.dk", "shared verified fallback should be used");
  assert(sender.fromEmail !== "unverified@merchant.example", "provider email must not become From");
});

Deno.test("missing valid sender fails visibly", () => {
  let failed = false;
  try {
    resolveCustomerConfirmationSender({
      mailbox: { provider_email: "support@merchant.example", metadata: {} },
      sharedFromEmail: "not-an-email",
    });
  } catch (error) {
    failed = String(error).includes("sender email could not be resolved");
  }
  assert(failed, "missing verified sender should throw a clear error");
});

Deno.test("customer confirmation preserves reply threading headers", () => {
  const headers = buildCustomerConfirmationReplyHeaders("<original-message@example.com>");
  assert(headers?.[0]?.Name === "In-Reply-To", "In-Reply-To header should be present");
  assert(headers?.[0]?.Value === "<original-message@example.com>", "In-Reply-To value should be preserved");
  assert(headers?.[1]?.Name === "References", "References header should be present");
  assert(headers?.[1]?.Value === "<original-message@example.com>", "References value should be preserved");
});
