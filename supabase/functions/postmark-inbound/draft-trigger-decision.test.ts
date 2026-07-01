import { assertEquals } from "jsr:@std/assert@1";
import { classifyInboxBucket } from "../_shared/inbox-classification.ts";
import { shouldTriggerDraftGeneration } from "./draft-trigger-decision.ts";

Deno.test("shouldTriggerDraftGeneration suppresses draft generation for notification-bucket emails", () => {
  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: "notification",
  });
  assertEquals(result, false);
});

Deno.test("shouldTriggerDraftGeneration regression: real GLS delivery notification (draft 10243) is suppressed", () => {
  const inboxClassification = classifyInboxBucket({
    from: "noreply@gls-group.eu",
    subject: "Vi leverer snart din pakke fra ACEZONE ApS acezone",
    body:
      "Hej ACEZONE INTERNATIONAL ApS\n\nVi glæder os til at levere din pakke 055463247172 " +
      "(https://gls-group.eu/track/YO0IZ8BX) fra ACEZONE ApS acezone, som vil blive sendt så snart vi modtager den.",
  });

  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: inboxClassification.bucket,
  });

  assertEquals(inboxClassification.bucket, "notification");
  assertEquals(result, false);
});

Deno.test("shouldTriggerDraftGeneration allows a generic no-reply/system notification to be suppressed", () => {
  const inboxClassification = classifyInboxBucket({
    from: "noreply@some-random-shipping-service.example",
    subject: "Your order has shipped",
    body: "This is an automated shipping confirmation. Your package has shipped and is on the way.",
  });

  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: inboxClassification.bucket,
  });

  assertEquals(inboxClassification.bucket, "notification");
  assertEquals(result, false);
});

Deno.test("shouldTriggerDraftGeneration still allows draft generation for a real customer mentioning GLS in the body", () => {
  const inboxClassification = classifyInboxBucket({
    from: "anna.jensen@gmail.com",
    subject: "Hvor er min pakke?",
    body: "Hej, GLS siger min pakke er leveret, men jeg har ikke modtaget noget. Kan I hjælpe?",
  });

  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: inboxClassification.bucket,
  });

  assertEquals(inboxClassification.bucket, "ticket");
  assertEquals(result, true);
});

Deno.test("shouldTriggerDraftGeneration respects autoDraftEnabled and isEffectiveSupport independently of the notification bucket", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: false,
      isEffectiveSupport: true,
      notificationBucket: "ticket",
    }),
    false,
  );
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: false,
      notificationBucket: "ticket",
    }),
    false,
  );
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: true,
      notificationBucket: "ticket",
    }),
    true,
  );
});
