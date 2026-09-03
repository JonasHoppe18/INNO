import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { StructuredResponseSchema, validateStructuredResponse } from "../response-contract";

function validate(registry, ...segments) {
  return validateStructuredResponse({ segments }, registry);
}

function deliveredTrackingProvider() {
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
          location: "Copenhagen",
          status: "delivered",
          subStatus: "delivered",
        },
        estimatedDelivery: null,
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
      text: "Order 10231 is fulfilled.",
      basis: { result_id: order.resultId, field_paths: ["fulfillmentStatus"] },
    });

    expect(result.allValid).toBe(true);
    expect(result.approvedSegments).toHaveLength(1);
  });

  it("rejects a field path that the tool did not return", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));

    const result = validate(registry, {
      type: "fact",
      text: "The order ships to this address.",
      basis: { result_id: order.resultId, field_paths: ["delivery_address"] },
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
      text: "The carrier has provided an ETA.",
      basis: { result_id: tracking.resultId, field_paths: ["live_tracking.estimatedDelivery"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("empty_field");
  });

  it("accepts a proposal mode but fails closed for an executed mode", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const proposal = validate(registry, {
      type: "action_offer",
      text: "I can prepare a cancellation request for your confirmation.",
      capability: "cancel_order",
      mode: "proposal",
    });
    const executed = validateStructuredResponse({
      segments: [{
        type: "action_offer",
        text: "The order was cancelled.",
        capability: "cancel_order",
        mode: "executed",
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
      text: "I can open a carrier case.",
      capability: "open_carrier_case",
      mode: "proposal",
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
      segments: [{ type: "action_offer", text: "The refund was executed.", capability: "create_refund", mode: "executed" }],
    }, registry);

    expect(guidance.allValid).toBe(true);
    expect(executed.schemaValid).toBe(false);
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
      text: "The carrier has not scanned the label yet.",
      basis: { result_id: tracking.resultId, field_paths: ["cause"] },
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
      text: "The parcel has been delivered.",
      basis: { result_id: tracking.resultId, field_paths: ["live_tracking.status", "live_tracking.latestEvent.description"] },
    });

    expect(result.allValid).toBe(true);
  });

  it("fails closed for invented evidence and follow-up capabilities", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const evidence = validate(registry, {
      type: "fact",
      text: "This is verified.",
      basis: { result_id: "tool_result_999", field_paths: ["status"] },
    });
    const capability = validate(registry, {
      type: "question",
      text: "Can you provide the missing information?",
      follow_up_capability: "invented_lookup",
      follow_up_fields: ["anything"],
    });

    expect(evidence.allValid).toBe(false);
    expect(evidence.issues[0].code).toBe("unknown_result_id");
    expect(capability.allValid).toBe(false);
    expect(capability.issues[0].code).toBe("unknown_follow_up_capability");
  });
});
