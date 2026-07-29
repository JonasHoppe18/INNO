import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildReturnWindowFact, checkReturnWindow } from "./return-window-check.ts";
import type { RetrievedChunk } from "./retriever.ts";

// Regression tests for the C5 finding (2026-07-28): a return on order #1051 —
// placed five months earlier — was granted with full return instructions. The
// order-age fact was supplied and told the writer not to promise return rights
// without a documented policy, but retrieval had surfaced the chunk holding the
// return ADDRESS rather than the one holding the 30-day window, and the writer
// granted the return anyway. Prose directives are not a boundary.

function chunk(content: string, usable_as: RetrievedChunk["usable_as"] = "policy"): RetrievedChunk {
  return {
    id: "c1",
    content,
    kind: "document",
    source_label: "shopify_policy: Refund policy",
    similarity: 0.8,
    usable_as,
    risk_flags: [],
  } as RetrievedChunk;
}

const GRANTS_RETURN_DA =
  "Hej Jonas,\n\nJeg igangsætter returprocessen for din Hybrid Dyne fra ordre #1051. " +
  "Send venligst pakken til Øster Allé 56, 2100 København Ø. Husk at inkludere ordrenummeret.";

const POLICY_30_DAYS = chunk(
  "REFUNDS If you're looking to return your newly purchased product, the shop offers a " +
    "30-day return policy. Products must be unused and in sealed packaging.",
);

// The chunk retrieval actually surfaced in C5 — return address, no window.
const POLICY_ADDRESS_ONLY = chunk(
  "any courier which ships directly to our office address) and tape it securely to the " +
    "face of the shipping package. Please address it to: Nordre Fasanvej 113, 2000 Frederiksberg.",
);

Deno.test("return granted well outside the documented window is flagged", () => {
  const result = checkReturnWindow({
    draft_text: GRANTS_RETURN_DA,
    order_age_days: 146,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assertEquals(result.compliant, false);
  assert(result.requires_review);
  assertEquals(result.violations[0].type, "return_granted_outside_window");
  assertEquals(result.violations[0].documented_window_days, 30);
  assertEquals(result.violations[0].order_age_days, 146);
});

Deno.test("return granted inside the documented window is left alone", () => {
  const result = checkReturnWindow({
    draft_text: GRANTS_RETURN_DA,
    order_age_days: 12,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assertEquals(result.compliant, true);
  assertEquals(result.violations, []);
});

Deno.test("granting a return with no documented window at all is flagged", () => {
  // Exactly the C5 situation: the only retrieved policy chunk carries the
  // return address and says nothing about how long the customer has.
  const result = checkReturnWindow({
    draft_text: GRANTS_RETURN_DA,
    order_age_days: 146,
    retrieved_chunks: [POLICY_ADDRESS_ONLY],
  });

  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "return_granted_without_documented_window");
});

Deno.test("the longest documented window wins when several are stated", () => {
  // The real policy states both a 14-day statutory right of regret and a
  // 30-day money-back guarantee. Flagging against the shorter one would reject
  // returns the shop actually honours.
  const both = chunk(
    "Private individuals have the right to regret the purchase within 14 days without " +
      "stating reasons. However, we offer a 30-days money-back guarantee.",
  );

  const inside = checkReturnWindow({
    draft_text: GRANTS_RETURN_DA,
    order_age_days: 20,
    retrieved_chunks: [both],
  });
  assertEquals(inside.compliant, true);

  const outside = checkReturnWindow({
    draft_text: GRANTS_RETURN_DA,
    order_age_days: 40,
    retrieved_chunks: [both],
  });
  assertEquals(outside.violations[0].documented_window_days, 30);
});

Deno.test("a draft that does not grant a return is never flagged", () => {
  const declines =
    "Hej Jonas,\n\nOrdre #1051 er fra 5. marts, så den ligger uden for vores returvindue. " +
    "Jeg kan desværre ikke tage den retur.";

  const result = checkReturnWindow({
    draft_text: declines,
    order_age_days: 146,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assertEquals(result.compliant, true);
});

Deno.test("unknown order age yields no verdict", () => {
  // Without an order we cannot date the purchase, and guessing would produce
  // false positives on every guest enquiry.
  const result = checkReturnWindow({
    draft_text: GRANTS_RETURN_DA,
    order_age_days: null,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assertEquals(result.compliant, true);
});

Deno.test("English return grants are caught too", () => {
  const english =
    "Hi Jonas,\n\nI'm starting the return process for your order #1051. " +
    "Please send the package to Nordre Fasanvej 113, 2000 Frederiksberg.";

  const result = checkReturnWindow({
    draft_text: english,
    order_age_days: 146,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "return_granted_outside_window");
});

Deno.test("a hedged mention of returns is not a grant", () => {
  // Asking whether the customer wants a return, or explaining that one may be
  // possible, must not trip the check — only an actual grant does.
  const hedged =
    "Hej Jonas,\n\nVil du have mig til at undersøge om ordre #1051 kan returneres? " +
    "Så tjekker jeg vores returpolitik for dig.";

  const result = checkReturnWindow({
    draft_text: hedged,
    order_age_days: 146,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assertEquals(result.compliant, true);
});

// The check above is a backstop. The real cause of C5 was that the writer had
// to find the window in retrieved prose AND do date arithmetic — two things
// models are unreliable at. These tests cover computing the verdict
// deterministically and handing it to the writer as a stated fact.

Deno.test("fact states the verdict when the order is outside the window", () => {
  const fact = buildReturnWindowFact({
    order_age_days: 146,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assert(fact, "expected a fact");
  assertEquals(fact.label, "Returvindue");
  assertStringIncludes(fact.value, "146");
  assertStringIncludes(fact.value, "30");
  assertStringIncludes(fact.value, "UDEN FOR");
});

Deno.test("fact states the verdict when the order is inside the window", () => {
  const fact = buildReturnWindowFact({
    order_age_days: 12,
    retrieved_chunks: [POLICY_30_DAYS],
  });

  assert(fact);
  assertStringIncludes(fact.value, "INDEN FOR");
  assert(
    !/UDEN FOR/.test(fact.value),
    "an in-window order must not also be described as outside",
  );
});

Deno.test("fact withholds a verdict when no window is documented", () => {
  const fact = buildReturnWindowFact({
    order_age_days: 146,
    retrieved_chunks: [POLICY_ADDRESS_ONLY],
  });

  assert(fact);
  // Must not invent a window, but must still stop the writer granting one.
  assert(!/UDEN FOR|INDEN FOR/.test(fact.value));
  assertStringIncludes(fact.value, "146");
  assert(
    /lov (?:aldrig|ikke)/i.test(fact.value),
    `fact must forbid promising a return, got: ${fact.value}`,
  );
});

Deno.test("no fact without an order age", () => {
  assertEquals(
    buildReturnWindowFact({ order_age_days: null, retrieved_chunks: [POLICY_30_DAYS] }),
    null,
  );
});
