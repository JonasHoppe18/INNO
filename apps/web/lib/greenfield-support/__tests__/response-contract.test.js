import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { inferResponseLocale, StructuredResponseSchema, renderResponseSegments, validateStructuredResponse } from "../response-contract";

function validate(registry, ...segments) {
  return validateStructuredResponse({ segments }, registry);
}

function deliveredTrackingProvider(options = {}) {
  const { location = "Copenhagen", estimatedDelivery = null } = options;
  return {
    providerName: "test_ship24",
    lookup: async (input) => ({
      status: "ok",
      data: {
        trackingNumber: input.trackingNumber,
        carrier: "Bring",
        status: "delivered",
        subStatus: "delivered",
        latestEvent: {
          description: "The parcel has been delivered.",
          timestamp: "2026-09-03T12:00:00.000Z",
          location,
          status: "delivered",
          subStatus: "delivered",
        },
        estimatedDelivery,
        checkpoints: [],
        exception: null,
        observedAt: "2026-09-03T12:00:00.000Z",
        provider: "test_ship24",
        source: "test",
      },
    }),
  };
}

describe("structured response contract", () => {
  it("accepts a pure acknowledgement without tool evidence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, { type: "acknowledgement", kind: "resolution" });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe("Glad to hear that’s sorted.");
  });

  it("does not re-ask an explicit unresolved order number", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, orderReferences: ["9999"] });
    const lookup = await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    expect(lookup.status).toBe("not_found");

    const responseContext = { ...registry, activeOrder: registry.getActiveOrderFocus() };
    const result = validateStructuredResponse({
      segments: [{ type: "question", purpose: "enable_capability", text: null, capability: "get_order", missing_arguments: ["order_id"] }],
    }, responseContext);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, responseContext);
    expect(rendered).toContain("couldn’t verify order #9999");
    expect(rendered).toContain("different valid order number or order identifier");
    expect(rendered).not.toContain("couldn’t find an order with number #9999");
    expect(rendered).not.toContain("send the order number from your order confirmation");
  });

  it("allows product clarification before any lookup when the product is missing", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "clarify_task",
        text: "Which product or model are you having trouble with, and what is happening?",
        capability: null,
        missing_arguments: [],
      }],
    }, {
      ...registry,
      customerMessage: "My headset is broken. What can you help with?",
      customerProvidedContext: { issue: "My headset is broken" },
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerMessage: "My headset is broken. What can you help with?",
      customerProvidedContext: { issue: "My headset is broken" },
    })).toContain("Which product or model");
  });

  it("allows task clarification when the product is known but the issue is broad", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "clarify_task",
        text: "What problem are you experiencing with it?",
        capability: null,
        missing_arguments: [],
      }],
    }, {
      ...registry,
      customerMessage: "My A-Spire Wireless is broken.",
      customerProvidedContext: { product: "A-Spire Wireless", issue: "My A-Spire Wireless is broken" },
    });

    expect(result.allValid).toBe(true);
  });

  it("allows a clarification for missing context without fabricating a tool result", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "clarify_task",
        text: "Which product are you using, and what would you like help with?",
        capability: null,
        missing_arguments: [],
      }],
    }, { ...registry, customerMessage: "I need help with my headset." });

    expect(result.allValid).toBe(true);
  });

  it("uses a trusted first-name greeting only on the first substantive response", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "ignored",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerName: "Jonas Hoppe",
      firstResponse: true,
    })).toMatch(/^Hi Jonas!\n\n/);
    expect(renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerName: "Jonas Hoppe",
      firstResponse: false,
    })).not.toContain("Hi Jonas!");
  });

  it("keeps acknowledgement structurally unable to carry claims or promises", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const operationalClaim = validateStructuredResponse({
      segments: [{
        type: "acknowledgement",
        kind: "resolution",
        text: "The carrier delivered it correctly.",
        evidence: [{ result_id: "tool_result_1", field_paths: ["status"] }],
      }],
    }, registry);
    const actionPromise = validateStructuredResponse({
      segments: [{
        type: "acknowledgement",
        kind: "closure",
        capability: "create_refund",
        promise: "I will refund it now.",
      }],
    }, registry);

    expect(operationalClaim.schemaValid).toBe(false);
    expect(actionPromise.schemaValid).toBe(false);
  });

  it("combines an acknowledgement with evidence-backed knowledge without weakening the factual segment", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry,
      { type: "acknowledgement", kind: "transition" },
      {
        type: "knowledge_guidance",
        text: "Returns are accepted within 30 days of delivery.",
        basis: { result_id: knowledge.resultId, field_paths: ["results"] },
      },
    );
    const unsupportedFact = validate(registry,
      { type: "acknowledgement", kind: "transition" },
      {
        type: "knowledge_guidance",
        text: "This is not supported by a current tool result.",
        basis: { result_id: "outside-run", field_paths: ["results"] },
      },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Got it.");
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("30 days");
    expect(unsupportedFact.approvedSegments).toEqual([{ type: "acknowledgement", kind: "transition" }]);
    expect(unsupportedFact.issues[0].code).toBe("unknown_result_id");
  });

  it("accepts a verified fact that cites a returned field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));

    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus", "status"] }],
    });

    expect(result.allValid).toBe(true);
    expect(result.approvedSegments).toHaveLength(1);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("has shipped");
    expect(rendered).not.toContain("delivered");
  });

  it("renders the verified financial status value", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_financial_status",
      evidence: [{ result_id: order.resultId, field_paths: ["financialStatus"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("paid");
  });

  it("renders the verified carrier value", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_carrier",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillments[0].carrier"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("ParcelCo");
  });

  it("rejects a field path that the tool did not return", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));

    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["delivery_address"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.approvedSegments).toEqual([]);
    expect(result.issues[0].code).toBe("unknown_field_path");
  });

  it("rejects a fact based on a null returned field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));

    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_eta",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.estimatedDelivery"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("empty_field");
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toContain("Estimated delivery");
  });

  it("accepts a proposal mode but fails closed for an executed mode", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const proposal = validate(registry, {
      type: "action_offer",
      capability: "cancel_order",
      mode: "proposal",
      missing_arguments: [],
    });
    const executed = validateStructuredResponse({
      segments: [{
        type: "action_offer",
        capability: "cancel_order",
        mode: "executed",
        missing_arguments: [],
      }],
    }, registry);

    expect(proposal.allValid).toBe(true);
    expect(StructuredResponseSchema.safeParse(executed.parsed).success).toBe(false);
    expect(executed.schemaValid).toBe(false);
  });

  it("rejects an action that is not in the current manifest", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "action_offer",
      capability: "open_carrier_case",
      mode: "proposal",
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unknown_action_capability");
  });

  it("requires an action offer to be backed by a proposal tool result", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }],
    }, { ...registry, proposedActions: [] });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("action_not_proposed");
  });

  it("rejects unsupported operational commitments in free-form segments", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "shipping" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "I can get the team to put the order on hold while you are away.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("does not mistake a tracking limitation for an operational promise", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "limitation",
      text: "I can see the tracking number, but the provider returned no live record. I can advise on the next step.",
      basis: { result_id: order.resultId, field_paths: ["fulfillments[0].trackingNumber"] },
    });

    expect(result.allValid).toBe(true);
  });

  it("rejects free-form proposal language when no action offer exists", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "shipping" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "I can prepare a proposal for cancellation.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("does not let a free-form question smuggle an unsupported action offer", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Do you want us to cancel the order instead?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("rejects operational alternatives hidden inside a clarification question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Do you mean delay the unshipped items, or cancel them and reorder on Friday?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("rejects preference questions that smuggle unsupported operational alternatives", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Which option do you prefer: cancel and re-order on Friday, or keep it as-is?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("rejects a future proposal promise separated from its setup by supporting context", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "shipping" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "I cannot verify the carrier from here. Could you share the new address so I can prepare a proposal for an address update?",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("allows authoritative knowledge guidance but does not turn it into execution", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const guidance = validate(registry, {
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });
    const executed = validateStructuredResponse({
      segments: [{ type: "action_offer", capability: "create_refund", mode: "executed", missing_arguments: [] }],
    }, registry);

    expect(guidance.allValid).toBe(true);
    expect(executed.schemaValid).toBe(false);
  });

  it("accepts reference product knowledge as product guidance", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_product_knowledge", JSON.stringify({ query: "wireless receiver" }));
    const guidance = validate(registry, {
      type: "knowledge_guidance",
      text: "The Orion Wireless uses Bluetooth and the included USB receiver.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(guidance.allValid).toBe(true);
  });

  it("does not let reference product knowledge authorize policy or procedure guidance", async () => {
    const dependencies = await createDemoDependencies();
    const productOnlyKnowledge = {
      ingest: (...args) => dependencies.knowledge.ingest(...args),
      search: async (request) => dependencies.knowledge.search({ ...request, knowledgeTypes: ["product"] }),
    };
    const registry = createCapabilityRegistry({ ...dependencies, knowledge: productOnlyKnowledge });
    const policyResult = await registry.execute("search_policy", JSON.stringify({ query: "wireless" }));
    const procedureResult = await registry.execute("search_procedures", JSON.stringify({ query: "wireless" }));
    const policyGuidance = validate(registry, {
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days.",
      basis: { result_id: policyResult.resultId, field_paths: ["results"] },
    });
    const procedureGuidance = validate(registry, {
      type: "knowledge_guidance",
      text: "Reset the headset and pair it again.",
      basis: { result_id: procedureResult.resultId, field_paths: ["results"] },
    });

    expect(policyGuidance.allValid).toBe(false);
    expect(policyGuidance.issues[0].code).toBe("knowledge_authority_insufficient");
    expect(procedureGuidance.allValid).toBe(false);
    expect(procedureGuidance.issues[0].code).toBe("knowledge_authority_insufficient");
  });

  it("represents live product values without using order-item semantics", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProduct() {
          return {
            status: "ok",
            products: [{ title: "Aurora Headset", handle: "aurora-headset", variants: [{ title: "Black", sku: "AUR-BLK" }] }],
          };
        },
      },
    });
    const product = await registry.execute("get_product", JSON.stringify({ query: "Aurora Headset" }));
    const title = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].title"] }],
    });
    const orderItem = validate(registry, {
      type: "fact",
      fact_kind: "order_item",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].title"] }],
    });
    const sku = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].sku"] }],
    });

    expect(title.allValid).toBe(true);
    expect(renderResponseSegments(title.approvedSegments, registry)).toBe("The product is Aurora Headset.");
    expect(orderItem.allValid).toBe(false);
    expect(orderItem.issues[0].code).toBe("fact_field_kind_mismatch");
    expect(sku.allValid).toBe(true);
    expect(renderResponseSegments(sku.approvedSegments, registry)).toBe("The product SKU is AUR-BLK.");
  });

  it("fails closed for inventory, unknown, and null product fields", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProduct() {
          return {
            status: "ok",
            products: [{ title: "Aurora Headset", variants: [{ title: "Black", sku: null, inventory_quantity: 7 }] }],
          };
        },
      },
    });
    const product = await registry.execute("get_product", JSON.stringify({ query: "Aurora Headset" }));
    expect(product.data.products[0].variants[0]).not.toHaveProperty("inventory_quantity");
    const inventory = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].inventory_quantity"] }],
    });
    const unknown = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].made_up_field"] }],
    });
    const nullSku = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].sku"] }],
    });

    expect(inventory.allValid).toBe(false);
    expect(inventory.issues[0].code).toBe("unknown_field_path");
    expect(unknown.allValid).toBe(false);
    expect(unknown.issues[0].code).toBe("unknown_field_path");
    expect(nullSku.allValid).toBe(false);
    expect(nullSku.issues[0].code).toBe("empty_field");
  });

  it("allows a limitation for Ship24 not_found but rejects an unsupported cause fact", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
          error: { code: "tracking_not_found", message: "No live record was returned." },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const limitation = validate(registry, {
      type: "limitation",
      text: "I could not retrieve a live tracking event.",
      basis: { result_id: tracking.resultId, field_paths: [] },
    });
    const unsupportedCause = validate(registry, {
      type: "fact",
      fact_kind: "shipment_event",
      evidence: [{ result_id: tracking.resultId, field_paths: ["cause"] }],
    });

    expect(limitation.allValid).toBe(true);
    expect(unsupportedCause.allValid).toBe(false);
    expect(unsupportedCause.issues[0].code).toBe("result_not_verified");
  });

  it("accepts a delivered fact when Ship24 returned a delivered event", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tracking: deliveredTrackingProvider() });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_status",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.status"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("delivered");
  });

  it("does not render a location fact when the verified location is null", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tracking: deliveredTrackingProvider({ location: null }) });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_location",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.latestEvent.location"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("empty_field");
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toContain("Tracking location");
  });

  it("renders an order item from the verified title and quantity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_item",
      evidence: [{ result_id: order.resultId, field_paths: ["items[0].title", "items[0].quantity"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("1 × Orion Wireless");
  });

  it("fails closed for an unknown operational field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["inventedFulfillmentStatus"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.approvedSegments).toEqual([]);
    expect(result.issues[0].code).toBe("unknown_field_path");
  });

  it("never lets a model value replace the returned operational value", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const inventedValue = validateStructuredResponse({
      segments: [{
        type: "fact",
        fact_kind: "order_fulfillment_status",
        evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }],
        value: "delivered",
      }],
    }, registry);
    const verified = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }],
    });

    expect(inventedValue.schemaValid).toBe(false);
    expect(renderResponseSegments(verified.approvedSegments, registry)).toContain("has shipped");
    expect(renderResponseSegments(verified.approvedSegments, registry)).not.toContain("delivered");
  });

  it("validates capability-enabling questions against the existing tool schema", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const valid = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "Send the order number.",
      capability: "get_order",
      missing_arguments: ["order_id"],
    });
    const unknownCapability = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "Send the details.",
      capability: "get_order/get_order_history",
      missing_arguments: ["order_id"],
    });
    const unknownArgument = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "Send the address.",
      capability: "get_order",
      missing_arguments: ["delivery_address"],
    });

    expect(valid.allValid).toBe(true);
    expect(unknownCapability.allValid).toBe(false);
    expect(unknownCapability.issues[0].code).toBe("unknown_question_capability");
    expect(unknownArgument.allValid).toBe(false);
    expect(unknownArgument.issues[0].code).toBe("question_argument_not_in_schema");
  });

  it("does not turn a shipping destination question into an address action", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policyQuestion = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "enable_capability",
        text: "Send the order number and new address.",
        capability: "update_address",
        missing_arguments: ["order_id", "address"],
      }],
    }, { ...registry, customerMessage: "Can you ship my order to Japan?" });
    const explicitChange = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "enable_capability",
        text: "Send the order number and new address.",
        capability: "update_address",
        missing_arguments: ["order_id", "address"],
      }],
    }, { ...registry, customerMessage: "Please change the shipping address on order #10232." });

    expect(policyQuestion.allValid).toBe(false);
    expect(policyQuestion.issues[0].code).toBe("address_change_request_required");
    expect(explicitChange.allValid).toBe(true);
  });

  it("keeps pure clarification separate from capability commitments", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const pure = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Do you mean the wireless or wired version?",
      capability: null,
      missing_arguments: [],
    });
    const smuggled = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Send your address and I will change it.",
      capability: "update_address",
      missing_arguments: ["address"],
    });

    expect(pure.allValid).toBe(true);
    expect(smuggled.allValid).toBe(false);
    expect(smuggled.issues[0].code).toBe("pure_question_has_capability");
  });

  it("renders action wording from the validated capability, not model prose", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const action = validate(registry, {
      type: "action_offer",
      capability: "update_address",
      mode: "proposal",
      missing_arguments: ["order_id", "address", "reason"],
    });

    expect(action.allValid).toBe(true);
    const { renderResponseSegments } = await import("../response-contract");
    const rendered = renderResponseSegments(action.approvedSegments, registry);
    expect(rendered).toContain("prepare a proposal for an address update");
    expect(rendered).toContain("will not be completed");
    expect(rendered).not.toContain("hold");
    expect(rendered).not.toContain("carrier");
  });

  it("renders a valid read follow-up from the capability schema", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const question = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "This text is not used to authorize the next operation.",
      capability: "get_order",
      missing_arguments: ["order_id"],
    });

    const { renderResponseSegments } = await import("../response-contract");
    const rendered = renderResponseSegments(question.approvedSegments, registry);
    expect(rendered).toContain("order number from your order confirmation");
    expect(rendered).not.toContain("Please provide");
    expect(rendered).not.toContain("not used to authorize");
  });

  it("composes related order facts into a concise customer sentence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_reference", evidence: [{ result_id: order.resultId, field_paths: ["orderNumber"] }] },
      { type: "fact", fact_kind: "order_item", evidence: [{ result_id: order.resultId, field_paths: ["items"] }] },
      { type: "fact", fact_kind: "order_financial_status", evidence: [{ result_id: order.resultId, field_paths: ["financialStatus"] }] },
      { type: "fact", fact_kind: "order_fulfillment_status", evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }] },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe(
      "I’ve checked order #10231, and it is paid, has shipped, and includes 1 × Orion Wireless.",
    );
  });

  it("keeps fulfillment distinct from a delivered tracking status", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const fulfilled = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }],
    });
    const deliveredRegistry = createCapabilityRegistry({ ...dependencies, tracking: deliveredTrackingProvider() });
    const deliveredOrder = await deliveredRegistry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await deliveredRegistry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const delivered = validate(deliveredRegistry, {
      type: "fact",
      fact_kind: "shipment_status",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.status"] }],
    });

    expect(renderResponseSegments(fulfilled.approvedSegments, registry)).toContain("has shipped");
    expect(renderResponseSegments(fulfilled.approvedSegments, registry)).not.toContain("delivered");
    expect(renderResponseSegments(delivered.approvedSegments, deliveredRegistry)).toContain("has been delivered");
    expect(deliveredOrder.status).toBe("ok");
  });

  it("combines carrier and tracking number without provider labels", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "shipment_carrier", evidence: [{ result_id: order.resultId, field_paths: ["fulfillments[0].carrier"] }] },
      { type: "fact", fact_kind: "shipment_tracking_number", evidence: [{ result_id: order.resultId, field_paths: ["fulfillments[0].trackingNumber"] }] },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe(
      "Your package is being handled by ParcelCo. Track your package here: https://tracking.example.test/PC10231",
    );
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toMatch(/^(Carrier|Tracking number):/m);
  });

  it("renders a natural localized order-ID question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "ignored",
      capability: "get_order",
      missing_arguments: ["order_id"],
    });

    expect(inferResponseLocale("Hvor er min ordre #10231?")).toBe("da");
    expect(renderResponseSegments(result.approvedSegments, { ...registry, locale: "da" })).toBe(
      "Kan du sende ordrenummeret fra din ordrebekræftelse?",
    );
  });

  it("renders a helpful limitation without inventing a tracking cause", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
          error: { code: "tracking_not_found", message: "No live record was returned." },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry, {
      type: "limitation",
      text: "No active tracking record was returned from the tracking provider.",
      basis: { result_id: tracking.resultId, field_paths: [] },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, { ...registry, locale: "da" });
    expect(rendered).toContain("Pakken sendes med ParcelCo.");
    expect(rendered).toContain("Du kan følge pakken her: https://tracking.example.test/PC10231");
    expect(rendered).toContain("Jeg kunne ikke finde en live trackingopdatering på pakken.");
    expect(rendered).not.toMatch(/fordi|because|provider|årsag/i);
  });

  it("distinguishes tracking provider unavailability and drops a question that cannot unlock another capability", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "unavailable",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
          error: { code: "tracking_provider_unavailable", message: "Provider unavailable." },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "The live provider is unavailable.",
        basis: { result_id: tracking.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "What does the tracking page show?",
        capability: null,
        missing_arguments: [],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("Your package is being handled by ParcelCo.");
    expect(rendered).toContain("Track your package here: https://tracking.example.test/PC10231");
    expect(rendered).toContain("I can’t retrieve a live tracking update for this shipment right now.");
    expect(rendered).not.toContain("What does the tracking page show?");
    expect(rendered).not.toContain("delivered");
  });

  it("keeps a relevant customer clarification after a tracking not_found result", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "No live tracking record was returned.",
        basis: { result_id: tracking.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "Does the tracking page show an error or simply no events?",
        capability: null,
        missing_arguments: [],
      },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Does the tracking page show an error or simply no events?");
  });

  it("turns availability not_found into a useful alternate-identifier next step", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProductAvailability(query) {
          return { status: "not_found", query };
        },
      },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "No Such Chaos 999" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "The product was not found.",
        basis: { result_id: availability.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: "Which product name or SKU should I check for availability?",
        capability: "get_product_availability",
        missing_arguments: ["query"],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("couldn’t find a matching product or variant");
    expect(rendered).toContain("SKU or product link");
    expect(rendered).not.toContain("Which product name or SKU");
    expect(rendered).not.toContain("out of stock");
  });

  it("does not ask for more product data while availability is unavailable", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProductAvailability(query) {
          return { status: "unavailable", query };
        },
      },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "A-Blaze" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "The availability lookup is unavailable.",
        basis: { result_id: availability.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "Which version or SKU do you mean?",
        capability: null,
        missing_arguments: [],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toBe("I can’t check the current availability right now.");
  });

  it("treats a nested unknown availability result as unknown when the customer already named the product", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProductAvailability() {
          return { status: "unknown", query: "", products: [] };
        },
      },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "Availability could not be established.",
        basis: { result_id: availability.resultId, field_paths: ["data.status"] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: "Which product name or SKU should I check for availability?",
        capability: "get_product_availability",
        missing_arguments: ["query"],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerMessage: "Can I buy No Such Chaos 999 right now?",
    });
    expect(rendered).toContain("because the lookup did not include a specific product or variant");
    expect(rendered).toContain("Which product name or SKU should I check for availability?");
  });

  it("keeps an action-related question when an unrelated tracking lookup is limited", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "No live tracking record was returned.",
        basis: { result_id: tracking.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: "What reason should I use for the replacement request?",
        capability: "send_replacement",
        missing_arguments: ["order_id", "item_id", "reason"],
      },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Could you share the order number, the item ID, and the reason");
  });

  it("keeps order history items bound to their own order", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const history = await registry.execute("get_order_history", JSON.stringify({}));
    const result = validate(registry,
      {
        type: "fact",
        fact_kind: "order_reference",
        evidence: [{ result_id: history.resultId, field_paths: ["data.orders[0].orderNumber", "data.orders[1].orderNumber"] }],
      },
      {
        type: "fact",
        fact_kind: "order_item",
        evidence: [{ result_id: history.resultId, field_paths: ["data.orders[0].items", "data.orders[1].items"] }],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("#10231: 1 × Orion Wireless");
    expect(rendered).toContain("#10232: 1 × Orion Wired");
    expect(rendered).not.toContain("#10231: 1 × Orion Wired");
  });

  it("aggregates repeated returned order lines instead of deduplicating quantity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getOrder(orderId) {
          const order = await dependencies.commerce.getOrder(orderId);
          return order ? { ...order, items: [
            { id: "line-a", title: "Orion Wireless", quantity: 1 },
            { id: "line-b", title: "Orion Wireless", quantity: 2 },
          ] } : null;
        },
      },
    });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_reference", evidence: [{ result_id: order.resultId, field_paths: ["data.orderNumber"] }] },
      { type: "fact", fact_kind: "order_item", evidence: [{ result_id: order.resultId, field_paths: ["data.items"] }] },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("3 × Orion Wireless");
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toContain("1 × Orion Wireless");
  });

  it("does not pair a latest timestamp with an older checkpoint location", async () => {
    const dependencies = await createDemoDependencies();
    const tracking = deliveredTrackingProvider({ location: null });
    const originalLookup = tracking.lookup;
    tracking.lookup = async (input) => {
      const result = await originalLookup(input);
      result.data.checkpoints = [{
        description: "Older scan",
        timestamp: "2026-09-03T10:00:00.000Z",
        location: "Older location",
      }];
      return result;
    };
    const registry = createCapabilityRegistry({ ...dependencies, tracking });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const live = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "shipment_status", evidence: [{ result_id: live.resultId, field_paths: ["data.live_tracking.status"] }] },
      { type: "fact", fact_kind: "shipment_timestamp", evidence: [{ result_id: live.resultId, field_paths: ["data.live_tracking.latestEvent.timestamp"] }] },
      { type: "fact", fact_kind: "shipment_location", evidence: [{ result_id: live.resultId, field_paths: ["data.live_tracking.checkpoints[0].location"] }] },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("The latest scan was on");
    expect(rendered).not.toContain("Older location");
  });

  it("uses customer-facing wording when procedure knowledge is not found", async () => {
    const dependencies = await createDemoDependencies();
    const knowledge = {
      ingest: (...args) => dependencies.knowledge.ingest(...args),
      search: async () => [],
    };
    const registry = createCapabilityRegistry({ ...dependencies, knowledge });
    const procedure = await registry.execute("search_procedures", JSON.stringify({ query: "reset unknown headset" }));
    const result = validate(registry, {
      type: "limitation",
      text: "Knowledge retrieval returned no evidence.",
      basis: { result_id: procedure.resultId, field_paths: [] },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toBe("I couldn’t verify a support procedure for this issue from our current guidance.");
    expect(rendered).not.toMatch(/retrieval|database|system/i);
  });

  it("states the useful partial-fulfillment distinction without inventing item allocation", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getOrder(orderId) {
          const order = await dependencies.commerce.getOrder(orderId);
          return order ? { ...order, fulfillmentStatus: "partial" } : null;
        },
      },
    });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_reference", evidence: [{ result_id: order.resultId, field_paths: ["orderNumber"] }] },
      { type: "fact", fact_kind: "order_fulfillment_status", evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }] },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("has shipped some items while others are still unfulfilled");
    expect(rendered).not.toContain("delivered");
    expect(rendered).not.toContain("missing item");
  });

  it("keeps proposal safety intact while composing action wording", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry,
      {
        type: "question",
        purpose: "enable_capability",
        text: "ignored",
        capability: "create_refund",
        missing_arguments: ["order_id", "amount", "reason"],
      },
      {
        type: "action_offer",
        capability: "create_refund",
        mode: "proposal",
        missing_arguments: ["order_id", "amount", "reason"],
      },
    );

    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("proposal");
    expect(rendered).toContain("will not be completed without your confirmation");
    expect(rendered).not.toMatch(/has been refunded|was refunded/i);
    expect(rendered.match(/Could you share/g)).toHaveLength(1);
  });

  it("fails closed for invented evidence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const evidence = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: "tool_result_999", field_paths: ["fulfillmentStatus"] }],
    });
    expect(evidence.allValid).toBe(false);
    expect(evidence.issues[0].code).toBe("unknown_result_id");
  });
});
