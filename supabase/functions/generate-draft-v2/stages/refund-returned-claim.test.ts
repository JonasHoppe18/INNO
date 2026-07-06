import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildRefundStatusDirective,
  customerClaimsReturned,
} from "./writer.ts";
import type { RefundStatus } from "./fact-resolver.ts";

const mk = (state: RefundStatus["state"], extra: Partial<RefundStatus> = {}): RefundStatus => ({
  state,
  total_refunded: "40.00",
  currency: "DKK",
  last_refund_at: "2026-06-01T10:00:00Z",
  order_total: "100.00",
  refund_count: 1,
  ...extra,
});

// 1. full-refund-issued wording remains unchanged (returned-claim must not alter it)
Deno.test("full_refund_issued directive identical regardless of returned-claim flag", () => {
  const a = buildRefundStatusDirective(mk("full_refund_issued"));
  const b = buildRefundStatusDirective(mk("full_refund_issued"), { customerClaimsReturned: true });
  assertEquals(a, b);
  assertStringIncludes(a.toLowerCase(), "hele beløbet er refunderet");
  assertStringIncludes(a.toLowerCase(), "betalingsudbyder");
});

// 2. partial-refund-issued wording remains safe + unchanged by the flag
Deno.test("partial_refund_issued directive unchanged by returned-claim flag", () => {
  const a = buildRefundStatusDirective(mk("partial_refund_issued"));
  const b = buildRefundStatusDirective(mk("partial_refund_issued"), { customerClaimsReturned: true });
  assertEquals(a, b);
  assertStringIncludes(a.toLowerCase(), "restbeløb");
});

// 3. no refund + customer did NOT mention returning → no receipt assumption,
//    no tracking-number ask (plain no-refund wording)
Deno.test("no_refund without returned-claim: no receipt assumption, invites contact if returned", () => {
  const d = buildRefundStatusDirective(mk("no_refund_issued", { total_refunded: "0.00", refund_count: 0 })).toLowerCase();
  assertStringIncludes(d, "ingen refundering");
  assert(!d.includes("modtaget") || d.includes("antag ikke")); // never asserts received
});

// 4–10. no refund + customer says returned
Deno.test("no_refund + customer claims returned → safe acknowledgement directive", () => {
  const d = buildRefundStatusDirective(
    mk("no_refund_issued", { total_refunded: "0.00", refund_count: 0 }),
    { customerClaimsReturned: true },
  ).toLowerCase();

  // 4. acknowledge the customer's statement
  assertStringIncludes(d, "kunden oplyser"); // acknowledge customer-stated return
  // 5. do not claim received
  assert(/ikke kan bekræfte[^.]*(registreret|modtaget)/.test(d), "must say receipt cannot be confirmed");
  // 6. do not claim processed
  assertStringIncludes(d, "færdig");
  // 7. do not promise notification
  assert(/lov ikke[^.]*(besked|underret|notifikation)/.test(d), "must forbid promising notification");
  // 8. do not promise timing (no day-count, no arrival promise)
  assert(!/\d+\s*(?:-\s*\d+\s*)?(?:hverdage|dage|days)/.test(d), "must not hardcode timing");
  assertStringIncludes(d, "hvornår pengene");
  // 9. ask for return tracking number or link
  assertStringIncludes(d, "tracking");
  assert(/nummer|link/.test(d), "must ask for tracking number or link");
  // tracking is asked for so the return can be matched to the order
  assertStringIncludes(d, "matches med ordren");
  // 10. must not assert return-shipping cost responsibility unless asked
  assert(!/dit ansvar|din regning|kundens ansvar/.test(d), "must not assert shipping responsibility");
  assert(/medmindre kunden/.test(d), "must gate any shipping-cost mention behind the customer asking");
  // NEW: explicitly forbid the automatic refund-workflow phrasing
  assertStringIncludes(d, "forbudte formuleringer");
  assertStringIncludes(d, "automatisk refunderings-workflow");
  // the affirmative workflow snippets appear ONLY inside the forbidden list,
  // never as an instruction to use them — assert the forbidden framing is present
  assert(/når vi modtager og behandler/.test(d), "names the forbidden 'once we receive and process' phrasing");
  assert(/vi igangsætter|igangsættes/.test(d), "names the forbidden 'we will initiate the refund' phrasing");
  // and there is no standalone affirmative promise outside the forbidden line
  const withoutForbiddenLine = d.split("\n").filter((l) => !l.includes("forbudte formuleringer")).join("\n");
  assert(!/du vil blive underrettet/.test(withoutForbiddenLine), "no standalone notification promise");
});

// 2. branch forbids the automatic refund-workflow wording (explicit list)
Deno.test("returned-claim branch forbids automatic refund-workflow wording", () => {
  const d = buildRefundStatusDirective(
    mk("no_refund_issued", { total_refunded: "0.00", refund_count: 0 }),
    { customerClaimsReturned: true },
  ).toLowerCase();
  for (const phrase of [
    "når vi modtager og behandler",
    "vi igangsætter",
    "automatisk",
    "underrettet",
    "holder øje med",
  ]) {
    assertStringIncludes(d, phrase);
  }
  // all of them must sit on the FORBUDTE line (forbidden), not as guidance
  const forbiddenLine = d.split("\n").find((l) => l.includes("forbudte formuleringer")) ?? "";
  for (const phrase of ["når vi modtager og behandler", "vi igangsætter", "underrettet", "holder øje med"]) {
    assertStringIncludes(forbiddenLine, phrase);
  }
});

// 10b. customerClaimsReturned detection
Deno.test("customerClaimsReturned detects EN and DA return statements", () => {
  for (const m of [
    "I returned my order #4478",
    "I sent it back last week",
    "Jeg har returneret varen",
    "jeg sendte den tilbage i går",
  ]) {
    assertEquals(customerClaimsReturned(m), true, m);
  }
  for (const m of [
    "Where is my refund?",
    "Has my refund been processed?",
    "Hvornår får jeg pengene?",
  ]) {
    assertEquals(customerClaimsReturned(m), false, m);
  }
});

// 11 & 12. no new endpoint / no mutation path introduced by this slice
// (this slice touches writer.ts only; assert the directive helper contains no
// network/mutation tokens).
Deno.test("refund directive helper introduces no endpoint or mutation", async () => {
  const src = await Deno.readTextFile(
    new URL("./writer.ts", import.meta.url),
  );
  const start = src.indexOf("export function buildRefundStatusDirective");
  const end = src.indexOf("export function customerClaimsReturned");
  const region = src.slice(start, end > start ? end + 400 : start + 4000);
  for (const forbidden of ["fetch(", "refunds.json", 'method: "POST"', 'method: "PUT"', 'method: "DELETE"']) {
    assert(!region.includes(forbidden), `unexpected ${forbidden}`);
  }
});
