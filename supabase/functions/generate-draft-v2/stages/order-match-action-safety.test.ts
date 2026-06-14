import { assertEquals } from "jsr:@std/assert@1";
import {
  actionPolicyForMatch,
  applyMatchActionPolicy,
  isReadOnlyLookupAction,
  runActionDecision,
  type ActionProposal,
} from "./action-decision.ts";
import type { FactResolverResult, OrderMatch, OrderMatchState } from "./fact-resolver.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";
import type { Plan } from "./planner.ts";
import type { CaseState } from "./case-state-updater.ts";
import type { RetrieverResult } from "./retriever.ts";

function order(): Order {
  return {
    id: "1001",
    order_number: "1001",
    name: "#1001",
    email: "c@example.com",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    cancelled_at: null,
    closed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    total_price: "100.00",
    currency: "DKK",
    line_items: [],
    fulfillments: [],
  };
}

function match(state: OrderMatchState): OrderMatch {
  return {
    state,
    candidate_count: state === "exact_order_number" || state === "single_email_match" ? 1 : 0,
    had_order_number: state === "exact_order_number",
    had_email: state !== "missing_identifiers",
    selected_order_name: state === "exact_order_number" || state === "single_email_match" ? "#1001" : null,
  };
}

function facts(state: OrderMatchState, withOrder: boolean): FactResolverResult {
  return { facts: [], order: withOrder ? order() : null, match: match(state) };
}

const plan = (intent: string): Plan => ({
  primary_intent: intent,
  resolution_stage: "resolve" as Plan["resolution_stage"],
  sub_queries: [],
  required_facts: ["order_state"],
  skills_to_consider: [],
  confidence: 0.9,
  language: "da",
});

const caseState: CaseState = {
  intents: [],
  entities: { order_numbers: ["1001"], customer_email: "c@example.com", products_mentioned: [] },
  decisions_made: [],
  open_questions: [],
  pending_asks: [],
  language: "da",
  last_updated_msg_id: "m1",
};

const retrieved: RetrieverResult = {
  chunks: [],
  past_ticket_examples: [],
} as unknown as RetrieverResult;

const p = (type: string): ActionProposal => ({
  type,
  confidence: "high",
  reason: "test",
  params: {},
  requires_approval: true,
});

// A representative spread of mutation / side-effect actions.
const SIDE_EFFECT_ACTIONS = [
  "cancel_order",
  "refund_order",
  "update_shipping_address",
  "create_exchange_request", // replacement
  "initiate_return", // reshipment / return (requires_approval:false in prod, still mutating)
  "resend_confirmation_or_invoice",
  "resend_confirmation",
  "add_note",
  "add_tag",
];

// ── Policy unit tests (pure, robust — independent of which intent emits what) ──

// 2 & 3. single_email_match allows ONLY read-only lookups
Deno.test("single_email_match allows lookup_order_status and fetch_tracking", () => {
  for (const t of ["lookup_order_status", "fetch_tracking"]) {
    const kept = applyMatchActionPolicy([p(t)], "single_email_match");
    assertEquals(kept.map((x) => x.type), [t]);
  }
});

// 4,5,6,7. single_email_match blocks every side-effect / mutation action
Deno.test("single_email_match blocks all side-effect/mutation proposals", () => {
  for (const t of SIDE_EFFECT_ACTIONS) {
    const kept = applyMatchActionPolicy([p(t)], "single_email_match");
    assertEquals(kept, [], `expected ${t} blocked for single_email_match`);
  }
  // mixed list → only the lookups survive
  const mixed = applyMatchActionPolicy(
    [p("cancel_order"), p("lookup_order_status"), p("add_note"), p("fetch_tracking")],
    "single_email_match",
  );
  assertEquals(mixed.map((x) => x.type).sort(), ["fetch_tracking", "lookup_order_status"]);
});

// 8–11. unsafe states block ALL proposals (incl. read-only lookups)
for (const state of ["multiple_email_matches", "order_not_found", "integration_error", "missing_identifiers"] as const) {
  Deno.test(`unsafe state ${state} blocks ALL proposals`, () => {
    const all = [p("lookup_order_status"), p("fetch_tracking"), ...SIDE_EFFECT_ACTIONS.map(p)];
    assertEquals(applyMatchActionPolicy(all, state), []);
  });
}

// 12. fail-safe: absent/undefined match → no proposals
Deno.test("absent match → no proposals (fail-safe default)", () => {
  assertEquals(actionPolicyForMatch(undefined), "none");
  assertEquals(applyMatchActionPolicy([p("lookup_order_status"), p("cancel_order")], undefined), []);
});

// exact_order_number → full set allowed by policy
Deno.test("exact_order_number policy allows all proposals", () => {
  assertEquals(actionPolicyForMatch("exact_order_number"), "all");
  const all = [p("cancel_order"), p("refund_order"), p("lookup_order_status")];
  assertEquals(applyMatchActionPolicy(all, "exact_order_number").length, all.length);
});

Deno.test("read-only lookup classification", () => {
  assertEquals(isReadOnlyLookupAction("lookup_order_status"), true);
  assertEquals(isReadOnlyLookupAction("fetch_tracking"), true);
  for (const t of SIDE_EFFECT_ACTIONS) assertEquals(isReadOnlyLookupAction(t), false);
});

// ── Integration tests through runActionDecision ───────────────────────────────

// 1 & 13. exact_order_number may still produce approval-based mutation proposals
Deno.test("exact_order_number → cancel proposal flows (requires approval)", async () => {
  const res = await runActionDecision({
    plan: plan("cancel"),
    caseState,
    facts: facts("exact_order_number", true),
    retrieved,
    shopConfig: {},
    customerMessage: "Annullér venligst min ordre #1001",
  });
  const cancel = res.proposals.find((x) => x.type === "cancel_order");
  assertEquals(Boolean(cancel), true);
  assertEquals(cancel?.requires_approval, true);
});

// 7 (integration). single_email_match → cancel blocked end-to-end
Deno.test("single_email_match → cancel proposal blocked end-to-end", async () => {
  const res = await runActionDecision({
    plan: plan("cancel"),
    caseState: { ...caseState, entities: { ...caseState.entities, order_numbers: [] } },
    facts: facts("single_email_match", true),
    retrieved,
    shopConfig: {},
    customerMessage: "Annullér venligst min ordre",
  });
  assertEquals(res.proposals.some((x) => x.type === "cancel_order"), false);
});

// 8–11 (integration). unsafe states yield zero proposals end-to-end
for (const state of ["multiple_email_matches", "order_not_found", "integration_error", "missing_identifiers"] as const) {
  Deno.test(`unsafe state ${state} → zero proposals end-to-end`, async () => {
    const res = await runActionDecision({
      plan: plan("cancel"),
      caseState,
      facts: facts(state, false),
      retrieved,
      shopConfig: {},
      customerMessage: "Annullér min ordre",
    });
    assertEquals(res.proposals.length, 0);
  });
}
