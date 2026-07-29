import { assertEquals } from "jsr:@std/assert@1";
import { resolveActionConfirmationStage } from "./pipeline.ts";

// Live case (2026-07-29): a post-action cancel_order confirmation on a PAID
// order still read as a flat log line — "Din ordre #1059 er annulleret; den
// var endnu ikke afsendt." — with no mention of the money, DESPITE:
//   1. refundStatusBlock now firing for paid cancellations,
//   2. RESOLUTION_STAGE_DIRECTIVES.cancel_order rewritten for colleague tone,
//   3. buildCoreRulesB/buildCompactCoreRules no longer blocking refund mention.
//
// Root cause: every postActionResult confirmation forces
// `resolution_stage: "info_only"` regardless of action type, so the writer
// never actually sees the improved cancel_order stage directive — "info_only"
// ("besvar kundens konkrete spørgsmål... ingen handlingssti") is what it read
// instead. The three fixes above were real but silenced by this stage
// override sitting downstream of all of them.

Deno.test("a cancelled order confirmation gets the cancel_order stage, not info_only", () => {
  assertEquals(resolveActionConfirmationStage("cancel_order"), "cancel_order");
});

Deno.test("action types without a dedicated stage directive fall back to info_only", () => {
  // update_shipping_address, get_order etc. have no bespoke tone directive —
  // info_only remains the correct, safe default for them.
  assertEquals(resolveActionConfirmationStage("update_shipping_address"), "info_only");
  assertEquals(resolveActionConfirmationStage("get_order"), "info_only");
});

Deno.test("an unrecognised action type falls back to info_only", () => {
  assertEquals(resolveActionConfirmationStage("some_future_action"), "info_only");
});
