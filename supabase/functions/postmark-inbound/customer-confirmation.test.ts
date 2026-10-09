import {
  addTicketReference,
  applyTicketReference,
  composeConfirmation,
  customerFirstName,
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

Deno.test("the message can mention the ticket reference", () => {
  const text = "Hi Anna,\n\nThanks.\n\nYour ticket number is {{ticket_reference}}.\n\nBest,\nAcme";
  assert(applyTicketReference(text, "T-50001").includes("Your ticket number is T-50001."), "fills the reference");
  const dropped = applyTicketReference(text, null);
  assert(dropped === "Hi Anna,\n\nThanks.\n\nBest,\nAcme", `drops the line: ${JSON.stringify(dropped)}`);
  assert(applyTicketReference("No mention", null) === "No mention", "untouched without token");
});

Deno.test("a message that mentions the reference gets no extra reference line", () => {
  const rendered = addTicketReference({
    subject: "Hi",
    text: "Your ticket number is T-50001.",
    html: "<p>Your ticket number is T-50001.</p>",
    ticketNumber: 50001,
    includeTicketNumber: true,
    placedInMessage: true,
  });
  assert(rendered.subject === "[T-50001] Hi", "subject keeps the prefix");
  assert(rendered.text === "Your ticket number is T-50001.", `text: ${rendered.text}`);
  assert(!rendered.html.includes("Ticket reference"), "no footer line");
});

const filled = (subject: string, text: string, layout: string) => ({
  subjectTemplate: subject,
  bodyText: text,
  bodyHtml: "",
  templateHtml: layout,
});

Deno.test("a design using the variable decides where the reference goes", () => {
  const out = composeConfirmation({
    ...filled("[{{ticket_reference}}] Hello", "Hi\n\nYour ticket number: {{ticket_reference}}", "<main>{{content}}</main>"),
    ticketNumber: 50001,
    includeTicketNumber: false,
  });
  assert(out.subject === "[T-50001] Hello", `subject: ${out.subject}`);
  assert(out.text === "Hi\n\nYour ticket number: T-50001", `text: ${out.text}`);
  assert(!out.html.includes("Ticket reference:"), "no footer line");
});

Deno.test("without a ticket number the subject brackets and lines disappear", () => {
  const out = composeConfirmation({
    ...filled("[{{ticket_reference}}] Hello", "Hi\n\nYour ticket number: {{ticket_reference}}\n\nBest", "{{content}}"),
    ticketNumber: null,
    includeTicketNumber: true,
  });
  assert(out.subject === "Hello", `subject: ${out.subject}`);
  assert(out.text === "Hi\n\nBest", `text: ${out.text}`);
});

Deno.test("older designs without the variable keep the switch", () => {
  const on = composeConfirmation({ ...filled("Hello", "Hi", "<main>{{content}}</main>"), ticketNumber: 50001, includeTicketNumber: true });
  assert(on.subject === "[T-50001] Hello", `subject: ${on.subject}`);
  assert(on.text.includes("Ticket reference: T-50001") && on.html.includes("Ticket reference: T-50001"), "footer line");
  const off = composeConfirmation({ ...filled("Hello", "Hi", "<main>{{content}}</main>"), ticketNumber: 50001, includeTicketNumber: false });
  assert(off.subject === "Hello" && !off.html.includes("T-50001"), "no reference when off");
});

Deno.test("greets by first name and never by an email address", () => {
  assert(customerFirstName("Anna Jensen") === "Anna", "expected Anna");
  assert(customerFirstName("  Anna  ") === "Anna", "expected trimmed Anna");
  assert(customerFirstName("") === "", "no name gives empty");
  assert(customerFirstName(null) === "", "null gives empty");
  assert(customerFirstName("jonas@example.com") === "", "email as name gives empty");
  assert(customerFirstName("<jonas@example.com>") === "", "bracketed email gives empty");
});
