import { assertEquals } from "jsr:@std/assert@1";
import {
  addReviewReason,
  severityFor,
  summarizeReviewReasons,
} from "./review-reasons.ts";

// Measured 2026-07-29: all 14 test drafts carried routing_hint "review". The
// cause is not over-flagging — it is that routing_hint answers "may this be
// sent automatically?", and with auto_send_intents empty the answer is always
// no. Guards that escalate to "review" therefore write their signal into a
// field that is already saturated, and it is lost.
//
// These reasons are the guards' own channel: they survive independently, and
// severity is what separates a routine manual-mode review from a real problem.

Deno.test("the saturating manual-mode reason is routine, not a warning", () => {
  assertEquals(severityFor("auto_send_intent_not_enabled"), "routine");
});

Deno.test("guard violations outrank routine reasons", () => {
  assertEquals(severityFor("return_granted_outside_window"), "danger");
  assertEquals(severityFor("unsupported_refund_promise"), "danger");
  assertEquals(severityFor("verifier_block_send"), "danger");
});

Deno.test("low verifier confidence is caution, not danger", () => {
  assertEquals(
    severityFor("verifier_confidence_below_auto_send_threshold"),
    "caution",
  );
});

Deno.test("an unrecognised code is treated as caution rather than ignored", () => {
  // A new guard that forgets to register its code must not silently downgrade
  // to routine — that is how signals get lost in the first place.
  assertEquals(severityFor("some_future_guard_code"), "caution");
});

Deno.test("reasons are deduplicated", () => {
  const reasons: ReturnType<typeof addReviewReason> = [];
  let acc = addReviewReason(reasons, "auto_send_intent_not_enabled");
  acc = addReviewReason(acc, "auto_send_intent_not_enabled");

  assertEquals(acc.length, 1);
});

Deno.test("summary reports the highest severity present", () => {
  let acc = addReviewReason([], "auto_send_intent_not_enabled");
  acc = addReviewReason(acc, "verifier_confidence_below_auto_send_threshold");
  acc = addReviewReason(acc, "return_granted_outside_window", "146 dage vs 30 dage");

  const summary = summarizeReviewReasons(acc);
  assertEquals(summary.highest, "danger");
  assertEquals(summary.codes, [
    "auto_send_intent_not_enabled",
    "verifier_confidence_below_auto_send_threshold",
    "return_granted_outside_window",
  ]);
});

Deno.test("a draft flagged only for manual mode is not treated as risky", () => {
  // This is the whole point: the routine case must be distinguishable from a
  // genuine guard hit, which routing_hint alone could not express.
  const summary = summarizeReviewReasons(
    addReviewReason([], "auto_send_intent_not_enabled"),
  );

  assertEquals(summary.highest, "routine");
  assertEquals(summary.has_guard_violation, false);
});

Deno.test("a guard hit is reported as a violation", () => {
  const summary = summarizeReviewReasons(
    addReviewReason(
      addReviewReason([], "auto_send_intent_not_enabled"),
      "return_granted_outside_window",
    ),
  );

  assertEquals(summary.has_guard_violation, true);
});

Deno.test("detail is carried through for diagnosis", () => {
  const acc = addReviewReason([], "return_granted_outside_window", "146 dage vs 30 dage");
  assertEquals(acc[0].detail, "146 dage vs 30 dage");
});

Deno.test("no reasons summarises as routine with no violation", () => {
  const summary = summarizeReviewReasons([]);
  assertEquals(summary.highest, "routine");
  assertEquals(summary.has_guard_violation, false);
  assertEquals(summary.codes, []);
});
