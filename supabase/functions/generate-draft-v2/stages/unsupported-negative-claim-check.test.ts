// deno test --no-check --allow-read supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkUnsupportedNegativeClaims } from "./unsupported-negative-claim-check.ts";

// ── MUST trigger (ungrounded negative claims) ─────────────────────────────

Deno.test("ungrounded EN compatibility claim (IEM + Sound Card / PS5) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "No, IEM + Sound Card is not compatible with PS5.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations.length, 1);
  assertEquals(result.violations[0].type, "unsupported_negative_compatibility_claim");
});

Deno.test("ungrounded EN fit claim (A-Blaze ear pads / A-Spire) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "A-Blaze ear pads do not fit A-Spire.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_fit_claim");
});

Deno.test("ungrounded EN availability claim (A-Rise / black) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "A-Rise is not available in black.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_availability_claim");
});

Deno.test("ungrounded EN purchasability claim (replacement ear pads) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "You cannot buy replacement ear pads.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_purchasability_claim");
});

Deno.test("ungrounded EN generic compatibility claim (that accessory) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "That accessory is not compatible.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_compatibility_claim");
});

Deno.test("ungrounded DA fit claim (Det passer ikke) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Det passer ikke.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_fit_claim");
});

Deno.test("ungrounded DA compatibility claim (Det er ikke kompatibelt) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Det er ikke kompatibelt.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_compatibility_claim");
});

Deno.test("ungrounded DA purchasability claim (Det kan ikke købes) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Det kan ikke købes.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_purchasability_claim");
});

Deno.test("ungrounded DA purchasability claim (Vi sælger ikke den reservedel) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Vi sælger ikke den reservedel.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_purchasability_claim");
});

Deno.test("ungrounded DA availability claim (Den findes ikke i sort) → review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Den findes ikke i sort.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_availability_claim");
});

// ── MUST be allowed (grounded negative claims) ────────────────────────────

Deno.test("grounded compatibility claim via structured provenance → allowed", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "No, IEM + Sound Card is not compatible with PS5.",
    structured_facts: [
      {
        type: "compatibility",
        key: "playstation:usb",
        value: "NOT compatible. Reason: no PS5 driver support.",
        confidence: "confirmed",
        origin_table: "shop_product_compatibility",
      },
    ],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
  assertEquals(result.violations.length, 0);
});

