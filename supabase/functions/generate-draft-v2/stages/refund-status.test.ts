import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { mapShopifyRefunds } from "../../_shared/integrations/commerce/shopify-provider.ts";
import {
  deriveRefundStatus,
  type RefundStatus,
} from "./fact-resolver.ts";
import { buildRefundStatusDirective, buildLiveFactAuthorityBlock } from "./writer.ts";
import type { Order, RefundRecord } from "../../_shared/integrations/commerce/types.ts";

function order(partial: Partial<Order>): Order {
  return {
    id: "1001",
    order_number: "1001",
    name: "#1001",
    email: "c@example.com",
    financial_status: "paid",
    fulfillment_status: "fulfilled",
    cancelled_at: null,
    closed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    total_price: "100.00",
    currency: "DKK",
    line_items: [],
    fulfillments: [],
    ...partial,
  };
}

function refund(txns: Array<Record<string, unknown>>, extra: Partial<RefundRecord> = {}): RefundRecord {
  return {
    id: "r1",
    created_at: "2026-06-01T10:00:00Z",
    processed_at: "2026-06-01T10:00:00Z",
    note: null,
    transactions: txns.map((t) => ({ kind: "refund", status: "success", currency: "DKK", ...t })),
    ...extra,
  };
}

// 1. refunds mapped additively from raw payload
Deno.test("mapShopifyRefunds maps records + transactions additively", () => {
  const raw = [{
    id: 555,
    created_at: "2026-06-01T10:00:00Z",
    processed_at: "2026-06-01T10:05:00Z",
    note: "goodwill",
    transactions: [{ id: 9, amount: "40.00", currency: "DKK", gateway: "stripe", status: "success", kind: "refund", processed_at: "2026-06-01T10:05:00Z" }],
  }];
  const mapped = mapShopifyRefunds(raw);
  assertEquals(mapped.length, 1);
  assertEquals(mapped[0].id, "555");
  assertEquals(mapped[0].note, "goodwill");
  assertEquals(mapped[0].transactions.length, 1);
  assertEquals(mapped[0].transactions[0].amount, "40.00");
  assertEquals(mapped[0].transactions[0].status, "success");
  // absent / non-array → empty
  assertEquals(mapShopifyRefunds(undefined), []);
  assertEquals(mapShopifyRefunds(null), []);
});

// 2. no refunds → no_refund_issued
Deno.test("no refunds → no_refund_issued", () => {
  const s = deriveRefundStatus(order({ refunds: [] }));
  assertEquals(s.state, "no_refund_issued");
  assertEquals(s.total_refunded, "0.00");
});

// 3. full successful refund → full_refund_issued (+ 9 amount, 10 timestamp surfaced)
Deno.test("full successful refund → full_refund_issued with amount + timestamp", () => {
  const s = deriveRefundStatus(order({
    total_price: "100.00",
    refunds: [refund([{ amount: "100.00" }])],
  }));
  assertEquals(s.state, "full_refund_issued");
  assertEquals(s.total_refunded, "100.00");
  assertEquals(s.currency, "DKK");
  assert(s.last_refund_at);
});

// 4. partial successful refund → partial_refund_issued
Deno.test("partial successful refund → partial_refund_issued", () => {
  const s = deriveRefundStatus(order({
    total_price: "100.00",
    refunds: [refund([{ amount: "40.00" }])],
  }));
  assertEquals(s.state, "partial_refund_issued");
  assertEquals(s.total_refunded, "40.00");
});

// 5. pending transaction → refund_pending_or_unclear
Deno.test("pending transaction → refund_pending_or_unclear", () => {
  const s = deriveRefundStatus(order({
    refunds: [refund([{ amount: "100.00", status: "pending" }])],
  }));
  assertEquals(s.state, "refund_pending_or_unclear");
});

// 6. failed transaction does not count as issued
Deno.test("failed transaction does not count as issued", () => {
  const s = deriveRefundStatus(order({
    refunds: [refund([{ amount: "100.00", status: "failure" }])],
  }));
  assertEquals(s.state, "refund_pending_or_unclear");
  assert(s.state !== "full_refund_issued");
});

