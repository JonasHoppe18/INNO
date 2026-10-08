import { describe, expect, it } from "vitest";
import { ensureAnswerCompleteness, renderResponseSegments, summarizeResponseValidation, validateStructuredResponse } from "../response-contract";
import { normalizeTurnIR } from "../turn-ir";

const scope = { workspaceId: "workspace-a", shopId: "shop-a" };
const sourceId = "874915ef-e3fc-4b90-8942-54cdbac7c616";
function record(text, options = {}) {
  return { title: "Willow Throw", knowledge_type: "product", authority: "reference",
    provenance: { source_id: sourceId, source_kind: "knowledge_v2_release" },
    structured_data: { semantic_type: "FACT", support_domain: "product", applicability: { kind: "products", product_ids: ["p1"] } },
    evidence_sections: [{ content: text, chunk_ids: ["chunk1"] }], ...options };
}
function evidence(records, toolName = "search_product_knowledge", resultId = "tool_result_1") {
  return { resultId, toolName, result: { status: "ok", data: { results: records, task_specificity: "sufficient", procedure_evidence_quality: "usable" } } };
}
function order(overrides = {}) {
  return { resultId: "tool_result_2", toolName: "get_order", result: { status: "ok", data: {
    id: "o1", orderNumber: "12", total: "718.20", currency: "DKK", shippingAddress: { countryCode: "DK" },
    items: [{ id: "l1", title: "Desk", quantity: 1, variantId: "v1" }, { id: "l2", title: "Cover", quantity: 2, variantId: "v2" }],
    fulfillments: [{ id: "f1", status: "success", itemMappingStatus: "verified", items: [{ orderLineItemId: "l1", title: "Desk", quantity: 1, variantId: "v1" }] }],
    order_focus: { state: "verified", verified_order_id: "o1" }, fulfillmentStatus: "partial", ...overrides,
  } } };
}
function context(records, overrides = {}) {
  return { operationalScope: scope, manifest: { readTools: [], proposalOnlyTools: [] }, definitions: [],
    customerMessage: "Is the Willow throw all wool?", turnIR: { actions: [], answerRequests: [{ kind: "product_property", sourceText: "all wool", subject: "Willow" }] },
    getResult: id => records.find(record => record.resultId === id), getResults: () => records, ...overrides };
}
const basis = { result_id: "tool_result_1", field_paths: ["results[0].evidence_sections[0].content"] };
const property = { type: "source_content", kind: "product_property", basis };
const omitted = { segments: [{ type: "acknowledgement", kind: "thanks" }] };
const complete = ctx => ensureAnswerCompleteness(validateStructuredResponse(omitted, ctx), ctx);
function procedure() {
  const blocks = [
    { block_id: "identify", text: "Obtain order identification only if not already established.", kind: "instruction" },
    { block_id: "photo", text: "Obtain a photo of the damaged item if not already available.", kind: "instruction" },
    { block_id: "packaging", text: "Obtain a packaging photo if not already available.", kind: "instruction" },
    { block_id: "assess", text: "Submit the case for assessment.", kind: "instruction" },
  ];
  return record("Damage intake", { title: "Damage intake", knowledge_type: "procedural", authority: "operational",
    structured_data: { semantic_type: "PROCEDURE", support_domain: "damaged_item", applicability: { kind: "merchant", product_ids: [] },
      procedure: { blocks }, procedure_steps: blocks, policy_coverage: [{ domain: "damaged_item", available: ["intake", "assessment"], evidenceByFacet: { intake: ["chunk1"], assessment: ["chunk1"] } }] } });
}
const procedureSegment = ids => ({ type: "procedure_guidance", text: "MODEL TEXT MUST NEVER RENDER", basis: { result_id: "tool_result_1", field_paths: ["results[0]"] }, block_ids: ids });
function policy(text = "Free shipping on Danish orders over 599 DKK.") {
  return record(text, { knowledge_type: "policy", authority: "authoritative", title: "Domestic shipping",
    structured_data: { semantic_type: "POLICY", support_domain: "shipping", applicability: { kind: "merchant", product_ids: [] },
      policy_coverage: [{ domain: "shipping", destination: "DK", available: ["threshold"], evidenceByFacet: { threshold: ["chunk1"] } }] } });
}
const comparison = { type: "source_comparison", kind: "shipping_threshold", order: { result_id: "tool_result_2", field_paths: ["total", "currency"] }, policy: basis };

 describe("source-bound response boundary", () => {
  it("recovers an omitted property through the same validator", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])]);
    const result = complete(ctx);
    expect(result.coverage).toMatchObject({ supported: ["product.properties"], satisfied: ["product.properties"], missing: [] });
    expect(result.coverage.obligations[0].recovery).toBe("recovered");
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("100% wool");
  });
  it("replaces cotton substitution with source-derived wool", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])]);
    const validated = validateStructuredResponse({ segments: [{ type: "knowledge_guidance", text: "Willow is 100% cotton.", basis }] }, ctx);
    expect(renderResponseSegments(validated.approvedSegments, ctx)).toContain("100% wool");
    expect(renderResponseSegments(validated.approvedSegments, ctx)).not.toContain("cotton");
  });
  it("normalizes a static property incorrectly labelled as a live product fact", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])]);
    const result = validateStructuredResponse({ segments: [{ type: "fact", fact_kind: "product_value", evidence: [basis] }] }, ctx);
    expect(result.approvedSegments).toEqual([property]);
  });
  it.each(["unknown", "tool_result_99"])("rejects a non-current result ID %s", id => {
    const ctx = context([evidence([record("100% wool")])]);
    expect(validateStructuredResponse({ segments: [{ ...property, basis: { ...basis, result_id: id } }] }, ctx).issues[0].code).toBe("unknown_result_id");
  });
  it.each(["workspace_id", "shop_id"])("rejects conflicting tenant %s", key => {
    const source = record("100% wool", { [key]: "other" });
    expect(validateStructuredResponse({ segments: [property] }, context([evidence([source])])).issues[0].code).toBe("evidence_scope_mismatch");
  });
  it("rejects expired source provenance", () => {
    const source = record("100% wool", { provenance: { source_id: sourceId, expires_at: "2000-01-01T00:00:00Z" } });
    expect(validateStructuredResponse({ segments: [property] }, context([evidence([source])])).issues[0].code).toBe("evidence_expired");
  });
  it("rejects a property bound to another product", () => {
    const other = record("100% cotton", { title: "Cedar Cover", structured_data: { semantic_type: "FACT", support_domain: "product", applicability: { kind: "products", product_ids: ["p2"] } } });
    const ctx = context([evidence([record("100% wool"), other])]);
    expect(validateStructuredResponse({ segments: [{ ...property, basis: { ...basis, field_paths: ["results[1].evidence_sections[0].content"] } }] }, ctx).issues[0].code).toBe("product_scope_mismatch");
  });
  it("rejects metadata as a material value", () => {
    const ctx = context([evidence([record("100% wool")])]);
    expect(validateStructuredResponse({ segments: [{ ...property, basis: { ...basis, field_paths: ["results[0].title"] } }] }, ctx).issues[0].code).toBe("source_content_path_required");
  });
  it("requires semantic provenance", () => {
    expect(validateStructuredResponse({ segments: [property] }, context([evidence([record("wool", { provenance: {} })])])).issues[0].code).toBe("source_provenance_required");
  });
  it.each(["search_policy", "search_procedures", "verified_retrieval"])("accepts actual procedural blocks through %s", transport => {
    const ctx = context([evidence([procedure()], transport)], { customerMessage: "The desk arrived damaged", turnIR: { actions: [] } });
    const result = validateStructuredResponse({ segments: [procedureSegment(["photo", "packaging", "assess"])] }, ctx);
    expect(result.allValid).toBe(true);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("packaging photo");
    expect(answer).not.toContain("MODEL TEXT");
  });
  it.each([
    [["photo", "missing"], "procedure_block_missing"],
    [["assess", "photo"], "procedure_step_order"],
    [["photo", "photo"], "procedure_step_order"],
  ])("rejects invalid procedural blocks %j", (ids, code) => {
    const ctx = context([evidence([procedure()], "search_policy")]);
    expect(validateStructuredResponse({ segments: [procedureSegment(ids)] }, ctx).issues.map(issue => issue.code)).toContain(code);
  });
  it("rejects procedural reference authority", () => {
    const ctx = context([evidence([{ ...procedure(), authority: "reference" }], "search_policy")]);
    expect(validateStructuredResponse({ segments: [procedureSegment(["photo"])] }, ctx).allValid).toBe(false);
  });
  it("rejects a procedural transport without semantic provenance", () => {
    const ctx = context([evidence([{ ...procedure(), provenance: {} }], "search_policy")]);
    expect(validateStructuredResponse({ segments: [procedureSegment(["photo"])] }, ctx).issues.map(issue => issue.code)).toContain("procedure_source_required");
  });
  it("does not interpret photos-ready as received files or invent a channel", () => {
    const ctx = context([evidence([procedure()], "search_policy"), order()], { customerMessage: "Order #12: photos are ready; how do I send them?",
      activeOrder: { state: "verified", requestedOrderId: "12", order: { id: "o1" } }, turnIR: { actions: [], policyIntents: [{ domain: "damaged_item", facets: ["intake", "assessment"], sourceText: "photos are ready", destinationCountryCode: null, destinationText: null }] } });
    const result = complete(ctx), answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(result.coverage.missing).toEqual([]);
    expect(answer).toContain("does not specify a photo submission channel");
    expect(answer).toContain("does not establish that files have been received");
    expect(answer).toContain("assessment");
    expect(answer).not.toMatch(/attach|upload here|photos received|order identification|refund approved|replacement sent/i);
  });
  it("recovers missing intake instead of accepting order identity as the answer", () => {
    const ctx = context([evidence([procedure()], "search_policy"), order()], { customerMessage: "Desk arrived damaged", turnIR: { actions: [], policyIntents: [{ domain: "damaged_item", facets: ["intake"], sourceText: "Desk arrived damaged" }] } });
    const initial = validateStructuredResponse({ segments: [{ type: "fact", fact_kind: "order_reference", evidence: [{ result_id: "tool_result_2", field_paths: ["orderNumber"] }] }] }, ctx);
    const result = ensureAnswerCompleteness(initial, ctx);
    expect(result.coverage.obligations.find(o => o.id === "policy.damaged_item.intake").recovery).toBe("recovered");
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("photo");
  });
  it("cues=[] cannot declare empty output complete", () => {
    const result = ensureAnswerCompleteness(validateStructuredResponse(null, context([])), context([]));
    expect(result.coverage.missing).toEqual(["product.properties"]);
    expect(result.completenessDiagnostics.intent_resolved_by_approved_segment).toBe(false);
  });
  it("recovers negative care constraints absent from a lexical care list", () => {
    const care = record("Avoid prolonged contact with standing water and strong household chemicals.", { authority: "guidance", structured_data: { semantic_type: "GUIDANCE", support_domain: "product", applicability: { kind: "products", product_ids: ["p1"] } } });
    const ctx = context([evidence([care])], { customerMessage: "Can I use strong cleaner on the Willow throw?", turnIR: { actions: [], answerRequests: [{ kind: "product_care", sourceText: "strong cleaner", subject: "Willow" }] } });
    const result = complete(ctx);
    expect(result.coverage.missing).toEqual([]);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("standing water and strong household chemicals");
  });
  it.each(["Wash at 90 degrees", "Dishwasher cleaning is safe", "You can machine wash it"])("blocks unsupported care claim %s", claim => {
    const care = record("Do not machine wash. Wipe with a damp cloth.", { authority: "guidance", structured_data: { semantic_type: "GUIDANCE", support_domain: "care", applicability: { kind: "products", product_ids: ["p1"] } } });
    const ctx = context([evidence([care])], { customerMessage: "How do I clean the Willow throw?", turnIR: { actions: [], answerRequests: [{ kind: "product_care", sourceText: "clean", subject: "Willow" }] } });
    const result = ensureAnswerCompleteness(validateStructuredResponse({ segments: [{ type: "knowledge_guidance", text: claim, basis }] }, ctx), ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(result.rejectedSegments.length).toBeGreaterThan(0);
    expect(answer).not.toContain(claim);
    expect(answer).toContain("Do not machine wash");
  });
  it("retains total and currency and a bounded threshold comparison", () => {
    const ctx = context([evidence([policy()], "search_policy"), order()], { customerMessage: "Did my order qualify for free Danish shipping?", turnIR: { actions: [], answerRequests: [{ kind: "shipping_qualification", sourceText: "qualify", subject: null }] } });
    const result = complete(ctx), answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(result.coverage.missing).toEqual([]);
    expect(answer).toContain("718.20 DKK");
    expect(answer).toContain("599 DKK threshold");
    expect(answer).toContain("does not confirm the shipping actually charged");
    expect(answer).not.toContain("shipping charged was 0");
  });
  it.each([
    [{ currency: "EUR" }, "Free shipping over 599 DKK."],
    [{ shippingAddress: { countryCode: "DE" } }, "Free shipping over 599 DKK."],
    [{ total: null }, "Free shipping over 599 DKK."],
    [{ total: "unknown" }, "Free shipping over 599 DKK."],
    [{ total: "718.20" }, "Shipping may be free."],
  ])("rejects incompatible/unsupported comparison inputs %j", (overrides, text) => {
    const ctx = context([evidence([policy(text)], "search_policy"), order(overrides)]);
    expect(validateStructuredResponse({ segments: [comparison] }, ctx).allValid).toBe(false);
  });
  it("does not substitute a customer-mentioned amount for verified order total", () => {
    const ctx = context([evidence([policy()], "search_policy"), order()], { customerMessage: "I paid 9999 DKK" });
    const result = validateStructuredResponse({ segments: [comparison] }, ctx);
    expect(renderResponseSegments(result.approvedSegments, ctx)).not.toContain("9999");
  });
  it("recovers line disposition even when the model omits all line facts", () => {
    const ctx = context([order()], { customerMessage: "Where is the rest of my partly shipped order?", turnIR: { actions: [], orderContext: "status", answerRequests: [{ kind: "line_fulfillment", sourceText: "rest", subject: null }] } });
    const result = complete(ctx), answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(result.coverage.missing).toEqual([]);
    expect(answer).toContain("Cover: 0 of 2 fulfilled; 2 not yet dispatched");
    expect(answer).not.toContain("Desk delivered");
  });
  it.each(["wrong_line", "wrong_variant", "wrong_title", "too_many", "duplicate_fulfillment", "mapping_unavailable"])("rejects invalid mapping %s", failure => {
    const source = order(), f = source.result.data.fulfillments[0];
    if (failure === "wrong_line") f.items[0].orderLineItemId = "other";
    if (failure === "wrong_variant") f.items[0].variantId = "other";
    if (failure === "wrong_title") f.items[0].title = "other";
    if (failure === "too_many") f.items[0].quantity = 2;
    if (failure === "duplicate_fulfillment") source.result.data.fulfillments.push(f);
    if (failure === "mapping_unavailable") f.itemMappingStatus = "unavailable";
    const result = validateStructuredResponse({ segments: [{ type: "fact", fact_kind: "line_fulfillment", evidence: [{ result_id: "tool_result_2", field_paths: ["items[1]"] }] }] }, context([source]));
    expect(result.issues[0].code).toBe("line_mapping_not_verified");
  });
  it("accepts a shipment item from the same verified get_order mapping", () => {
    const ctx = context([order()]);
    const result = validateStructuredResponse({ segments: [{ type: "fact", fact_kind: "shipment_item", evidence: [{ result_id: "tool_result_2", field_paths: ["fulfillments[0].items[0]"] }] }] }, ctx);
    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, ctx)).not.toContain("delivered");
  });
  it("retains safe diagnostic codes and coverage without raw source text", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])]);
    const result = ensureAnswerCompleteness(validateStructuredResponse({ segments: [{ ...property, basis: { ...basis, field_paths: ["results[0].missing"] } }] }, ctx), ctx);
    const summary = summarizeResponseValidation(result, { includeCompleteness: true });
    expect(summary.segment_diagnostics[0]).toMatchObject({ index: 0, type: "source_content", resultIds: ["tool_result_1"], rejectionCodes: ["unknown_field_path"] });
    expect(summary.required_answer_coverage.satisfied).toContain("product.properties");
    expect(JSON.stringify(summary)).not.toContain("100% wool");
  });
  it("does not permit a model action offer without a server proposal", () => {
    const ctx = context([], { manifest: { proposalOnlyTools: ["cancel_order"], readOnlyTools: [] }, proposedActions: [], definitions: [{ name: "cancel_order", sensitivity: "proposed_action", parameters: { required: [], properties: {} } }] });
    expect(validateStructuredResponse({ segments: [{ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }] }, ctx).allValid).toBe(false);
  });
  it("normalizes quoted multilingual answer requests without inventing a quote", () => {
    expect(normalizeTurnIR({ actions: [], answerRequests: [{ kind: "product_care", sourceText: "rengøre", subject: "Willow" }] }, "Hvordan kan jeg rengøre Willow?").answerRequests[0].kind).toBe("product_care");
    expect(() => normalizeTurnIR({ actions: [], answerRequests: [{ kind: "product_property", sourceText: "wool", subject: "Willow" }] }, "Hello")).toThrow();
  });
});

