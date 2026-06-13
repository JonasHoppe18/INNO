import { assertEquals } from "jsr:@std/assert@1";
import {
  resolveOrderMatch,
  type OrderMatchState,
} from "./fact-resolver.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";

// Minimal fake order — only fields the resolver/state machine cares about.
function fakeOrder(name: string): Order {
  return {
    id: name.replace(/^#/, ""),
    order_number: name.replace(/^#/, ""),
    name: name.startsWith("#") ? name : `#${name}`,
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

// Configurable fake provider — records which lookups were called.
function fakeProvider(opts: {
  byName?: (raw: string) => Order | null | Promise<Order | null>;
  byEmail?: (email: string) => Order[] | Promise<Order[]>;
  throwOnName?: boolean;
  throwOnEmail?: boolean;
}) {
  const calls: string[] = [];
  return {
    calls,
    getOrderByName(raw: string) {
      calls.push(`name:${raw}`);
      if (opts.throwOnName) throw new Error("Shopify 503");
      return Promise.resolve(opts.byName ? opts.byName(raw) : null);
    },
    listOrdersByEmail(email: string) {
      calls.push(`email:${email}`);
      if (opts.throwOnEmail) throw new Error("Shopify timeout");
      return Promise.resolve(opts.byEmail ? opts.byEmail(email) : []);
    },
  };
}

function expectState(actual: OrderMatchState, expected: OrderMatchState) {
  assertEquals(actual, expected);
}

// 1. explicit order number match → exact_order_number
Deno.test("explicit order number match → exact_order_number", async () => {
  const provider = fakeProvider({ byName: () => fakeOrder("#1001") });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: ["1001"],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "exact_order_number");
  assertEquals(res.order?.name, "#1001");
  assertEquals(res.match.selected_order_name, "#1001");
});

// 2. explicit order number not found → order_not_found
// 4. and does NOT silently fall back to email
Deno.test("explicit order number not found → order_not_found, no email fallback", async () => {
  const provider = fakeProvider({
    byName: () => null,
    byEmail: () => [fakeOrder("#9999")], // would match if (wrongly) consulted
  });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: ["1001"],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "order_not_found");
  assertEquals(res.order, null);
  // email lookup must NOT have been called
  assertEquals(provider.calls.some((c) => c.startsWith("email:")), false);
});

// 3. explicit order number lookup failure → integration_error
Deno.test("explicit order number lookup failure → integration_error", async () => {
  const provider = fakeProvider({ throwOnName: true, byEmail: () => [fakeOrder("#9999")] });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: ["1001"],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "integration_error");
  assertEquals(res.order, null);
  assertEquals(provider.calls.some((c) => c.startsWith("email:")), false);
});

// 5. no identifiers → missing_identifiers
Deno.test("no identifiers → missing_identifiers", async () => {
  const provider = fakeProvider({});
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: [],
    customerEmail: "",
  });
  expectState(res.match.state, "missing_identifiers");
  assertEquals(res.order, null);
  assertEquals(provider.calls.length, 0); // nothing to look up
});

// 6. no order number + one email match → single_email_match
Deno.test("no order number + one email match → single_email_match", async () => {
  const provider = fakeProvider({ byEmail: () => [fakeOrder("#1001")] });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: [],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "single_email_match");
  assertEquals(res.order?.name, "#1001");
  assertEquals(res.match.candidate_count, 1);
});

// 7. no order number + multiple email matches → multiple_email_matches
// 8. does not silently select an order
Deno.test("multiple email matches → multiple_email_matches, no silent select", async () => {
  const provider = fakeProvider({
    byEmail: () => [fakeOrder("#1001"), fakeOrder("#1002")],
  });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: [],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "multiple_email_matches");
  assertEquals(res.order, null); // not silently selected
  assertEquals(res.match.candidate_count, 2);
  assertEquals(res.match.selected_order_name, null);
});

// email lookup failure → integration_error
Deno.test("email lookup failure → integration_error", async () => {
  const provider = fakeProvider({ throwOnEmail: true });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: [],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "integration_error");
  assertEquals(res.order, null);
});

// email lookup returns empty → order_not_found
Deno.test("email lookup empty → order_not_found", async () => {
  const provider = fakeProvider({ byEmail: () => [] });
  const res = await resolveOrderMatch({
    provider,
    orderNumbers: [],
    customerEmail: "c@example.com",
  });
  expectState(res.match.state, "order_not_found");
  assertEquals(res.order, null);
});
