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
