// Run: node --test apps/web/lib/server/eval-anchor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAnchor } from "./eval-anchor.js";

// Fixtures distilled from the 2026-06-03 AceZone pilot run (paraphrased,
// PII-free). Each asserts the class the eval harness must assign.

const NON_COMPARABLE = [
  // pilot 294 — agent created a shipment
  "Hi again,\n\nI have now created the shipment; 770012345 Sent with FedEx.\n\nHave a great day.",
  // pilot 274 — agent made the shipment ready with carrier tracking
  "Hello,\n\nI have made the shipment ready with the PostNord tracking info: 0457\n\nBest regards,",
  // pilot 129 — agent activated a discount code
  "Hi there,\n\nThe code WELCOME40 is now active for you to use. Have a lovely day!",
  // pilot 196 — refund already issued via gift card
  "Hi again,\n\nThe refund was sent to you via a Gift Card by Amazon, so your refund stands.",
  // pilot 302 — agent commits to sending a replacement + tracking link to follow
  "Hej,\n\nDa det er en garantisag, sender vi dig et nyt. Jeg vender tilbage med et tracking link.",
];

const ACTION_REQUIRED = [
  // pilot 281 — agent needs bank credentials to do a transfer
  "Hi again,\n\nCould you provide your SWIFT / IBAN so we can get a transfer going?",
  // pilot 297 — agent needs the identity block to create a shipment + invoice
  "Hi there,\n\nCould you please provide me with the following information:\nFull name\nFull address (postal code important)\nPhone\nEmail",
];

const COMPARABLE = [
  // pilot 287 — a normal informational CS reply
  "Hi again,\n\nYes, the A-Spire (Wired) model supports Bluetooth connection. It is meant for music and mobile use; we do not recommend it for gaming.",
  // ordinary product-support reply, mentions a common word ("bring") that must NOT trip the carrier heuristic
  "Hi,\n\nPlease bring the headset close to the dongle and try pairing again, then let me know if it connects.",
  "", // empty reply defaults to comparable
];

test("non_comparable_anchor: completed action confirmations", () => {
  for (const humanReply of NON_COMPARABLE) {
    const { anchor_class, signals } = classifyAnchor({ humanReply });
    assert.equal(anchor_class, "non_comparable_anchor", `expected non_comparable for: ${humanReply.slice(0, 50)}`);
    assert.ok(signals.length > 0, "non-comparable must record a signal");
  }
});

test("action_required: out-of-band info/credential requests", () => {
  for (const humanReply of ACTION_REQUIRED) {
    const { anchor_class } = classifyAnchor({ humanReply });
    assert.equal(anchor_class, "action_required", `expected action_required for: ${humanReply.slice(0, 50)}`);
  }
});

test("comparable: ordinary CS replies (no false positives)", () => {
  for (const humanReply of COMPARABLE) {
    const { anchor_class } = classifyAnchor({ humanReply });
    assert.equal(anchor_class, "comparable", `expected comparable for: ${humanReply.slice(0, 50)}`);
  }
});

test("missing/blank input is comparable", () => {
  assert.equal(classifyAnchor({}).anchor_class, "comparable");
  assert.equal(classifyAnchor().anchor_class, "comparable");
});
