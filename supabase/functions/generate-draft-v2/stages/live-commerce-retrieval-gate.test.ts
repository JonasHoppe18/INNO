import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  isLiveCommerceIntent,
  partitionLiveCommerceLegacy,
} from "./live-commerce-retrieval-gate.ts";

const manualFact = { source_provider: "manual_text", usable_as: "fact", kind: "knowledge" };
const savedReply = { source_provider: "saved_reply", usable_as: "saved_reply", kind: "saved_reply" };
// The row 4321 pattern: a manual_text Q&A explicitly tagged usable_as='procedure'.
const manualProcedure = { source_provider: "manual_text", usable_as: "procedure", kind: "knowledge" };
const kdPolicy = { source_provider: "knowledge_document", usable_as: "policy", kind: "knowledge" };
const kdProcedure = { source_provider: "knowledge_document", usable_as: "procedure", kind: "knowledge" };
const productChunk = { source_provider: "shopify_product", usable_as: "background", kind: "knowledge" };

Deno.test("isLiveCommerceIntent covers status + policy intents only", () => {
  for (const i of ["tracking", "order_status", "cancel", "address_change", "refund", "return", "exchange"]) {
    assert(isLiveCommerceIntent(i), `${i} should be live-commerce`);
  }
  for (const i of ["product_question", "complaint", "thanks", "update", "other", ""]) {
    assertEquals(isLiveCommerceIntent(i), false, `${i} should NOT be live-commerce`);
  }
});

Deno.test("no gating for non-live-commerce intents (everything kept)", () => {
  const chunks = [manualFact, savedReply, kdPolicy];
  const r = partitionLiveCommerceLegacy(chunks, { intent: "product_question", hasLiveOrder: true });
  assertEquals(r.kept.length, 3);
  assertEquals(r.suppressed.length, 0);
});

Deno.test("no gating when no live order is present (everything kept)", () => {
  const chunks = [manualFact, savedReply, kdPolicy];
  const r = partitionLiveCommerceLegacy(chunks, { intent: "tracking", hasLiveOrder: false });
  assertEquals(r.kept.length, 3);
  assertEquals(r.suppressed.length, 0);
});

// --- STATUS group: tracking / order_status / cancel / address_change -------
// Live facts fully answer these → suppress manual_text/saved_reply REGARDLESS
// of usable_as (this is what catches row 4321, tagged procedure).

Deno.test("status intent (tracking) suppresses manual_text+saved_reply, including manual_text tagged 'procedure' (row 4321)", () => {
  const chunks = [manualFact, savedReply, manualProcedure, kdPolicy, kdProcedure];
  const r = partitionLiveCommerceLegacy(chunks, { intent: "tracking", hasLiveOrder: true });
  assert(r.suppressed.includes(manualFact));
  assert(r.suppressed.includes(savedReply));
  assert(r.suppressed.includes(manualProcedure), "row 4321 pattern: manual_text procedure must be suppressed on status intents");
  assert(r.kept.includes(kdPolicy), "knowledge_document policy always kept");
  assert(r.kept.includes(kdProcedure), "knowledge_document procedure always kept");
  assertEquals(r.suppressed.length, 3);
});

Deno.test("cancel and address_change suppress manual_text procedure too", () => {
  for (const intent of ["cancel", "address_change", "order_status"]) {
    const r = partitionLiveCommerceLegacy([manualProcedure], { intent, hasLiveOrder: true });
    assertEquals(r.suppressed.length, 1, `${intent}: manual_text procedure should be suppressed`);
    assert(r.suppressed.includes(manualProcedure));
  }
});

// --- POLICY group: return / refund / exchange ------------------------------
// These may need return steps / refund procedure / warranty guidance, so
// policy/procedure is preserved; only fact/saved_reply legacy is suppressed.

Deno.test("return/refund/exchange preserve manual_text procedure and knowledge_document policy", () => {
  for (const intent of ["return", "refund", "exchange"]) {
    const r = partitionLiveCommerceLegacy([manualProcedure, kdPolicy, manualFact], { intent, hasLiveOrder: true });
    assert(r.kept.includes(manualProcedure), `${intent}: return/refund procedure must be preserved`);
    assert(r.kept.includes(kdPolicy), `${intent}: policy doc must be preserved`);
    assert(r.suppressed.includes(manualFact), `${intent}: legacy fact should still be suppressed`);
    assertEquals(r.suppressed.length, 1);
  }
});

Deno.test("non-legacy chunks (shopify_product background) are never suppressed", () => {
  const r = partitionLiveCommerceLegacy([productChunk], { intent: "tracking", hasLiveOrder: true });
  assertEquals(r.suppressed.length, 0);
  assert(r.kept.includes(productChunk));
});

Deno.test("kept + suppressed partition is complete and disjoint", () => {
  const chunks = [manualFact, savedReply, manualProcedure, kdPolicy, kdProcedure, productChunk];
  const r = partitionLiveCommerceLegacy(chunks, { intent: "tracking", hasLiveOrder: true });
  assertEquals(r.kept.length + r.suppressed.length, chunks.length);
  for (const c of r.suppressed) assert(!r.kept.includes(c));
});
