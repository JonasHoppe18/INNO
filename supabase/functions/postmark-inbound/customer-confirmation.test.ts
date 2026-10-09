import {
  addTicketReference,
  formatTicketReference,
  isAutomatedSender,
  mergeConfirmationLayout,
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

Deno.test("a design can place the ticket reference itself", () => {
  const layout = "<main>{{content}}</main><footer>Ref {{ticket_reference}}</footer>";
  const rendered = addTicketReference({
    subject: "Hi",
    text: "Body",
    html: "<p>Body</p>",
    ticketNumber: 50001,
    includeTicketNumber: true,
    placedInLayout: true,
  });
  assert(rendered.subject === "[T-50001] Hi", "subject keeps the prefix");
  assert(!rendered.html.includes("Ticket reference"), "html must not append the default line");
  const merged = mergeConfirmationLayout({ templateHtml: layout, contentHtml: rendered.html, ticketReference: rendered.ticketReference });
  assert(merged === "<main><p>Body</p></main><footer>Ref T-50001</footer>", `unexpected merge: ${merged}`);
});

Deno.test("a placed reference is emptied when the reference is off", () => {
  const merged = mergeConfirmationLayout({ templateHtml: "<main>{{content}}</main><b>{{ticket_reference}}</b>", contentHtml: "x", ticketReference: null });
  assert(merged === "<main>x</main><b></b>", `unexpected merge: ${merged}`);
});

Deno.test("layouts without a content slot get the content appended", () => {
  const merged = mergeConfirmationLayout({ templateHtml: "<header>Logo</header>", contentHtml: "x", ticketReference: "T-1" });
  assert(merged === "<header>Logo</header>\nx", `unexpected merge: ${merged}`);
});