Deno.test("grounded availability claim via live out_of_stock fact → allowed", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "A-Rise is not available in black right now.",
    facts: [
      {
        label: "Live stock availability",
        value: "state=out_of_stock;product=A-Rise;variant=black",
      },
    ],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

Deno.test("grounded purchasability claim via live discontinued fact → allowed", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "You cannot buy that variant anymore.",
    facts: [
      {
        label: "Live stock availability",
        value: "state=discontinued;product=A-Rise",
      },
    ],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

Deno.test("grounded purchasability claim via live unavailable fact → allowed", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Det kan ikke købes lige nu.",
    facts: [
      {
        label: "Live stock availability",
        value: "state=unavailable;product=A-Rise",
      },
    ],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

Deno.test("grounded compatibility claim via retrieved chunk wording → allowed", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "A-Blaze ear pads do not fit A-Spire.",
    retrieved_chunks: [
      {
        id: "c1",
        content: "A-Blaze ear pads are not compatible with the A-Spire headset shell.",
        kind: "text",
        source_label: "shopify_page",
        similarity: 0.9,
        usable_as: "policy",
        risk_flags: [],
        applies_to_all_products: false,
        chunk_issue_types: [],
      },
    ],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

Deno.test("grounded DA claim via retrieved chunk wording (kan ikke købes) → allowed", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Reservedel kan ikke købes separat.",
    retrieved_chunks: [
      {
        id: "c1",
        content: "Reservedel sælges ikke separat og kan ikke købes uden hele sættet.",
        kind: "text",
        source_label: "shopify_page",
        similarity: 0.9,
        usable_as: "policy",
        risk_flags: [],
        applies_to_all_products: false,
        chunk_issue_types: [],
      },
    ],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

// ── Boundary: unrelated chunk must NOT ground the claim ───────────────────

Deno.test("unrelated retrieved chunk (no shared content token) does NOT ground the claim → still review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "A-Blaze ear pads do not fit A-Spire.",
    retrieved_chunks: [
      {
        id: "c1",
        content: "Our return window is not compatible with international orders over 90 days.",
        kind: "text",
        source_label: "shopify_page",
        similarity: 0.9,
        usable_as: "policy",
        risk_flags: [],
        applies_to_all_products: false,
        chunk_issue_types: [],
      },
    ],
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_fit_claim");
});

Deno.test("chunk without negation wording does NOT ground the claim → still review", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "A-Blaze ear pads do not fit A-Spire.",
    retrieved_chunks: [
      {
        id: "c1",
        content: "A-Blaze and A-Spire are both popular headset models with soft ear pads.",
        kind: "text",
        source_label: "shopify_page",
        similarity: 0.9,
        usable_as: "policy",
        risk_flags: [],
        applies_to_all_products: false,
        chunk_issue_types: [],
      },
    ],
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
});

Deno.test("stock fact only grounds availability/purchasability, NOT compatibility claims", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "No, IEM + Sound Card is not compatible with PS5.",
    facts: [
      {
        label: "Live stock availability",
        value: "state=out_of_stock;product=IEM",
      },
    ],
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_negative_compatibility_claim");
});

// ── Neutral uncertainty phrasing must NOT be flagged ───────────────────────

Deno.test("neutral uncertainty phrasing (cannot confirm compatibility) is not flagged", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text:
      "Jeg kan ikke bekræfte kompatibiliteten ud fra informationen her, så den skal lige tjekkes manuelt.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
  assertEquals(result.violations.length, 0);
});

Deno.test("neutral uncertainty phrasing (cannot see live stock status) is not flagged", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Jeg kan ikke se lagerstatus direkte her, så jeg vil ikke love noget forkert.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
  assertEquals(result.violations.length, 0);
});

Deno.test("neutral uncertainty phrasing (must be checked manually) is not flagged", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Det skal lige tjekkes manuelt.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
  assertEquals(result.violations.length, 0);
});

// ── Misc ────────────────────────────────────────────────────────────────

Deno.test("empty draft text is compliant", () => {
  const result = checkUnsupportedNegativeClaims({ draft_text: "" });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
  assertEquals(result.violations.length, 0);
});

Deno.test("draft with no negative claims at all is compliant", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "Yes, this headset is compatible with PS5 via the USB dongle.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

Deno.test("multiple ungrounded negative claims in one draft produce multiple violations", () => {
  const result = checkUnsupportedNegativeClaims({
    draft_text: "That accessory is not compatible. Also, A-Rise is not available in black.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations.length, 2);
  assert(
    result.violations.some((v) => v.type === "unsupported_negative_compatibility_claim"),
  );
  assert(
    result.violations.some((v) => v.type === "unsupported_negative_availability_claim"),
  );
});

// ── READINESS-6d: "ikke på lager" / "udsolgt" / "out of stock" phrasing ─────
// Night-probe B11: "A-Rise er desværre ikke på lager i øjeblikket." with ZERO
// retrieved chunks and no live stock fact. The availability family only
// matched "ikke tilgængelig" / "findes ikke i", so the most common Danish
// out-of-stock phrasing sailed through ungrounded.

Deno.test("READINESS-6d: ungrounded DA 'ikke på lager' → review", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "A-Rise er desværre ikke på lager i øjeblikket.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some(
      (v) => v.type === "unsupported_negative_availability_claim",
    ),
  );
});

Deno.test("READINESS-6d: ungrounded DA 'udsolgt' → review", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Den sorte version er udsolgt.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some(
      (v) => v.type === "unsupported_negative_availability_claim",
    ),
  );
});

