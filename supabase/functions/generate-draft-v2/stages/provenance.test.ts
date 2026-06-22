import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  assembleProvenance,
  mapFactGuardrails,
  mapLiveFacts,
  mapRetrievedSources,
  type StructuredFactProvenance,
} from "./provenance.ts";

Deno.test("mapRetrievedSources maps chunk fields and truncates the snippet", () => {
  const out = mapRetrievedSources([
    {
      id: "c1",
      source_label: "Returns & Refunds",
      kind: "knowledge",
      usable_as: "policy",
      risk_flags: ["strong_claim"],
      similarity: 0.82,
      content: "x".repeat(500),
    },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].id, "c1");
  assertEquals(out[0].source_label, "Returns & Refunds");
  assertEquals(out[0].kind, "knowledge");
  assertEquals(out[0].usable_as, "policy");
  assertEquals(out[0].risk_flags, ["strong_claim"]);
  assertEquals(out[0].similarity, 0.82);
  assertEquals(out[0].snippet, "x".repeat(200));
});

Deno.test("mapRetrievedSources caps the number of sources at the limit", () => {
  const chunks = Array.from({ length: 9 }, (_v, i) => ({
    id: `c${i}`,
    source_label: `s${i}`,
    content: "hello",
  }));
  assertEquals(mapRetrievedSources(chunks).length, 5);
  assertEquals(mapRetrievedSources([], 5).length, 0);
});

Deno.test("mapLiveFacts exposes order/tracking/refund/stock as verified live facts", () => {
  const out = mapLiveFacts([
    { label: "Ordre fundet", value: "#1001 — Status: Afsendt, Betaling: paid" },
    { label: "Tracking (fragtmand)", value: "GLS: Delivered" },
    {
      label: "Refunderingsstatus: fuld refundering udstedt",
      value:
        "Hele beløbet ER refunderet (100 DKK) den 3. juni til den oprindelige betalingsmetode. Sig ALDRIG at en refundering ikke er udstedt.",
    },
    { label: "Live stock availability", value: "state=in_stock; product=A-Spire" },
    // PII / instruction facts that must NOT surface as live facts:
    { label: "Kundenavn", value: "John Doe" },
    { label: "Leveringsadresse", value: "Main St 1, 1000 City, DK" },
    { label: "Kunde-email kendt", value: "john@example.com" },
  ]);

  const bySource = Object.fromEntries(out.map((f) => [f.source, f]));
  assertEquals(out.length, 4);
  assert(bySource.shopify_order, "expected a shopify_order live fact");
  assert(bySource.carrier_tracking, "expected a carrier_tracking live fact");
  assert(bySource.refund_derivation, "expected a refund_derivation live fact");
  assert(bySource.shopify_inventory, "expected a shopify_inventory live fact");
  for (const f of out) assertEquals(f.verified, true);

  // PII excluded.
  assert(!out.some((f) => f.value.includes("John Doe")));
  assert(!out.some((f) => f.value.includes("Main St 1")));
  assert(!out.some((f) => f.value.includes("john@example.com")));
});

Deno.test("mapLiveFacts never leaks hidden refund directive text", () => {
  const out = mapLiveFacts([
    {
      label: "Refunderingsstatus: ingen refundering udstedt",
      value:
        "Der er IKKE registreret en refundering på ordren. Sig ikke at en refundering er udstedt, og opfind ikke en returstatus.",
    },
  ]);
  assertEquals(out.length, 1);
  const f = out[0];
  assertEquals(f.source, "refund_derivation");
  // Directive imperatives must be stripped — only the status summary remains.
  assert(!/sig ikke/i.test(f.value), `leaked directive: ${f.value}`);
  assert(!/opfind ikke/i.test(f.value), `leaked directive: ${f.value}`);
  assert(f.value.includes("ingen refundering udstedt"));
});

Deno.test("mapFactGuardrails emits safe order/stock guardrails without leaking directive text", () => {
  const out = mapFactGuardrails([
    {
      label: "Ordre IKKE fundet",
      value:
        "Ordrenummer #999 kunne IKKE findes i vores system. Bekræft aldrig ordren som eksisterende, og udfør/lov ingen handlinger på den.",
    },
    {
      label: "Ordreopslag midlertidigt utilgængeligt",
      value:
        "Vi kunne IKKE verificere ordren netop nu. Sig ALDRIG at ordren ikke kan findes.",
    },
    {
      label: "Live stock availability",
      value: "state=unknown; product_query=foo; reason=not_found",
    },
  ]);

  assertEquals(out.length, 3);
  const order = out.find((g) => g.reason === "order_not_found");
  const integ = out.find((g) => g.reason === "integration_error");
  const stock = out.find((g) => g.reason === "no_live_stock");
  assert(order && order.topic === "order");
  assert(integ && integ.topic === "order");
  assert(stock && stock.topic === "stock");
  // Generated messages, never the raw directive value.
  for (const g of out) {
    assert(!/aldrig/i.test(g.message), `leaked directive: ${g.message}`);
    assert(!/bekræft aldrig/i.test(g.message));
    assert(g.message.length > 0);
  }
});

Deno.test("mapFactGuardrails does not flag in-stock facts", () => {
  const out = mapFactGuardrails([
    { label: "Live stock availability", value: "state=in_stock; product=A-Spire" },
  ]);
  assertEquals(out.length, 0);
});

Deno.test("assembleProvenance combines all four arrays", () => {
  const structured: StructuredFactProvenance[] = [
    {
      type: "comparison",
      product_titles: ["A-Blaze", "A-Spire"],
      key: "eq_app_bands",
      value: "A-Blaze: 8 bands | A-Spire: 8 bands",
      confidence: "confirmed",
      origin_table: "shop_product_specs",
    },
  ];
  const prov = assembleProvenance({
    retrievedChunks: [{ id: "c1", source_label: "Doc", content: "abc" }],
    structuredFacts: structured,
    facts: [
      { label: "Ordre fundet", value: "#1001 — Status: Afsendt, Betaling: paid" },
      { label: "Ordre IKKE fundet", value: "ignored directive text" },
    ],
    extraGuardrails: [
      {
        topic: "compatibility",
        reason: "no_confirmed_row",
        message: "Compatibility for the requested platform is not confirmed.",
      },
    ],
  });

  assertEquals(prov.retrieved_sources.length, 1);
  assertEquals(prov.structured_facts, structured);
  assertEquals(prov.live_facts.length, 1);
  assertEquals(prov.live_facts[0].source, "shopify_order");
  // one from the not-found fact + one extra compatibility guardrail
  assertEquals(prov.guardrails_unavailable.length, 2);
  assert(prov.guardrails_unavailable.some((g) => g.topic === "compatibility"));
  assert(prov.guardrails_unavailable.some((g) => g.reason === "order_not_found"));
});