// 7. malformed refund records do not create confident claims
Deno.test("malformed amounts → refund_pending_or_unclear", () => {
  const s = deriveRefundStatus(order({
    refunds: [refund([{ amount: "not-a-number" }])],
  }));
  assertEquals(s.state, "refund_pending_or_unclear");
});

// 8. mixed currencies fall back safely
Deno.test("mixed currencies → refund_pending_or_unclear", () => {
  const s = deriveRefundStatus(order({
    currency: "DKK",
    total_price: "100.00",
    refunds: [refund([{ amount: "50.00", currency: "DKK" }, { amount: "10.00", currency: "EUR" }])],
  }));
  assertEquals(s.state, "refund_pending_or_unclear");
});

// 8b. refund currency != order currency → unsafe compare → pending
Deno.test("refund currency mismatch with order → refund_pending_or_unclear", () => {
  const s = deriveRefundStatus(order({
    currency: "DKK",
    total_price: "100.00",
    refunds: [refund([{ amount: "100.00", currency: "EUR" }])],
  }));
  assertEquals(s.state, "refund_pending_or_unclear");
});

// 16. order integration failure (no order) does not become no_refund_issued
Deno.test("undefined order refunds (not looked up) is not asserted as no_refund", () => {
  // deriveRefundStatus is only called with a found order; an order with
  // undefined refunds (vs []) should be treated as unknown, not "no refund".
  const s = deriveRefundStatus(order({ refunds: undefined }));
  assertEquals(s.state, "refund_pending_or_unclear");
});

// ── Writer directives ─────────────────────────────────────────────────────────

const mk = (state: RefundStatus["state"], extra: Partial<RefundStatus> = {}): RefundStatus => ({
  state,
  total_refunded: "40.00",
  currency: "DKK",
  last_refund_at: "2026-06-01T10:00:00Z",
  order_total: "100.00",
  refund_count: 1,
  ...extra,
});

// 11. writer does not claim a refund when none exists
Deno.test("no_refund_issued directive does not claim a refund or invent return status", () => {
  const d = buildRefundStatusDirective(mk("no_refund_issued", { total_refunded: "0.00", refund_count: 0 })).toLowerCase();
  assertStringIncludes(d, "ingen refundering");
  assert(!/refundering er udstedt(?!\.|,| —)/.test(d) || d.includes("sig ikke") || d.includes("ikke at"));
  assertStringIncludes(d, "antag ikke"); // do not infer return received
});

// 12. writer does not invent bank-processing timing (no hardcoded day count)
Deno.test("issued directives avoid inventing bank-processing timing", () => {
  for (const st of ["full_refund_issued", "partial_refund_issued"] as const) {
    const d = buildRefundStatusDirective(mk(st)).toLowerCase();
    assert(!/\d+\s*(?:-\s*\d+\s*)?(?:hverdage|dage|days|business days)/.test(d), `${st} must not hardcode a timeline`);
    assertStringIncludes(d, "betalingsudbyder");
  }
});

// 13. writer does not infer return received
Deno.test("directives never assert the return was received", () => {
  for (const st of ["no_refund_issued", "refund_pending_or_unclear"] as const) {
    const d = buildRefundStatusDirective(mk(st)).toLowerCase();
    assert(!/returnering(?:en)? (?:er )?modtaget/.test(d.replace(/ikke .*modtaget/g, "")), `${st} must not claim return received`);
  }
});

// 14. writer does not promise remaining refund after a partial refund
Deno.test("partial directive forbids implying remaining amount auto-refunds", () => {
  const d = buildRefundStatusDirective(mk("partial_refund_issued")).toLowerCase();
  assertStringIncludes(d, "restbeløb");
  assertStringIncludes(d, "ikke");
});

// 15. stale knowledge cannot override verified refund facts
Deno.test("authority block asserts live refund facts override stale knowledge", () => {
  const b = buildLiveFactAuthorityBlock().toLowerCase();
  assertStringIncludes(b, "refund");
  assertStringIncludes(b, "overstyr");
});

// pending directive forbids inventing amount/date
Deno.test("pending directive forbids inventing amount or date", () => {
  const d = buildRefundStatusDirective(mk("refund_pending_or_unclear")).toLowerCase();
  assertStringIncludes(d, "kan ikke fastslås"); // status not determinable yet
  assert(d.includes("opfind ikke") || d.includes("ikke opfinde"));
});