Deno.test("READINESS-6d: ungrounded EN 'out of stock' / 'sold out' → review", () => {
  const oos = checkUnsupportedNegativeClaims({
    draft_text: "The A-Rise is currently out of stock.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  const soldOut = checkUnsupportedNegativeClaims({
    draft_text: "The black version is sold out.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assert(
    oos.violations.some(
      (v) => v.type === "unsupported_negative_availability_claim",
    ),
  );
  assert(
    soldOut.violations.some(
      (v) => v.type === "unsupported_negative_availability_claim",
    ),
  );
});

Deno.test("READINESS-6d: 'ikke på lager' grounded by live out_of_stock fact → compliant", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "A-Rise er desværre ikke på lager i øjeblikket.",
    structured_facts: [],
    facts: [
      {
        label: "Live stock availability",
        value: "product=A-Rise; state=out_of_stock",
      },
    ],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6d: 'ikke på lager' grounded by a chunk saying the product is out of stock → compliant", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "A-Rise er desværre ikke på lager i øjeblikket.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [
      {
        id: "1",
        content: "A-Rise er ikke på lager og forventes tilbage i august.",
        usable_as: "policy",
      },
    ],
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6d: uncertainty phrasing 'jeg kan ikke se lagerstatus' stays compliant", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Jeg kan desværre ikke se lagerstatus for A-Rise herfra.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, true);
});

// ── READINESS-8: hedged "passer <adverb> ikke" fit claims ──────────────────
// Night-probe B8: "A-Blaze ear pads passer desværre ikke på A-Spire
// headsettet." with ZERO retrieved sources sailed through as compliant
// because the bare-adjacency pattern requires "passer" immediately followed
// by "ikke" — inserting a hedging adverb broke the match.

Deno.test("READINESS-8: ungrounded DA 'passer desværre ikke' → review", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "A-Blaze ear pads passer desværre ikke på A-Spire headsettet.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some((v) => v.type === "unsupported_negative_fit_claim"),
  );
});

Deno.test("READINESS-8: ungrounded DA 'passer vist ikke' → review", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Det passer vist ikke på det headset.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some((v) => v.type === "unsupported_negative_fit_claim"),
  );
});

Deno.test("READINESS-8: ungrounded DA 'passer nok ikke' → review", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Ear pads passer nok ikke på den model.",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some((v) => v.type === "unsupported_negative_fit_claim"),
  );
});

Deno.test("READINESS-8: 'passer desværre ikke' grounded by retrieved chunk wording → allowed", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "A-Blaze ear pads passer desværre ikke på A-Spire headsettet.",
    retrieved_chunks: [
      {
        id: "c1",
        content: "A-Blaze ear pads are not compatible with the A-Spire headset shell.",
        kind: "text",
        source_label: "shopify_page",
        similarity: 0.9,
        usable_as: "policy",
        risk_flags: [],
        applies_to_all_products: false,
        chunk_issue_types: [],
      },
    ],
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-8: unrelated hedge word 'ikke sandt' tag phrasing does NOT false-positive", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Det passer meget godt sammen, ikke sandt?",
    structured_facts: [],
    facts: [],
    retrieved_chunks: [],
  });
  assertEquals(r.compliant, true);
});

// ── Capability-refusal family: "we don't offer/sell/support X" ────────────

Deno.test("capability refusal without grounding is flagged", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Hi there, unfortunately we don't offer individual mic clips for the A-Spire Wireless separately.",
    retrieved_chunks: [],
  });
  assert(r.violations.some((v) => v.type === "unsupported_capability_claim"), JSON.stringify(r.violations));
  assertEquals(r.requires_review, true);
});

Deno.test("adverb before the negation still flags (fragt-B: 'we currently do not offer')", () => {
  for (const draft of [
    "Unfortunately, we currently do not offer shipping to that country.",
    "We at the moment do not provide that service.",
    "We do not currently offer international returns.",
  ]) {
    const r = checkUnsupportedNegativeClaims({ draft_text: draft, retrieved_chunks: [] });
    assert(r.violations.some((v) => v.type === "unsupported_capability_claim"), draft);
  }
});

