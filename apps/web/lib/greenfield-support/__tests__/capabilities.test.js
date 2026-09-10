import { describe, expect, it } from "vitest";
import { createCapabilityRegistry, extractOrderReferences } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { GREENFIELD_TOOL_DEFINITIONS } from "../tool-contracts";
import { InMemoryCommerceProvider } from "../providers";

function order(orderNumber) {
  return {
    id: `shopify-${orderNumber}`,
    orderNumber,
    status: "processing",
    financialStatus: "paid",
    fulfillmentStatus: null,
    items: [{ id: `line-${orderNumber}`, title: "Test item", quantity: 1 }],
    fulfillments: [],
  };
}

async function correctionDependencies(orderNumbers = ["1051", "1055", "1063"]) {
  const dependencies = await createDemoDependencies();
  return {
    ...dependencies,
    commerce: new InMemoryCommerceProvider({
      customer: { email: dependencies.tenant.customerEmail, name: dependencies.tenant.customerName },
      orders: orderNumbers.map(order),
    }),
  };
}

function orderContext(requestedOrderId, state) {
  return {
    turn: 1,
    activeOrder: { requestedOrderId, state, order: null },
    customerSignal: null,
  };
}

function trackingProvider(calls) {
  return {
    providerName: "test_tracking",
    lookup: async (input) => {
      calls.push(input);
      return {
        status: "ok",
        data: {
          trackingNumber: input.trackingNumber,
          carrier: "ParcelCo",
          status: "in_transit",
          subStatus: null,
          latestEvent: null,
          estimatedDelivery: null,
          checkpoints: [],
          exception: null,
          observedAt: "2026-09-04T12:00:00.000Z",
          provider: "test_tracking",
          source: "test",
        },
      };
    },
  };
}