describe("coverage and entailment safety controls", () => {
  it("recovers both omitted product and policy facts in a multi-intent answer", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")]), evidence([record("Shipping: 79 DKK.", { knowledge_type: "policy", authority: "authoritative", structured_data: { semantic_type: "POLICY", support_domain: "shipping", policy_coverage: [{ domain: "shipping", destination: "DK", available: ["price"], evidenceByFacet: { price: ["chunk1"] } }] } })], "search_policy", "tool_result_3")], {
      turnIR: { actions: [], answerRequests: [{ kind: "product_property", sourceText: "wool", subject: "Willow" }], policyIntents: [{ domain: "shipping", facets: ["price"], sourceText: "shipping", destinationCountryCode: "DK" }] },
    });
    const result = complete(ctx), answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("100% wool");
    expect(answer).toContain("79 DKK");
    expect(result.coverage.satisfied).toEqual(["product.properties", "policy.shipping.price"]);
  });
  it("preserves source-derived product facts when TurnIR is technically unavailable", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])], { turnIR: undefined });
    expect(complete(ctx).coverage.satisfied).toEqual(["product.properties"]);
    expect(renderResponseSegments(complete(ctx).approvedSegments, ctx)).toContain("100% wool");
  });
  it.each(["100% cotton", "Safe to clean at 90 degrees", "It will arrive tomorrow", "A replacement is guaranteed"])("cannot substitute model prose %s into a source property", text => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])]);
    const result = validateStructuredResponse({ segments: [{ type: "knowledge_guidance", text, basis: { result_id: "tool_result_1", field_paths: ["results[0]"] } }] }, ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("100% wool");
    expect(answer).not.toContain(text);
  });
  it("keeps unmatched metadata from licensing a free-form material claim", () => {
    const ctx = context([evidence([record("Willow Throw is 100% wool.")])]);
    const result = validateStructuredResponse({ segments: [{ type: "knowledge_guidance", text: "100% cotton", basis: { ...basis, field_paths: ["results[0].title"] } }] }, ctx);
    expect(result.issues[0].code).toBe("product_content_binding_required");
  });
  it.each(["Your refund has been issued", "We have sent a replacement", "Your return was approved"])("rejects unverified remedy outcome %s", text => {
    const ctx = context([evidence([policy("Damaged items are assessed before a remedy is decided.")], "search_policy")]);
    const result = ensureAnswerCompleteness(validateStructuredResponse({ segments: [{ type: "knowledge_guidance", text, basis }] }, ctx), ctx);
    expect(result.rejectedSegments[0].issues[0].code).toBe("unverified_remedy_outcome");
    expect(renderResponseSegments(result.approvedSegments, ctx)).not.toContain(text);
  });
  it("rejects contradictory CaseState tenancy", () => {
    const ctx = context([evidence([record("100% wool")])], { caseState: { scope: { workspaceId: "other", shopId: "shop-a", caseId: "case1", customerEmail: null } } });
    expect(validateStructuredResponse({ segments: [property] }, ctx).issues[0].code).toBe("case_scope_mismatch");
  });
  it("keeps unavailable shipping/coupon fields distinct from supported amount", () => {
    const ctx = context([order(), evidence([policy()], "search_policy")], { turnIR: { actions: [], answerRequests: [{ kind: "shipping_qualification", sourceText: "qualify", subject: null }] } });
    const result = complete(ctx);
    expect(result.coverage.supported).toContain("order.amount");
    expect(result.coverage.unknown).toContain("provider.shipping_charge_and_coupon");
    expect(result.coverage.missing).toEqual([]);
  });
  it("cannot invent a line ETA from general shipping policy", () => {
    const ctx = context([order()], { customerMessage: "Where is the rest?", turnIR: { actions: [], orderContext: "status", answerRequests: [{ kind: "line_fulfillment", sourceText: "rest", subject: null }], policyIntents: [{ domain: "shipping", facets: ["timing"], sourceText: "Where" }] } });
    const result = complete(ctx), answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(result.coverage.unknown).toContain("order.line_timing");
    expect(answer).toContain("No verified dispatch or delivery date");
    expect(answer).not.toContain("tomorrow");
  });
  it("does not recover item disposition when a current line ID is duplicated", () => {
    const source = order(); source.result.data.items[1].id = "l1";
    const ctx = context([source], { turnIR: { actions: [], answerRequests: [{ kind: "line_fulfillment", sourceText: "rest", subject: null }] } });
    const result = complete(ctx);
    expect(result.coverage.supported).toEqual([]);
    expect(result.coverage.unknown).toContain("order.line.1");
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("cannot map all items");
  });
  it("rejects cross-record procedure references", () => {
    const ctx = context([evidence([procedure(), procedure()], "search_policy")]);
    const result = validateStructuredResponse({ segments: [{ ...procedureSegment(["photo"]), basis: { ...basis, field_paths: ["results[0]", "results[1]"] } }] }, ctx);
    expect(result.issues.map(issue => issue.code)).toContain("procedure_source_ambiguous");
  });
  it("rejects ambiguous returned procedure block IDs", () => {
    const proc = procedure(); proc.structured_data.procedure_steps[1].block_id = "identify";
    const result = validateStructuredResponse({ segments: [procedureSegment(["identify"])] }, context([evidence([proc], "search_policy")]));
    expect(result.issues.map(issue => issue.code)).toContain("procedure_block_identity_ambiguous");
  });
});

