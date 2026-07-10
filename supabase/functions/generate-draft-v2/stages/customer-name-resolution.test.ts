import { assertEquals } from "jsr:@std/assert@1";
import { resolveCustomerName } from "./customer-name-resolution.ts";

Deno.test("signature Thanks, Britt resolves Britt", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "The return is shipped.\n\nThanks,\nBritt.",
  });
  assertEquals(result.first_name, "Britt");
  assertEquals(result.source, "signature");
});

Deno.test("signature Best regards, Jonas resolves Jonas", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Here is the document.\n\nBest regards, Jonas",
  });
  assertEquals(result.first_name, "Jonas");
  assertEquals(result.source, "signature");
});

Deno.test("mobile signature is not treated as a name", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Sounds good.\n\nSent from my iPhone",
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

Deno.test("safe sender display name is used when no signature exists", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Can you help?",
    senderDisplayName: "Britt Estes",
  });
  assertEquals(result.first_name, "Britt");
  assertEquals(result.source, "sender_display_name");
});

Deno.test("email-address display name is ignored", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Can you help?",
    senderDisplayName: "estes.britt@gmail.com",
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

Deno.test("signature wins over conflicting order customer name", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Thanks,\nBritt.",
    senderEmail: "estes.britt@gmail.com",
    orderCustomerName: "Evan Estes",
    orderCustomerEmail: "estes.britt@gmail.com",
  });
  assertEquals(result.first_name, "Britt");
  assertEquals(result.source, "signature");
});

Deno.test("order name only is used when sender identity clearly matches", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Where is my order?",
    senderEmail: "evan.estes@example.com",
    orderCustomerName: "Evan Estes",
    orderCustomerEmail: "evan.estes@example.com",
  });
  assertEquals(result.first_name, "Evan");
  assertEquals(result.source, "verified_order_customer");
});

Deno.test("matching email alone is not enough to use order customer name", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Where is my order?",
    senderEmail: "estes.britt@gmail.com",
    senderDisplayName: "estes.britt@gmail.com",
    orderCustomerName: "Evan Estes",
    orderCustomerEmail: "estes.britt@gmail.com",
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

Deno.test("quoted prior signature is not read from latest customer message", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: `The USPS tracking number is 9588871095290073926950

On Tue, Jun 9, 2026 Britt <britt@example.com> wrote:
> Thanks,
> Britt.`,
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

Deno.test("malformed signature falls back to neutral", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Thanks,\nCustomer Service",
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

Deno.test("recent same-sender signature can resolve follow-up name", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "The USPS tracking number is 9588871095290073926950",
    senderEmail: "estes.britt@gmail.com",
    senderDisplayName: "estes.britt@gmail.com",
    orderCustomerName: "Evan Estes",
    orderCustomerEmail: "estes.britt@gmail.com",
    recentCustomerMessages: [
      {
        senderEmail: "estes.britt@gmail.com",
        text: "I am still going to go through with the refund.\n\nThanks,\nBritt.",
      },
      {
        senderEmail: "estes.britt@gmail.com",
        text: "The USPS tracking number is 9588871095290073926950",
      },
    ],
  });
  assertEquals(result.first_name, "Britt");
  assertEquals(result.source, "signature");
});

Deno.test("conflicting recent signatures fall back to neutral", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Following up.",
    senderEmail: "shared@example.com",
    recentCustomerMessages: [
      { senderEmail: "shared@example.com", text: "Thanks,\nBritt" },
      { senderEmail: "shared@example.com", text: "Thanks,\nEvan" },
    ],
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

Deno.test("generic resolver has no shop-specific hardcoding", () => {
  const result = resolveCustomerName({
    latestCustomerMessage: "Thanks,\nSupport",
    senderDisplayName: "Customer Service",
  });
  assertEquals(result.first_name, null);
  assertEquals(result.source, "none");
});

// T-051002 regression: Shopify contact-form relays carry the customer's name
// ONLY in the structured "Name:" field — the sender is mailer@shopify.com and
// there is usually no signature. The parsed field must win so drafts greet
// "Hi Mark", not "Hi there".
Deno.test("contact-form name field resolves with high confidence", () => {
  const r = resolveCustomerName({
    latestCustomerMessage:
      "You received a new message from your online store's contact form.\n\nName:\nMark Brandt\n\nBody:\nHello, my mic broke.",
    senderEmail: "mailer@shopify.com",
    senderDisplayName: "mailer@shopify.com",
    contactFormName: "Mark Brandt",
  });
  assertEquals(r.first_name, "Mark");
  assertEquals(r.source, "contact_form");
  assertEquals(r.confidence, "high");
});

Deno.test("non-personal contact-form name (company) does not resolve", () => {
  const r = resolveCustomerName({
    latestCustomerMessage: "Name:\nAcme Support Team\n\nBody:\nhi",
    senderEmail: "mailer@shopify.com",
    contactFormName: "Acme Support Team",
  });
  assertEquals(r.first_name, null);
});
