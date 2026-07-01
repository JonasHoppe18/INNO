import { assertEquals } from "jsr:@std/assert@1";
import { classifyInboxBucket } from "../_shared/inbox-classification.ts";
import {
  isSuppressionEligibleNotificationReason,
  shouldTriggerDraftGeneration,
} from "./draft-trigger-decision.ts";

// A. GLS regression still suppressed
Deno.test("shouldTriggerDraftGeneration regression: real GLS delivery notification (draft 10243) is suppressed", () => {
  const inboxClassification = classifyInboxBucket({
    from: "noreply@gls-group.eu",
    subject: "Vi leverer snart din pakke fra ACEZONE ApS acezone",
    body:
      "Hej ACEZONE INTERNATIONAL ApS\n\nVi glæder os til at levere din pakke 055463247172 " +
      "(https://gls-group.eu/track/YO0IZ8BX) fra ACEZONE ApS acezone, som vil blive sendt så snart vi modtager den.",
  });

  assertEquals(inboxClassification.bucket, "notification");
  assertEquals(inboxClassification.reason, "carrier_notification_domain");

  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: inboxClassification.bucket,
    notificationReason: inboxClassification.reason,
  });

  assertEquals(result, false);
});

Deno.test("shouldTriggerDraftGeneration suppresses a direct carrier_notification_domain reason", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: true,
      notificationBucket: "notification",
      notificationReason: "carrier_notification_domain",
    }),
    false,
  );
});

// B. Hard notification still suppressed
Deno.test("shouldTriggerDraftGeneration suppresses a hard header/machine-structure notification reason", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: true,
      notificationBucket: "notification",
      notificationReason: "header:feedback-id,machine_like_structure",
    }),
    false,
  );
});

// C. Manual move still suppressed
Deno.test("shouldTriggerDraftGeneration suppresses manual_move_to_notifications", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: true,
      notificationBucket: "notification",
      notificationReason: "manual_move_to_notifications",
    }),
    false,
  );
});

// D. Human-support false positive NOT suppressed
Deno.test("shouldTriggerDraftGeneration does not suppress a human_support_intent notification false positive", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: true,
      notificationBucket: "notification",
      notificationReason: "transactional_language,human_support_intent",
    }),
    true,
  );
});

Deno.test("shouldTriggerDraftGeneration regression: real customer thread (93063557) previously drafted is not suppressed", () => {
  const inboxClassification = classifyInboxBucket({
    from: "jules.perrelet@hotmail.com",
    subject: "Re: [AceZone] Re: New customer message on 31 May 2026 at 12:32",
    body:
      "Hi, Thanks for your answer. I understand that the headset was bought from another store. " +
      "If needed I'll contact them but it will probably be a long and complex process. " +
      "I'll have to ship it back, then they will send it back to you, you'll have to fix it and send it back to me.",
  });

  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: inboxClassification.bucket,
    notificationReason: inboxClassification.reason,
  });

  assertEquals(result, true);
});

// E. Another human-support false positive NOT suppressed, unless isEffectiveSupport is false
Deno.test("shouldTriggerDraftGeneration does not suppress auto_sender_pattern + human_support_intent when isEffectiveSupport is true", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: true,
      notificationBucket: "notification",
      notificationReason: "auto_sender_pattern,transactional_language,human_support_intent",
    }),
    true,
  );
});

Deno.test("shouldTriggerDraftGeneration suppresses auto_sender_pattern + human_support_intent when isEffectiveSupport is false", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: false,
      notificationBucket: "notification",
      notificationReason: "auto_sender_pattern,transactional_language,human_support_intent",
    }),
    false,
  );
});

// F. Normal support still allowed
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
    notificationReason: inboxClassification.reason,
  });

  assertEquals(inboxClassification.bucket, "ticket");
  assertEquals(result, true);
});

Deno.test("shouldTriggerDraftGeneration allows a generic no-reply/system notification to be suppressed when reason is suppression-eligible", () => {
  const inboxClassification = classifyInboxBucket({
    from: "noreply@some-random-shipping-service.example",
    subject: "Your order has shipped",
    body: "This is an automated shipping confirmation. Your package has shipped and is on the way.",
  });

  assertEquals(inboxClassification.bucket, "notification");

  const result = shouldTriggerDraftGeneration({
    autoDraftEnabled: true,
    isEffectiveSupport: true,
    notificationBucket: inboxClassification.bucket,
    notificationReason: inboxClassification.reason,
  });

  assertEquals(result, !isSuppressionEligibleNotificationReason(inboxClassification.reason));
});

// G. autoDraftEnabled / isEffectiveSupport still win regardless of reason
Deno.test("shouldTriggerDraftGeneration respects autoDraftEnabled and isEffectiveSupport independently of notification reason", () => {
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: false,
      isEffectiveSupport: true,
      notificationBucket: "notification",
      notificationReason: "transactional_language,human_support_intent",
    }),
    false,
  );
  assertEquals(
    shouldTriggerDraftGeneration({
      autoDraftEnabled: true,
      isEffectiveSupport: false,
      notificationBucket: "notification",
      notificationReason: "transactional_language,human_support_intent",
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

Deno.test("isSuppressionEligibleNotificationReason: hard reasons are eligible, human_support_intent reasons are not", () => {
  assertEquals(isSuppressionEligibleNotificationReason("carrier_notification_domain"), true);
  assertEquals(isSuppressionEligibleNotificationReason("sender_rule_override:5912d253-161f-4099-bdac-644b31bbf610"), true);
  assertEquals(isSuppressionEligibleNotificationReason("manual_move_to_notifications"), true);
  assertEquals(isSuppressionEligibleNotificationReason("header:feedback-id,machine_like_structure"), true);
  assertEquals(
    isSuppressionEligibleNotificationReason(
      "auto_sender_pattern,header:x-auto-response-suppress,header:feedback-id,transactional_language",
    ),
    true,
  );
  assertEquals(isSuppressionEligibleNotificationReason("transactional_language,human_support_intent"), false);
  assertEquals(
    isSuppressionEligibleNotificationReason(
      "auto_sender_pattern,transactional_language,human_support_intent",
    ),
    false,
  );
  assertEquals(isSuppressionEligibleNotificationReason(""), false);
  assertEquals(isSuppressionEligibleNotificationReason(undefined), false);
  assertEquals(isSuppressionEligibleNotificationReason(null), false);
});
