import { assertEquals } from "jsr:@std/assert";
import {
  checkUnsupportedAssumptions,
  hasExplicitGiftContext,
} from "./unsupported-assumption-check.ts";

// The reported bad case: third-party purchase, order + item number + photos
// provided, NO gift wording anywhere.
const THIRD_PARTY_NO_GIFT =
  "Bought through Power.dk. Order number 225483933. Item number 3704913. " +
  "Pictures attached. The headset has a crack and the plastic is splitting.";

Deno.test("1. third-party purchase without gift context: gift assumption is flagged", () => {
  const draft =
    "Hi Magnus,\n\nPlease provide the name and email or order number from the " +
    "person who gifted it to you.\n\nKind regards,\nAceZone Support";
  const result = checkUnsupportedAssumptions({
    draft_text: draft,
    conversation_text: THIRD_PARTY_NO_GIFT,
  });
  assertEquals(result.requires_review, true);
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "ungrounded_gift_assumption");
});

Deno.test("1b. compliant third-party draft (acknowledges details, no gift) passes", () => {
  const draft =
    "Hi Magnus,\n\nThank you for sending the order details and the photos. " +
    "Since the headset was purchased through Power.dk, the warranty claim will " +
    "usually need to be handled through the retailer where it was purchased.\n\n" +
    "Kind regards,\nAceZone Support";
  const result = checkUnsupportedAssumptions({
    draft_text: draft,
    conversation_text: THIRD_PARTY_NO_GIFT,
  });
  assertEquals(result.requires_review, false);
  assertEquals(result.compliant, true);
});

Deno.test("2. explicit gift context: gift wording in draft is grounded, not flagged", () => {
  const draft =
    "Could you share the order number from the person who gifted it to you?";
  const result = checkUnsupportedAssumptions({
    draft_text: draft,
    conversation_text: "It was a gift and I don't have the receipt.",
  });
  assertEquals(result.requires_review, false);
  assertEquals(result.compliant, true);
});

Deno.test("2b. Danish explicit gift context grounds the assumption", () => {
  const draft = "Kan du oplyse ordrenummeret fra den der gav dig produktet?";
  const result = checkUnsupportedAssumptions({
    draft_text: draft,
    conversation_text: "Det var en gave fra min bror.",
  });
  assertEquals(result.requires_review, false);
});

Deno.test("3. 'original purchaser' ask without gift context is flagged", () => {
  const result = checkUnsupportedAssumptions({
    draft_text: "We need the details of the original purchaser to proceed.",
    conversation_text: THIRD_PARTY_NO_GIFT,
  });
  assertEquals(result.requires_review, true);
});

Deno.test("4. ordinary warranty draft with no gift wording passes", () => {
  const draft =
    "Thank you for the order number and photos. We will review the warranty " +
    "case and follow up with the next step.";
  const result = checkUnsupportedAssumptions({
    draft_text: draft,
    conversation_text: THIRD_PARTY_NO_GIFT,
  });
  assertEquals(result.requires_review, false);
  assertEquals(result.compliant, true);
});

Deno.test("5. 'gift card' alone is not treated as gift context", () => {
  // A gift-card mention must NOT ground a gift-product assumption.
  assertEquals(hasExplicitGiftContext("My gift card balance is wrong."), false);
  assertEquals(hasExplicitGiftContext("It was a gift."), true);
  assertEquals(hasExplicitGiftContext(THIRD_PARTY_NO_GIFT), false);
});

Deno.test("empty draft is compliant", () => {
  const result = checkUnsupportedAssumptions({
    draft_text: "",
    conversation_text: THIRD_PARTY_NO_GIFT,
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});
