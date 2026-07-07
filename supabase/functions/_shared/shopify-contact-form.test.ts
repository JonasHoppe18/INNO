import { assertEquals } from "jsr:@std/assert@1";
import {
  parseShopifyContactIdentity,
  shouldBypassShopifyNotificationSenderRule,
} from "./shopify-contact-form.ts";

// E. Parser tests

Deno.test("parseShopifyContactIdentity extracts EN structured Shopify contact form", () => {
  const result = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "New customer message on 12 June 2026 at 09:14",
    bodyText:
      "Name: Jack Arblaster\n" +
      "Email: jack.arblaster@example.com\n" +
      "What Do You Need Help With?: My headset is broken\n" +
      "Body: The left ear cup stopped working after two weeks.",
  });

  assertEquals(result.detected, true);
  assertEquals(result.customerEmail, "jack.arblaster@example.com");
  assertEquals(result.customerName, "Jack Arblaster");
});

Deno.test("parseShopifyContactIdentity extracts DE structured Shopify contact form", () => {
  const result = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Neue Kundennachricht am 12. Juni 2026 um 09:14",
    bodyText:
      "Name: Andre Zunk\n" +
      "E-Mail: andre.zunk@example.de\n" +
      "Was Ist Ihr Anliegen?: Reklamation\n" +
      "Wobei Benötigen Sie Hilfe?: Mein Headset ist kaputt.",
  });

  assertEquals(result.detected, true);
  assertEquals(result.customerEmail, "andre.zunk@example.de");
  assertEquals(result.customerName, "Andre Zunk");
});

Deno.test("parseShopifyContactIdentity does not detect a payout/billing system notification as a customer relay", () => {
  const result = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Your payout of 1.234,56 kr. is on its way",
    bodyText:
      "Hi there,\n\nYour payout of 1.234,56 kr. has been initiated and should arrive in your bank account within 3-5 business days.\n\nThanks,\nShopify Payments",
  });

  assertEquals(result.detected, false);
  assertEquals(result.customerEmail, null);
});

Deno.test("parseShopifyContactIdentity does not detect a recurring-charge app notification as a customer relay", () => {
  const result = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Recurring charge approved for LangShop",
    bodyText:
      "Hi,\n\nThe recurring charge for LangShop has been approved and will be billed to your account.\n\nShopify",
  });

  assertEquals(result.detected, false);
});

Deno.test("parseShopifyContactIdentity does not detect an urgent-payment admin reminder as a customer relay", () => {
  const result = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Urgent: Payment for order #1042 expires within 24 hours",
    bodyText:
      "Hi,\n\nThe payment for order #1042 expires within 24 hours. Please capture the payment before it expires.\n\nShopify",
  });

  assertEquals(result.detected, false);
});

// shouldBypassShopifyNotificationSenderRule

Deno.test("shouldBypassShopifyNotificationSenderRule bypasses when a structured Shopify customer relay is forced to notification", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "New customer message on 12 June 2026 at 09:14",
    bodyText: "Name: Jack Arblaster\nEmail: jack.arblaster@example.com\nBody: Help please.",
  });

  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "mailer@shopify.com",
      senderRuleDestinationType: "classification",
      senderRuleDestinationValue: "notification",
      shopifyContact,
    }),
    true,
  );
});

Deno.test("shouldBypassShopifyNotificationSenderRule does not bypass a true payout notification", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Your payout of 1.234,56 kr. is on its way",
    bodyText: "Your payout has been initiated and should arrive within 3-5 business days.",
  });

  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "mailer@shopify.com",
      senderRuleDestinationType: "classification",
      senderRuleDestinationValue: "notification",
      shopifyContact,
    }),
    false,
  );
});

Deno.test("shouldBypassShopifyNotificationSenderRule does not bypass for a non-Shopify sender", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "someone@example.com",
    subject: "New customer message on 12 June 2026 at 09:14",
    bodyText: "Name: Jack Arblaster\nEmail: jack.arblaster@example.com\nBody: Help please.",
  });

  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "someone@example.com",
      senderRuleDestinationType: "classification",
      senderRuleDestinationValue: "notification",
      shopifyContact,
    }),
    false,
  );
});

// A. True system notifications remain suppressed end-to-end (sender rule keeps applying)
Deno.test("shouldBypassShopifyNotificationSenderRule does not bypass a recurring-charge app notification", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Recurring charge approved for LangShop",
    bodyText: "The recurring charge for LangShop has been approved and will be billed to your account.",
  });

  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "mailer@shopify.com",
      senderRuleDestinationType: "classification",
      senderRuleDestinationValue: "notification",
      shopifyContact,
    }),
    false,
  );
});

Deno.test("shouldBypassShopifyNotificationSenderRule does not bypass an urgent-payment admin reminder", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "Urgent: Payment for order #1042 expires within 24 hours",
    bodyText: "The payment for order #1042 expires within 24 hours. Please capture the payment before it expires.",
  });

  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "mailer@shopify.com",
      senderRuleDestinationType: "classification",
      senderRuleDestinationValue: "notification",
      shopifyContact,
    }),
    false,
  );
});

