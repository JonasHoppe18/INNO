import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildServiceRecoveryDirective,
  detectsBrokenDispatchComplaint,
  factsConfirmUnshipped,
} from "./service-recovery.ts";
import type { ResolvedFact } from "./fact-resolver.ts";

// Real-world shape (T-Malte 2026-07-14): customer cites the shop's own
// "ships within 24 hours" promise, order is confirmed unshipped. The draft
// must own the miss — not deflect with template empathy.

const MALTE_MESSAGE =
  "Hej. På jeres hjemmeside står der, at I sender inden for 24 timer. " +
  "Det er nu over et døgn siden – faktisk snart to – og når jeg tracker min pakke, " +
  "kan jeg se, at der stadig ikke er sket noget. Den ser derfor ikke engang ud til " +
  "at være blevet afsendt. Kan I venligst undersøge, hvad status er på min ordre?";

const UNSHIPPED_FACTS: ResolvedFact[] = [
  { label: "Ordre fundet", value: "#1234 — Status: Ikke afsendt endnu, Betaling: paid" },
  { label: "Tracking", value: "Ordren er endnu ikke afsendt" },
];

const SHIPPED_FACTS: ResolvedFact[] = [
  { label: "Ordre fundet", value: "#1234 — Status: Afsendt (alle varer er afsendt), Betaling: paid" },
  { label: "Tracking (fragtmand)", value: "GLS — Sporingsnummer: 123 — Pakke-status fra Shopify: Undervejs" },
];

Deno.test("detects Danish broken-dispatch-promise complaint", () => {
  assertEquals(detectsBrokenDispatchComplaint(MALTE_MESSAGE), true);
});

Deno.test("detects English broken-dispatch-promise complaint", () => {
  assertEquals(
    detectsBrokenDispatchComplaint(
      "Your website says you ship within 24 hours. It's been 3 days and tracking still shows nothing — my order has not been shipped.",
    ),
    true,
  );
});

Deno.test("neutral status question is NOT a broken-promise complaint", () => {
  assertEquals(
    detectsBrokenDispatchComplaint("Hej, kan I give mig en opdatering på min ordre #1234?"),
    false,
  );
  assertEquals(detectsBrokenDispatchComplaint(""), false);
  assertEquals(detectsBrokenDispatchComplaint(null), false);
});

Deno.test("factsConfirmUnshipped reads the resolver's unshipped signals", () => {
  assertEquals(factsConfirmUnshipped(UNSHIPPED_FACTS), true);
  assertEquals(factsConfirmUnshipped(SHIPPED_FACTS), false);
  assertEquals(factsConfirmUnshipped([]), false);
});

Deno.test("directive fires only when complaint AND facts agree", () => {
  const fired = buildServiceRecoveryDirective({
    latestCustomerMessage: MALTE_MESSAGE,
    facts: UNSHIPPED_FACTS,
  });
  assert(fired.length > 0, "expected directive to fire");

  assertEquals(
    buildServiceRecoveryDirective({
      latestCustomerMessage: MALTE_MESSAGE,
      facts: SHIPPED_FACTS,
    }),
    "",
  );
  assertEquals(
    buildServiceRecoveryDirective({
      latestCustomerMessage: "Kan I give mig en opdatering på min ordre?",
      facts: UNSHIPPED_FACTS,
    }),
    "",
  );
});

Deno.test("directive demands acknowledgment, one apology, tracking explanation, concrete commitment", () => {
  const d = buildServiceRecoveryDirective({
    latestCustomerMessage: MALTE_MESSAGE,
    facts: UNSHIPPED_FACTS,
  }).toLowerCase();

  // own the miss: explicit acknowledgment of the customer's observation
  assertStringIncludes(d, "anerkend");
  assertStringIncludes(d, "du har helt ret");
  // apologize exactly once — the example sentence must model the apology,
  // otherwise the writer copies the example verbatim and skips it
  // (observed in live replay 2026-07-14)
  assertStringIncludes(d, "beklag");
  assertStringIncludes(d, "én gang");
  assertStringIncludes(d, "det beklager jeg");
  // tracking isn't broken — explain scan timing
  assertStringIncludes(d, "scannet");
  // template empathy + "men" is banned
  assertStringIncludes(d, "jeg forstår, at det kan være frustrerende");
  // "hurtigst muligt" must never stand alone as the next step
  assertStringIncludes(d, "hurtigst muligt");
  // never invent a new dispatch date/ETA
  assertStringIncludes(d, "eta");
});