Deno.test("Danish capability refusals are flagged", () => {
  for (const draft of [
    "Desværre har vi ikke mulighed for at kontakte Maxgaming direkte.",
    "Det kan vi desværre ikke tilbyde.",
    "Vi sælger ikke mic clips separat.",
  ]) {
    const r = checkUnsupportedNegativeClaims({ draft_text: draft, retrieved_chunks: [] });
    assert(r.violations.some((v) => v.type === "unsupported_capability_claim"), draft);
  }
});

Deno.test("uncertainty phrasing never triggers the capability family", () => {
  for (const draft of [
    "Jeg kan ikke se lagerstatus lige nu, så jeg vender tilbage.",
    "I can't confirm the current stock status right now.",
    "Det undersøger jeg og vender tilbage til dig om.",
  ]) {
    const r = checkUnsupportedNegativeClaims({ draft_text: draft, retrieved_chunks: [] });
    assertEquals(r.violations.some((v) => v.type === "unsupported_capability_claim"), false, draft);
  }
});

Deno.test("capability refusal grounded by a KB chunk is allowed", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "We don't sell the mic clip separately.",
    retrieved_chunks: [{
      content: "Spare parts: the mic clip is not sold separately; it ships attached to the headset.",
      usable_as: "policy", source_provider: "manual_text", source_label: "spare parts",
    } as any],
  });
  assertEquals(r.violations.some((v) => v.type === "unsupported_capability_claim"), false, JSON.stringify(r.violations));
});

// ── Finding 1 (Critical): bare "unable to" / "not possible" must NEVER match
// the capability family — those are the EXACT forbidden uncertainty phrasings
// named in the spec ("I'm unable to confirm...", "I am unable to see...").
// Only a we/shop-scoped refusal ("we're unable to", "not possible for us")
// should match.

Deno.test("Finding 1: 'I'm unable to confirm...' uncertainty phrasing is NOT a capability claim", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "I'm unable to confirm the current stock status right now.",
    retrieved_chunks: [],
  });
  assertEquals(
    r.violations.some((v) => v.type === "unsupported_capability_claim"),
    false,
    JSON.stringify(r.violations),
  );
});

Deno.test("Finding 1: 'I am unable to see your order...' uncertainty phrasing is NOT a capability claim", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "I am unable to see your order at the moment.",
    retrieved_chunks: [],
  });
  assertEquals(
    r.violations.some((v) => v.type === "unsupported_capability_claim"),
    false,
    JSON.stringify(r.violations),
  );
});

Deno.test("Finding 1: 'It's not possible to say for sure right now.' is NOT a capability claim", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "It's not possible to say for sure right now.",
    retrieved_chunks: [],
  });
  assertEquals(
    r.violations.some((v) => v.type === "unsupported_capability_claim"),
    false,
    JSON.stringify(r.violations),
  );
});

Deno.test("Finding 1: 'We're unable to offer that.' STILL matches the capability family", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "We're unable to offer that.",
    retrieved_chunks: [],
  });
  assert(
    r.violations.some((v) => v.type === "unsupported_capability_claim"),
    JSON.stringify(r.violations),
  );
});

Deno.test("Finding 1: \"It's not possible for us to do that.\" STILL matches the capability family", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "It's not possible for us to do that.",
    retrieved_chunks: [],
  });
  assert(
    r.violations.some((v) => v.type === "unsupported_capability_claim"),
    JSON.stringify(r.violations),
  );
});

// ── Finding 2 (Critical): grounding must be a strict allowlist ────────────
// {policy, procedure, saved_reply, background} only. A chunk with usable_as
// OMITTED (undefined) must NOT ground a claim — it must still be flagged.

Deno.test("Finding 2: capability claim + chunk with usable_as OMITTED but matching wording is STILL flagged (not grounded)", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "We don't sell the mic clip separately.",
    retrieved_chunks: [{
      id: "c1",
      content: "Spare parts: the mic clip is not sold separately; it ships attached to the headset.",
      // usable_as intentionally omitted — must NOT ground under the strict allowlist.
    } as any],
  });
  assert(
    r.violations.some((v) => v.type === "unsupported_capability_claim"),
    JSON.stringify(r.violations),
  );
});