it("a dimension fact cannot satisfy a requested composition obligation", () => {
  const ctx = context([evidence([record("Size: 130 × 180 cm.")])], { turnIR: { actions: [], answerRequests: [{ kind: "product_property", propertyKey: "composition", sourceText: "wool", subject: "Willow" }] } });
  const result = complete(ctx);
  expect(result.coverage.supported).toEqual([]);
  expect(result.coverage.unknown).toEqual(["answer.0.material_composition"]);
  expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("does not establish the requested material composition");
});

it("a full recovered procedure replaces its validated partial projection", () => {
  const ctx = context([evidence([procedure()], "search_policy")], { customerMessage: "Damaged item", turnIR: { actions: [], policyIntents: [{ domain: "damaged_item", facets: ["intake"], sourceText: "Damaged item" }] } });
  const initial = validateStructuredResponse({ segments: [procedureSegment(["photo", "packaging"])] }, ctx);
  const result = ensureAnswerCompleteness(initial, ctx);
  expect(result.approvedSegments.filter(segment => segment.type === "procedure_guidance")).toHaveLength(1);
  expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("assessment");
});
it("internal evidence boundary instructions cannot become customer care advice", () => {
  const internal = record("Do not invent instructions or values.", { title: "Willow Throw / Evidence boundary", authority: "guidance", structured_data: { semantic_type: "GUIDANCE", support_domain: "product", applicability: { kind: "products", product_ids: ["p1"] } } });
  const ctx = context([evidence([internal])]);
  const result = validateStructuredResponse({ segments: [{ type: "source_content", kind: "care_constraint", basis }] }, ctx);
  expect(result.issues[0].code).toBe("non_answer_source_role");
});
it("a static material field cannot be misclassified as a cleaning constraint", () => {
  const ctx = context([evidence([record("100% wool")])]);
  const result = validateStructuredResponse({ segments: [{ type: "source_content", kind: "care_constraint", basis }] }, ctx);
  expect(result.issues[0].code).toBe("care_source_required");
});
it("a product-specific policy cannot bind to another verified product", () => {
  const wrong = policy("Different product warranty condition"); wrong.structured_data.applicability = { kind: "products", product_ids: ["p2"] };
  const ctx = context([evidence([wrong], "search_policy"), evidence([record("100% wool")], "search_product_knowledge", "tool_result_4")]);
  const result = validateStructuredResponse({ segments: [{ type: "source_content", kind: "policy_condition", basis }] }, ctx);
  expect(result.issues[0].code).toBe("policy_product_scope_mismatch");
});

