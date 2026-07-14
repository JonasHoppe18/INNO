import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildFactsFromOrder } from "./fact-resolver.ts";
import type { Plan } from "./planner.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";
import type { ResolvedFact } from "./fact-resolver.ts";

// Return eligibility must NEVER be asserted from an invented standard window.
// The store's actual return policy lives in retrieved knowledge; the resolver
// only supplies the documented order age and defers the verdict.

function orderAgedDays(days: number): Order {
  return {
    id: "1001",
    order_number: "1001",
    name: "#1001",
    email: "c@example.com",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    cancelled_at: null,
    closed_at: null,
    created_at: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    total_price: "100.00",
    currency: "DKK",
    line_items: [],
    fulfillments: [],
  } as unknown as Order;
}

const returnPlan = {
  primary_intent: "return",
  required_facts: ["return_eligibility"],
} as unknown as Plan;

async function returnFactFor(days: number): Promise<ResolvedFact | undefined> {
  const facts: ResolvedFact[] = [];
  await buildFactsFromOrder(orderAgedDays(days), facts, returnPlan);
  return facts.find((f) => f.label === "Returret");
}

Deno.test("return_eligibility: no invented 30-day verdict for old orders", async () => {
  const fact = await returnFactFor(40);
  assert(fact, "expected a Returret fact");
  assert(
    !/30-dages/.test(fact.value),
    `fact must not assert an undocumented 30-day window, got: ${fact.value}`,
  );
  assert(
    !/^(Ja|Nej) —/.test(fact.value),
    `fact must not pass an eligibility verdict, got: ${fact.value}`,
  );
});

Deno.test("return_eligibility: supplies documented order age and defers to shop policy", async () => {
  const fact = await returnFactFor(40);
  assert(fact, "expected a Returret fact");
  assertStringIncludes(fact.value, "40 dage");
  assert(
    /dokumenter/i.test(fact.value),
    `fact must defer to the documented return policy, got: ${fact.value}`,
  );
});

Deno.test("return_eligibility: fresh orders get no verdict either", async () => {
  const fact = await returnFactFor(10);
  assert(fact, "expected a Returret fact");
  assert(!/^(Ja|Nej) —/.test(fact.value));
  assert(!/30-dages/.test(fact.value));
});
