import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { StructuredResponseSchema, renderResponseSegments, validateStructuredResponse } from "../response-contract";

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
    expect(rendered).toContain("fulfilled");
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
    expect(renderResponseSegments(title.approvedSegments, registry)).toBe("Product: Aurora Headset.");
    expect(orderItem.allValid).toBe(false);
    expect(orderItem.issues[0].code).toBe("fact_field_kind_mismatch");
    expect(sku.allValid).toBe(true);
    expect(renderResponseSegments(sku.approvedSegments, registry)).toBe("Product SKU: AUR-BLK.");
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
    expect(renderResponseSegments(verified.approvedSegments, registry)).toContain("fulfilled");
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
    expect(rendered).toContain("propose an address update");
    expect(rendered).toContain("not been completed");
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
    expect(rendered).toContain("order ID");
    expect(rendered).toContain("look up");
    expect(rendered).not.toContain("not used to authorize");
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