describe("greenfield capabilities", () => {
  it("exposes strict schemas without model-controlled tenant scope", () => {
    for (const tool of GREENFIELD_TOOL_DEFINITIONS) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.properties).not.toHaveProperty("tenant_id");
      expect(tool.parameters.properties).not.toHaveProperty("workspace_id");
      expect(tool.parameters.properties).not.toHaveProperty("shop_id");
    }
  });

  it("derives the current capability manifest from exposed tools and providers", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });

    expect(registry.manifest.readTools).toContain("get_order");
    expect(registry.manifest.readTools).toContain("get_tracking");
    expect(registry.manifest.proposalOnlyTools).toContain("cancel_order");
    expect(registry.manifest.proposalOnlyTools).not.toContain("hold_shipment");
    expect(registry.manifest.proposalOnlyTools).not.toContain("open_carrier_case");
    expect(registry.manifest.configured).toEqual({ knowledge: true, commerce: true, tracking: true });

    const withoutTracking = createCapabilityRegistry({ ...dependencies, tracking: undefined });
    expect(withoutTracking.manifest.configured.tracking).toBe(false);
  });

  it("keeps product reference and procedure search semantically distinct", async () => {
    const product = GREENFIELD_TOOL_DEFINITIONS.find((tool) => tool.name === "search_product_knowledge");
    const procedures = GREENFIELD_TOOL_DEFINITIONS.filter((tool) => tool.name === "search_procedures");

    expect(product?.description).toContain("Do not use this for troubleshooting");
    expect(product?.parameters.properties.query.description).toContain("exclude troubleshooting");
    expect(procedures).toHaveLength(1);
    expect(procedures[0].description).toContain("step-by-step procedures");
    expect(procedures[0].parameters.properties.query.description).toContain("troubleshooting");

    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    const result = await registry.execute("search_procedures", JSON.stringify({ query: "damaged item procedure" }));
    expect(result.status).toBe("ok");
    expect(result.data.results[0].knowledge_type).toBe("procedural");
  });

  it("uses customer-provided product continuity only to enrich follow-up lookup queries", async () => {
    const dependencies = await createDemoDependencies();
    const requests = [];
    const knowledge = {
      ingest: (...args) => dependencies.knowledge.ingest(...args),
      search: async (request) => {
        requests.push(request);
        return dependencies.knowledge.search(request);
      },
    };
    const registry = createCapabilityRegistry({
      ...dependencies,
      knowledge,
      tenant: dependencies.tenant,
      conversationContext: {
        turn: 1,
        activeOrder: null,
        customerSignal: null,
        customerProvided: { product: "A-Spire Wireless", platform: "PC" },
      },
    });

    await registry.execute("search_product_knowledge", JSON.stringify({ query: "Is it wireless?" }));
    expect(requests[0].query).toContain("Is it wireless?");
    expect(requests[0].query).toContain("A-Spire Wireless");
    expect(requests[0].query).toContain("PC");
    expect(requests[0].productContext).toBeUndefined();
  });

  it("rejects tenant escape arguments", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    const result = await registry.execute("get_order", JSON.stringify({ order_id: "10231", workspace_id: "other-tenant" }));
    expect(result.status).toBe("invalid_arguments");
    expect(result.error.code).toBe("trusted_context_argument");
  });

  it("returns proposal-only results for sensitive actions", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    await registry.execute("get_order", JSON.stringify({ order_id: "10232" }));
    const result = await registry.execute("cancel_order", JSON.stringify({ order_id: "10232", reason: "Customer changed their mind" }));
    expect(result.status).toBe("proposed");
    expect(result.proposedAction).toMatchObject({ action: "cancel_order", requiresConfirmation: true, status: "proposed" });
  });

  it("keeps address proposals behind an explicit address-change request", async () => {
    const dependencies = await createDemoDependencies();
    const policyRegistry = createCapabilityRegistry({
      ...dependencies,
      customerMessage: "Can you ship my order to another country?",
    });
    const blocked = await policyRegistry.execute("update_address", JSON.stringify({
      order_id: "10232",
      address: "1 Main Street",
      reason: "Customer asks about destination availability",
    }));

    const changeRegistry = createCapabilityRegistry({
      ...dependencies,
      customerMessage: "Please change the shipping address on order #10232.",
    });
    await changeRegistry.execute("get_order", JSON.stringify({ order_id: "10232" }));
    const allowed = await changeRegistry.execute("update_address", JSON.stringify({
      order_id: "10232",
      address: "1 Main Street",
      reason: "Customer entered the wrong address",
    }));

    expect(blocked).toMatchObject({ status: "invalid_request", error: { code: "address_change_request_required" } });
    expect(allowed).toMatchObject({ status: "proposed", proposedAction: { action: "update_address" } });
  });

  it("fails closed for live order data without verified customer identity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tenant: { workspaceId: dependencies.tenant.workspaceId, shopId: dependencies.tenant.shopId },
    });
    const result = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    expect(result).toMatchObject({ status: "missing_context", error: { code: "customer_identity_missing" } });
  });

  it("verifies a tracking number against the current customer's order before calling live tracking", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: trackingProvider(calls),
    });

    const result = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    expect(result.status).toBe("ok");
    expect(result.data.tracking_identifier).toMatchObject({ order_number: "10231", source: "shopify_order_fulfillment" });
    expect(result.data.live_tracking).toMatchObject({ status: "in_transit" });
    expect(calls).toHaveLength(1);
    expect(calls[0].provenance).toMatchObject({ workspaceId: dependencies.tenant.workspaceId, orderNumber: "10231" });

    const unverified = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "OTHER-CUSTOMER" }));
    expect(unverified.status).toBe("not_found");
    expect(calls).toHaveLength(1);
  });

  it("pins a successful exact order and permits tracking for that order", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const registry = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider(calls) });

    const order = await registry.execute("get_order", JSON.stringify({ order_id: "#10231" }));
    expect(order).toMatchObject({ status: "ok", data: { order_focus: { state: "verified", verified_order_number: "10231" } } });
    expect(order.data).not.toHaveProperty("delivery_address");

    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    expect(tracking).toMatchObject({ status: "ok", data: { order_focus: { state: "verified", verified_order_number: "10231" } } });
    expect(calls).toHaveLength(1);
    expect(calls[0].provenance.orderNumber).toBe("10231");
    expect(tracking.data.live_tracking.estimatedDelivery).toBeNull();
  });

  it("carries a verified exact order across runs without bypassing tracking verification", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const firstRun = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider(calls) });
    const order = await firstRun.execute("get_order", JSON.stringify({ order_id: "10231" }));
    expect(order.status).toBe("ok");

    const secondRun = createCapabilityRegistry({
      ...dependencies,
      tracking: trackingProvider(calls),
      conversationContext: { turn: 1, activeOrder: firstRun.getActiveOrderFocus(), customerSignal: null },
    });
    const tracking = await secondRun.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));

    expect(tracking.status).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].provenance.orderNumber).toBe("10231");
  });

  it("carries an unresolved exact order across runs without exposing history or guessing", async () => {
    const dependencies = await createDemoDependencies();
    const firstRun = createCapabilityRegistry({ ...dependencies });
    await firstRun.execute("get_order", JSON.stringify({ order_id: "9999" }));

    const secondRun = createCapabilityRegistry({
      ...dependencies,
      conversationContext: { turn: 1, activeOrder: firstRun.getActiveOrderFocus(), customerSignal: null },
    });
    const history = await secondRun.execute("get_order_history", "{}");
    const differentOrder = await secondRun.execute("get_order", JSON.stringify({ order_id: "10234" }));

    expect(history.data).toMatchObject({ candidate_only: true, has_order_history: true });
    expect(history.data).not.toHaveProperty("orders");
    expect(differentOrder).toMatchObject({ status: "invalid_request", error: { code: "order_focus_conflict" } });
  });

  it("keeps a failed exact order unresolved and exposes history only as confirmation candidates", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const registry = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider(calls) });

    const missing = await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    expect(missing).toMatchObject({ status: "not_found", data: { order_focus: { state: "unresolved", requested_order_id: "9999" } } });

    const history = await registry.execute("get_order_history", "{}");
    expect(history).toMatchObject({
      status: "ok",
      data: { candidate_only: true, has_order_history: true, order_focus: { state: "unresolved" } },
    });
    expect(history.data).not.toHaveProperty("orders");
    expect(JSON.stringify(history.data)).not.toContain("10231");
    expect(JSON.stringify(history.data)).not.toContain("PC10231");

    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    expect(tracking).toMatchObject({ status: "invalid_request", error: { code: "tracking_order_unresolved" } });
    expect(calls).toHaveLength(0);
  });

  it("does not let a different history order replace an unresolved exact order", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider([]) });

    await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    const differentOrder = await registry.execute("get_order", JSON.stringify({ order_id: "10234" }));
    const differentFulfillment = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "10234" }));

    expect(differentOrder).toMatchObject({ status: "invalid_request", error: { code: "order_focus_conflict" } });
    expect(differentFulfillment).toMatchObject({ status: "invalid_request", error: { code: "order_focus_conflict" } });
  });

  it("allows history-backed lookup when the customer did not specify an order", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const registry = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider(calls) });

    const history = await registry.execute("get_order_history", "{}");
    expect(history.status).toBe("ok");
    expect(history.data.candidate_only).toBeUndefined();
    expect(history.data.orders).toHaveLength(4);

    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    expect(tracking.status).toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it("rejects a tracking number that is not in the current customer's verified history", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const registry = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider(calls) });

    const result = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "OTHER-CUSTOMER" }));
    expect(result).toMatchObject({ status: "not_found", data: { tracking_verification: "not_found" } });
    expect(calls).toHaveLength(0);
  });

  it("rejects a same-customer history tracking number when another order is verified", async () => {
    const dependencies = await createDemoDependencies();
    const calls = [];
    const registry = createCapabilityRegistry({ ...dependencies, tracking: trackingProvider(calls) });

    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10233" }));

    expect(result).toMatchObject({ status: "not_found", data: { tracking_verification: "not_found", order_focus: { verified_order_number: "10231" } } });
    expect(calls).toHaveLength(0);
  });

  it("does not create a carrier cause when live tracking is not found", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_tracking",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_tracking",
          observedAt: "2026-09-04T12:00:00.000Z",
          error: { code: "tracking_not_found", message: "No tracking record was returned." },
        }),
      },
    });

    const result = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    expect(result.status).toBe("not_found");
    expect(result.data.live_tracking).toBeUndefined();
    expect(result.data).not.toHaveProperty("cause");
    expect(result.error).toMatchObject({ code: "tracking_not_found" });
  });

  it("allows an explicitly referenced second order to become the new request focus", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, orderReferences: ["10231", "10233"] });

    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = await registry.execute("get_order", JSON.stringify({ order_id: "10233" }));

    expect(result).toMatchObject({ status: "ok", data: { order_focus: { state: "verified", verified_order_number: "10233" } } });
  });

  it("extracts and verifies an explicit correction after an unresolved order", async () => {
    const dependencies = await correctionDependencies();
    const message = "Sorry, I meant order 1055.";
    const registry = createCapabilityRegistry({
      ...dependencies,
      orderReferences: extractOrderReferences(message),
      conversationContext: orderContext("1058", "unresolved"),
    });

    expect(extractOrderReferences(message)).toEqual(["1055"]);
    expect(registry.getActiveOrderFocus()).toMatchObject({ requestedOrderId: "1055", state: "unresolved" });

    const result = await registry.execute("get_order", JSON.stringify({ order_id: "1055" }));
    expect(result).toMatchObject({ status: "ok", data: { order_focus: { state: "verified", verified_order_number: "1055" } } });
  });

  it("keeps a failed corrected order as the new unresolved focus", async () => {
    const dependencies = await correctionDependencies();
    const message = "The correct order is #9999.";
    const registry = createCapabilityRegistry({
      ...dependencies,
      orderReferences: extractOrderReferences(message),
      conversationContext: orderContext("1058", "unresolved"),
    });

    const missing = await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    expect(missing).toMatchObject({ status: "not_found", data: { order_focus: { state: "unresolved", requested_order_id: "9999" } } });
    expect(registry.getActiveOrderFocus()).toMatchObject({ requestedOrderId: "9999", state: "unresolved" });

    const oldOrder = await registry.execute("get_order", JSON.stringify({ order_id: "1058" }));
    expect(oldOrder).toMatchObject({ status: "invalid_request", error: { code: "order_focus_conflict" } });
  });

  it("independently verifies an explicit replacement of a verified order", async () => {
    const dependencies = await correctionDependencies();
    const message = "The correct order is #1051.";
    const registry = createCapabilityRegistry({
      ...dependencies,
      orderReferences: extractOrderReferences(message),
      conversationContext: orderContext("1063", "verified"),
    });

    expect(registry.getActiveOrderFocus()).toMatchObject({ requestedOrderId: "1051", state: "unresolved" });
    const replacement = await registry.execute("get_order", JSON.stringify({ order_id: "1051" }));
    expect(replacement).toMatchObject({ status: "ok", data: { order_focus: { state: "verified", verified_order_number: "1051" } } });
  });

  it("does not replace a verified order from vague other-order language", async () => {
    const dependencies = await correctionDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      orderReferences: extractOrderReferences("What about my other order?"),
      conversationContext: orderContext("1063", "verified"),
    });

    expect(registry.getActiveOrderFocus()).toMatchObject({ requestedOrderId: "1063", state: "verified" });
    const guessed = await registry.execute("get_order", JSON.stringify({ order_id: "1051" }));
    expect(guessed).toMatchObject({ status: "invalid_request", error: { code: "order_focus_conflict" } });
  });

  it("fails safely when an explicit replacement is not in the current customer's data", async () => {
    const dependencies = await correctionDependencies(["1063"]);
    const message = "It is actually order 1051.";
    const registry = createCapabilityRegistry({
      ...dependencies,
      orderReferences: extractOrderReferences(message),
      conversationContext: orderContext("1063", "verified"),
    });

    const replacement = await registry.execute("get_order", JSON.stringify({ order_id: "1051" }));
    expect(replacement).toMatchObject({ status: "not_found", data: { order_focus: { state: "unresolved", requested_order_id: "1051" } } });
    expect(registry.getActiveOrderFocus()).toMatchObject({ requestedOrderId: "1051", state: "unresolved" });
  });
});