it("inconsistent shipping qualification cannot add unrelated obligations to line status", () => {
  const ctx = context([order()], { customerMessage: "Where is the rest?", turnIR: { actions: [], orderContext: "status", policyIntents: [], answerRequests: [
    { kind: "line_fulfillment", sourceText: "rest", subject: "rest" }, { kind: "shipping_qualification", sourceText: "rest", subject: "rest" },
  ] } });
  const result = complete(ctx), answer = renderResponseSegments(result.approvedSegments, ctx);
  expect(result.coverage.requested).toEqual(["order.line.0", "order.line.1"]);
  expect(answer).not.toMatch(/threshold|coupon|order total/);
});
it("a semantic subject label never authorizes product identity or source scope", () => {
  const ir = normalizeTurnIR({ actions: [], answerRequests: [{ kind: "product_property", sourceText: "wool", subject: "A normalized unrelated product" }] }, "Is Willow all wool?");
  const ctx = context([evidence([record("100% wool")])], { customerMessage: "Is Willow all wool?", turnIR: ir });
  expect(renderResponseSegments(complete(ctx).approvedSegments, ctx)).toContain("100% wool");
  expect(renderResponseSegments(complete(ctx).approvedSegments, ctx)).not.toContain("unrelated product");
});

it("a prospective product shipping quote cannot require an existing order total", () => {
  const ctx = context([], { customerMessage: "What would shipping cost for one?", turnIR: { actions: [], policyIntents: [{ domain: "shipping", facets: ["price"], sourceText: "shipping cost" }], answerRequests: [{ kind: "shipping_qualification", sourceText: "shipping cost", subject: null }] } });
  const result = complete(ctx);
  expect(result.coverage.requested).not.toContain("order.amount");
  expect(result.coverage.requested).not.toContain("shipping.threshold_comparison");
});

it("a typed missing-order clarification cannot invent a photo attachment channel", () => {
  const ctx = context([], { manifest: { readTools: [], proposalOnlyTools: ["create_return"] }, definitions: [{ name: "create_return", parameters: { required: ["order_id"], properties: { order_id: { type: "string" } } } }] });
  const result = validateStructuredResponse({ segments: [{ type: "question", purpose: "resolve_required_argument", text: "Share your order number and attach photos here", capability: "create_return", missing_arguments: ["order_id"], basis: null }] }, ctx);
  const answer = renderResponseSegments(result.approvedSegments, ctx);
  expect(answer).toMatch(/order/i);
  expect(answer).not.toMatch(/attach|photos|upload|here/i);
});
