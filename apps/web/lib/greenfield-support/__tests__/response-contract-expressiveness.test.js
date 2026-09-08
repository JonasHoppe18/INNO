import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { renderResponseSegments, validateStructuredResponse } from "../response-contract";

function validate(registry, ...segments) {
  return validateStructuredResponse({ segments }, registry);
}

function grounded(registry, segment) {
  return validateStructuredResponse({ segments: [segment] }, registry);
}

function ambiguousAvailability() {
  return {
    status: "ambiguous",
    selection: "ambiguous",
    products: [{
      title: "Chaos Headset 4",
      variants: [
        { title: "Purple / M", availability_state: "AVAILABLE" },
        { title: "White / L", availability_state: "OUT_OF_STOCK" },
      ],
    }],
  };
}

function unresolvedKnowledge() {
  return {
    ingest: async () => ({}),
    search: async () => [],
  };
}

describe("response contract expressiveness", () => {
  it("A: accepts a grounded variant clarification after partial availability resolution", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: { ...dependencies.commerce, async getProductAvailability() { return ambiguousAvailability(); } },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "Chaos Headset 4" }));
    const result = grounded(registry, {
      type: "question",
      purpose: "disambiguate_variant",
      text: "Which variant should I check?",
      capability: "get_product_availability",
      missing_arguments: ["variant"],
      basis: { result_id: availability.resultId, field_paths: ["data.products"] },
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Which Chaos Headset 4 variant");
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Purple / M");
  });

  it("B: does not accept a task clarification that re-asks known product context", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, knowledge: unresolvedKnowledge() });
    await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless troubleshooting" }));
    const result = validateStructuredResponse({ segments: [{
      type: "question",
      purpose: "clarify_task",
      text: "What exact model number is printed on the headset?",
      capability: null,
      missing_arguments: [],
    }] }, { ...registry, customerProvidedContext: { product: "A-Spire Wireless" } });

    expect(result.allValid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "known_context_reasked")).toBe(true);
  });

  it("C: allows a task clarification after a corrected product remains unresolved", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, knowledge: unresolvedKnowledge() });
    await registry.execute("search_product_knowledge", JSON.stringify({ query: "A-Rise Wireless PlayStation 5" }));
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "Which compatibility detail should I verify?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe("Which compatibility detail should I verify?");
  });

  it("allows a missing model clarification before any lookup runs", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "Which headset model are you using?",
      capability: null,
      missing_arguments: [],
      basis: null,
    });
    const responseContext = {
      ...registry,
      customerMessage: "It will not connect. Which model are you using?",
      customerProvidedContext: { issue: "It will not connect" },
    };
    const contextualResult = validateStructuredResponse({ segments: result.parsed.segments }, responseContext);

    expect(contextualResult.allValid).toBe(true);
    expect(renderResponseSegments(contextualResult.approvedSegments, responseContext)).toBe("Which headset model are you using?");
  });

  it("allows a missing task clarification when the customer only supplied a broad issue", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "What exactly is wrong with the headset—for example, is it a power, connection, sound, or physical-damage issue?",
      capability: null,
      missing_arguments: [],
      basis: null,
    });
    const responseContext = {
      ...registry,
      customerMessage: "My headset is broken. What can you help with?",
      customerProvidedContext: { issue: "My headset is broken" },
    };
    const contextualResult = validateStructuredResponse({ segments: result.parsed.segments }, responseContext);

    expect(contextualResult.allValid).toBe(true);
    expect(renderResponseSegments(contextualResult.approvedSegments, responseContext)).toBe(result.parsed.segments[0].text);
  });

  it("rejects a context-only product re-ask when the model is already known", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "Which headset model are you using?",
      capability: null,
      missing_arguments: [],
      basis: null,
    });
    const contextualResult = validateStructuredResponse({ segments: result.parsed.segments }, {
      ...registry,
      customerMessage: "My A-Spire Wireless will not connect.",
      customerProvidedContext: { product: "A-Spire Wireless", issue: "My A-Spire Wireless will not connect" },
    });

    expect(contextualResult.allValid).toBe(false);
  });

  it("rejects a context-only task re-ask when the issue is already specific", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "What exactly is wrong with the headset?",
      capability: null,
      missing_arguments: [],
      basis: null,
    });
    const contextualResult = validateStructuredResponse({ segments: result.parsed.segments }, {
      ...registry,
      customerMessage: "My A-Spire Wireless will not connect.",
      customerProvidedContext: { product: "A-Spire Wireless", issue: "My A-Spire Wireless will not connect" },
    });

    expect(contextualResult.allValid).toBe(false);
  });

  it("does not approve an unsupported arbitrary context-only question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "What is your favorite color?",
      capability: null,
      missing_arguments: [],
      basis: null,
    });
    const contextualResult = validateStructuredResponse({ segments: result.parsed.segments }, {
      ...registry,
      customerMessage: "My headset is broken.",
      customerProvidedContext: { issue: "My headset is broken" },
    });

    expect(contextualResult.allValid).toBe(false);
  });

  it("accepts an unresolved-order clarification when its basis includes null verification fields", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, orderReferences: ["9999"] });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    const result = grounded(registry, {
      type: "question",
      purpose: "disambiguate_entity",
      text: "Could you share another order number or the platform order ID?",
      capability: "get_order",
      missing_arguments: ["different order number or platform order ID"],
      basis: {
        result_id: order.resultId,
        field_paths: [
          "data.order_focus.requested_order_id",
          "data.order_focus.verified_order_id",
          "data.order_focus.verified_order_number",
        ],
      },
    });

    expect(result.allValid).toBe(true);
  });

  it("D: grounds a clarification in insufficient procedure task specificity", async () => {
    const dependencies = await createDemoDependencies();
    const record = {
      id: "procedure-ambiguous",
      workspaceId: "demo",
      knowledgeType: "procedural",
      authority: "authoritative",
      title: "Headset support procedure",
      content: "Support procedure",
      structuredData: { applies_to: {}, procedure_steps: [{ text: "Do not use this step without a specific task." }] },
      sourceKind: "fixture",
      sourceId: "procedure-ambiguous",
      sourceUri: null,
      sourceLabel: "fixture",
      contentHash: "procedure-ambiguous",
      publishedAt: null,
      observedAt: null,
      expiresAt: null,
      metadata: {},
      chunks: ["Support procedure"],
    };
    const registry = createCapabilityRegistry({
      ...dependencies,
      knowledge: { ingest: async () => record, search: async () => [{ record, score: 0.5, taskRelevance: 0, taskTitleMatches: 0, taskBodyMatches: 0, matchReason: "lexical", rank: 1, evidenceSections: [] }] },
    });
    const procedure = await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless headset support" }));
    expect(procedure.data.task_specificity).toBe("insufficient");
    const result = grounded(registry, {
      type: "question",
      purpose: "clarify_task",
      text: "Is the problem pairing, detection, or disconnection?",
      capability: null,
      missing_arguments: [],
      basis: { result_id: procedure.resultId, field_paths: ["data.task_specificity"] },
    });

    expect(result.allValid).toBe(true);
  });

  it("E/G: binds an item title-only citation to quantity from the same normalized item", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = grounded(registry, {
      type: "fact",
      fact_kind: "order_item",
      evidence: [{ result_id: order.resultId, field_paths: ["data.items[0].title"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("1 × Orion Wireless");
  });

  it("F: rejects cross-item title and quantity binding", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getOrder(orderId) {
          const order = await dependencies.commerce.getOrder(orderId);
          return order ? { ...order, items: [
            { id: "line-a", title: "Orion Wireless", quantity: 1 },
            { id: "line-b", title: "Orion Wired", quantity: 2 },
          ] } : null;
        },
      },
    });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = grounded(registry, {
      type: "fact",
      fact_kind: "order_item",
      evidence: [{ result_id: order.resultId, field_paths: ["data.items[0].title", "data.items[1].quantity"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("order_item_fields_required");
  });

  it("H: accepts a checkpoint event and keeps its timestamp/location together", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "ok",
          data: {
            trackingNumber: input.trackingNumber,
            carrier: "Bring",
            status: "in_transit",
            subStatus: "in_transit",
            latestEvent: null,
            estimatedDelivery: null,
            checkpoints: [{ description: "Arrived at Copenhagen hub", timestamp: "2026-09-03T12:00:00.000Z", location: "Copenhagen" }],
            exception: null,
            observedAt: "2026-09-03T12:00:00.000Z",
            provider: "test_ship24",
            source: "test",
          },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "shipment_status", evidence: [{ result_id: tracking.resultId, field_paths: ["data.live_tracking.status"] }] },
      { type: "fact", fact_kind: "shipment_event", evidence: [{ result_id: tracking.resultId, field_paths: ["data.live_tracking.checkpoints[0].description"] }] },
      { type: "fact", fact_kind: "shipment_timestamp", evidence: [{ result_id: tracking.resultId, field_paths: ["data.live_tracking.checkpoints[0].timestamp"] }] },
      { type: "fact", fact_kind: "shipment_location", evidence: [{ result_id: tracking.resultId, field_paths: ["data.live_tracking.checkpoints[0].location"] }] },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("Arrived at Copenhagen hub");
    expect(rendered).toContain("Copenhagen");
  });

  it("I: keeps valid verified facts when an unrelated question is rejected", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_item", evidence: [{ result_id: order.resultId, field_paths: ["data.items"] }] },
      { type: "question", purpose: "enable_capability", text: "Send the delivery address.", capability: "get_order", missing_arguments: ["delivery_address"] },
    );

    expect(result.allValid).toBe(false);
    expect(result.approvedSegments).toHaveLength(1);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Orion Wireless");
  });

  it("J/K: rejects unsupported claims and does not treat customer context as verified evidence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, orderReferences: ["9999"] });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    const unsupported = grounded(registry, {
      type: "fact",
      fact_kind: "order_reference",
      evidence: [{ result_id: order.resultId, field_paths: ["data.order_focus.requested_order_id"] }],
    });

    expect(unsupported.allValid).toBe(false);
    expect(unsupported.issues[0].code).toBe("result_not_verified");

    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "Chaos Headset 4 Purple / M" }));
    const unsupportedQuestion = grounded(registry, {
      type: "question",
      purpose: "disambiguate_variant",
      text: "Which variant should I check?",
      capability: "get_product_availability",
      missing_arguments: ["variant"],
      basis: { result_id: availability.resultId, field_paths: ["data.products"] },
    });
    expect(unsupportedQuestion.allValid).toBe(false);
    expect(unsupportedQuestion.issues.some((issue) => issue.code === "variant_ambiguity_required")).toBe(true);
  });
});
