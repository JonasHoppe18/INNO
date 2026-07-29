import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { resolveOrderMatch } from "./fact-resolver.ts";
import { buildOrderMatchDirective } from "./writer.ts";
import { applyMatchActionPolicy } from "./action-decision.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";

// Regression tests for the C4 finding (2026-07-28): an explicit order number
// was enough to retrieve any order, including one belonging to a different
// customer. The order-number branch of resolveOrderMatch never checked
// ownership, so a sender who guessed a number received order status and the
// recipient's full shipping address.

function orderOwnedBy(name: string, email: string): Order {
  return {
    id: name.replace(/^#/, ""),
    order_number: name.replace(/^#/, ""),
    name: name.startsWith("#") ? name : `#${name}`,
    email,
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    cancelled_at: null,
    closed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Order;
}

function providerReturning(order: Order) {
  return {
    getOrderByName: (_name: string) => Promise.resolve(order),
    listOrdersByEmail: (_email: string, _limit?: number) => Promise.resolve([]),
  };
}

Deno.test("order belonging to another customer is never returned", async () => {
  const foreign = orderOwnedBy("#1058", "anden.kunde@example.com");

  const { order, match } = await resolveOrderMatch({
    provider: providerReturning(foreign),
    orderNumbers: ["#1058"],
    customerEmail: "jonashoppe8@hotmail.com",
  });

  assertEquals(order, null);
  assertEquals(match.state, "order_not_owned");
  assertEquals(match.selected_order_name, null);
});

Deno.test("ownership check ignores email casing", async () => {
  // Real fixture: order #1051 stores "Jonashoppe8@hotmail.com" with a capital J
  // while the inbound message arrives from the all-lowercase address.
  const own = orderOwnedBy("#1051", "Jonashoppe8@hotmail.com");

  const { order, match } = await resolveOrderMatch({
    provider: providerReturning(own),
    orderNumbers: ["#1051"],
    customerEmail: "jonashoppe8@hotmail.com",
  });

  assertEquals(order?.name, "#1051");
  assertEquals(match.state, "exact_order_number");
});

Deno.test("surrounding whitespace does not defeat the ownership check", async () => {
  const own = orderOwnedBy("#1053", "  jonashoppe8@hotmail.com  ");

  const { order, match } = await resolveOrderMatch({
    provider: providerReturning(own),
    orderNumbers: ["#1053"],
    customerEmail: "jonashoppe8@hotmail.com",
  });

  assertEquals(order?.name, "#1053");
  assertEquals(match.state, "exact_order_number");
});

Deno.test("writer is told to withhold details when the order is not owned", () => {
  const directive = buildOrderMatchDirective({
    state: "order_not_owned",
    candidate_count: 0,
    had_order_number: true,
    had_email: true,
    selected_order_name: null,
  });

  // The directive must actually say something — falling through to the bare
  // header would leave the writer free to improvise.
  assert(directive.trim().length > 0);
  const lower = directive.toLowerCase();
  // Must forbid disclosing anything about the order...
  assertStringIncludes(lower, "aldrig");
  // ...and must not claim the order does not exist, which would be untrue.
  assert(
    !lower.includes("ingen ordre matchede"),
    "must not reuse the order_not_found wording",
  );
});

// Regression pin, not a red-green step: applyMatchActionPolicy already collapses
// unknown states to "none". Locking it down so a later rewrite of that switch
// cannot quietly make an unowned order actionable.
Deno.test("no action survives an unowned order", () => {
  const proposals = [
    { type: "cancel_order" },
    { type: "update_shipping_address" },
    { type: "lookup_order_status" },
  ] as Parameters<typeof applyMatchActionPolicy>[0];

  assertEquals(applyMatchActionPolicy(proposals, "order_not_owned"), []);
});

Deno.test("an order with no email on record is not treated as owned", async () => {
  // Draft orders and some imported orders carry no customer email. Absent an
  // identity to compare against, the safe answer is to withhold the order
  // rather than assume the sender owns it.
  const anonymous = orderOwnedBy("#1047", "");

  const { order, match } = await resolveOrderMatch({
    provider: providerReturning(anonymous),
    orderNumbers: ["#1047"],
    customerEmail: "jonashoppe8@hotmail.com",
  });

  assertEquals(order, null);
  assertEquals(match.state, "order_not_owned");
});