// D. Conservative default: unrecognized Shopify mail keeps existing notification behavior
Deno.test("shouldBypassShopifyNotificationSenderRule keeps the conservative default for unrecognized Shopify mail", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "An update about your store",
    bodyText: "This is a generic notice from Shopify with no structured fields and no known subject pattern.",
  });

  assertEquals(shopifyContact.detected, false);
  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "mailer@shopify.com",
      senderRuleDestinationType: "classification",
      senderRuleDestinationValue: "notification",
      shopifyContact,
    }),
    false,
  );
});

Deno.test("shouldBypassShopifyNotificationSenderRule does not bypass when the sender rule targets an inbox, not notification", () => {
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "New customer message on 12 June 2026 at 09:14",
    bodyText: "Name: Jack Arblaster\nEmail: jack.arblaster@example.com\nBody: Help please.",
  });

  assertEquals(
    shouldBypassShopifyNotificationSenderRule({
      fromEmail: "mailer@shopify.com",
      senderRuleDestinationType: "inbox",
      senderRuleDestinationValue: "general",
      shopifyContact,
    }),
    false,
  );
});

// ---- extractContactFormOrderNumbers (T-051002 regression) ----
// The customer typed a bare "3955" under "If Applicable, Place Of Purchase And
// Order Number:". Nothing downstream used the field, so order-match never ran
// on it and the writer asked "where did you purchase" although the order was
// stated (and exists).

import { extractContactFormOrderNumbers } from "./shopify-contact-form.ts";

const FORM_BODY = (orderField: string) =>
  `You received a new message from your online store's contact form.

Country Code:
DK

Name:
Mark Brandt

Email:
marc452c@outlook.dk

If Applicable, Place Of Purchase And Order Number:
${orderField}

What Is Your Request Regarding?:
A-Spire Wireless

Body:
Hello, my microphone broke.`;

function identityFor(orderField: string) {
  return parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "New customer message on 6 July 2026",
    bodyText: FORM_BODY(orderField),
  });
}

Deno.test("extracts a bare numeric order number from the order field", () => {
  assertEquals(extractContactFormOrderNumbers(identityFor("3955")), ["3955"]);
});

Deno.test("extracts '#1234' and 'Order #1234' forms", () => {
  assertEquals(extractContactFormOrderNumbers(identityFor("#1234")), ["1234"]);
  assertEquals(extractContactFormOrderNumbers(identityFor("Order #1234")), ["1234"]);
});

Deno.test("extracts the number out of combined place-of-purchase text", () => {
  assertEquals(
    extractContactFormOrderNumbers(identityFor("Webshop, ordre 4683")),
    ["4683"],
  );
});

Deno.test("returns [] for place-of-purchase text without any number", () => {
  assertEquals(extractContactFormOrderNumbers(identityFor("Amazon")), []);
});

Deno.test("ignores short/implausible numbers (quantity-like)", () => {
  assertEquals(extractContactFormOrderNumbers(identityFor("2")), []);
});

Deno.test("returns [] when the form has no order-number field", () => {
  const identity = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "New customer message",
    bodyText: "Name:\nX Y\n\nEmail:\nx@y.dk\n\nBody:\nhello",
  });
  assertEquals(extractContactFormOrderNumbers(identity), []);
});

// Continuation must only look at the IMMEDIATELY following line. With the real
// T-051002 body, the old logic scanned the whole remaining document and glued
// far-away prose onto field values: Name became "Mark Brandt\nI purchased my
// Aspire Wireless headset on **27/02/2026**, and" and the order field picked
// up "2026" from that date.
const REAL_T051002_BODY = `You received a new message from your online store's contact form.

Country Code:
DK

Name:
Mark Brandt

Email:
marc452c@outlook.dk

Company / Team:

Your Country:
Danmark

If Applicable, Place Of Purchase And Order Number:
3955

What Is Your Request Regarding?:
A-Spire Wireless

What Do You Need Help With?:
Other

Body:
Hello,

I purchased my Aspire Wireless headset on **27/02/2026**, and
I've recently run into an issue with the microphone.

A small plastic piece on the microphone, shaped like a
gem/diamond, has broken off.`;

Deno.test("real contact-form body: clean name, clean single order number", () => {
  const identity = parseShopifyContactIdentity({
    fromEmail: "mailer@shopify.com",
    subject: "New customer message on 6 July 2026 at 9.44 pm",
    bodyText: REAL_T051002_BODY,
  });
  assertEquals(identity.detected, true);
  assertEquals(identity.customerName, "Mark Brandt");
  assertEquals(identity.customerEmail, "marc452c@outlook.dk");
  assertEquals(extractContactFormOrderNumbers(identity), ["3955"]);
});
