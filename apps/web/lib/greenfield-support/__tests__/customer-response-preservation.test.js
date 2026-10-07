import { describe, expect, it } from "vitest";
import { fallbackResponse } from "../agent";
import { GREENFIELD_TOOL_DEFINITIONS } from "../tool-contracts";
import { ensureAnswerCompleteness, renderResponseSegments, validateStructuredResponse } from "../response-contract";

function record(id, toolName, data, status = "ok") { return { resultId: id, toolName, result: { status, data } }; }
function context(records = [], extra = {}) {
  return {
    manifest: { readTools: ["get_order", "get_product", "get_product_availability", "search_product_knowledge", "search_policy"], proposalOnlyTools: [], configured: { knowledge: true, commerce: true, tracking: false } },
    definitions: GREENFIELD_TOOL_DEFINITIONS,
    getResult: id => records.find(record => record.resultId === id), getResults: () => records,
    customerMessage: "", turnIR: { actions: [] }, ...extra,
  };
}
const basis = (id, ...paths) => ({ result_id: id, field_paths: paths });
const fact = (kind, id, ...paths) => ({ type: "fact", fact_kind: kind, evidence: [basis(id, ...paths)] });
const validate = (ctx, ...segments) => validateStructuredResponse({ segments }, ctx);
const care = (title, content, overrides = {}) => ({ title, knowledge_type: "product", authority: "guidance", evidence_sections: [{ content }], ...overrides });
const careData = { query: "washing and drying care", results: [
  care("Textile Care Guide / Aurora Linen Cover", "Machine wash at 30°C on a gentle cycle, reshape while damp and air dry."),
  care("Textile Care Guide / Cedar Wool Throw", "Do not machine wash or tumble dry."),
  care("Textile Care Guide / Cedar Wool Throw", "Spot clean small marks with cold water and air regularly."),
  care("Textile Care Guide / Cedar Wool Throw", "Professional dry cleaning is recommended for full cleaning."),
] };
const careContext = (message, data = careData, extra = {}) => context([record("care", "search_product_knowledge", data)], { customerMessage: message, ...extra });
const guidance = (text, ...paths) => ({ type: "knowledge_guidance", text, basis: basis("care", ...paths) });
const product = { status: "ok", products: [{ id: "p1", title: "Aurora Cover", variants: [{ id: "v1", title: "Sand", price: "299.00" }] }] };

describe("semantic fulfillment evidence", () => {
  const order = { id: "o1", orderNumber: "1065", fulfillmentStatus: null, fulfillments: [] };
  it.each([[["fulfillmentStatus"]], [["data.fulfillmentStatus"]], [["fulfillmentStatus", "fulfillments"]]])("renders verified unfulfilled state from %j", (paths) => {
    const ctx = context([record("order", "get_order", order)]);
    const result = validate(ctx, fact("order_fulfillment_status", "order", ...paths));
    expect(result.allValid).toBe(true); expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("has not shipped yet");
  });
  it.each([
    [{ ...order, fulfillments: undefined }, "fulfillmentStatus"],
    [{ ...order, fulfillments: [{ id: "f1" }] }, "fulfillmentStatus"],
    [{ ...order, fulfillmentStatus: undefined }, "fulfillmentStatus"],
    [{ ...order, id: undefined }, "fulfillmentStatus"],
  ])("does not turn incomplete or conflicting data into unfulfilled", (data, path) => {
    expect(validate(context([record("order", "get_order", data)]), fact("order_fulfillment_status", "order", path)).allValid).toBe(false);
  });
  it("does not reinterpret null ETA or an unrelated fact kind", () => {
    const ctx = context([record("order", "get_order", order)]);
    expect(validate(ctx, fact("shipment_eta", "order", "fulfillmentStatus")).allValid).toBe(false);
    expect(validate(ctx, fact("order_financial_status", "order", "fulfillmentStatus")).allValid).toBe(false);
  });
  it("keeps non-successful order results blocked", () => {
    expect(validate(context([record("order", "get_order", order, "error")]), fact("order_fulfillment_status", "order", "fulfillmentStatus")).allValid).toBe(false);
  });
});

describe("every supported live product value survives rendering", () => {
  it("renders variant and price regardless of cited field order", () => {
    const ctx = context([record("product", "get_product", product)]);
    const fields = ["products[0].variants[0].title", "products[0].variants[0].price"];
    for (const paths of [fields, [...fields].reverse()]) {
      const result = validate(ctx, fact("product_value", "product", ...paths));
      expect(result.allValid).toBe(true);
      const rendered = renderResponseSegments(result.approvedSegments, ctx);
      expect(rendered).toContain("variant is Sand"); expect(rendered).toContain("price is 299.00");
    }
  });
  it("restores a requested unique live price omitted by the model", () => {
    const ctx = context([record("product", "get_product", product)], { customerMessage: "What is the price and what colour is it?" });
    const result = ensureAnswerCompleteness(validate(ctx, fact("product_value", "product", "products[0].variants[0].title")), ctx);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("299.00");
    expect(result.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "recovered" });
  });
  it("does not duplicate an already-cited price", () => {
    const ctx = context([record("product", "get_product", product)], { customerMessage: "Price please" });
    const result = ensureAnswerCompleteness(validate(ctx, fact("product_value", "product", "products[0].variants[0].price")), ctx);
    expect(result.approvedSegments).toHaveLength(1);
  });
  it.each([
    { ...product, products: [] },
    { ...product, products: [{ ...product.products[0], variants: [...product.products[0].variants, { id: "v2", price: "499.00" }] }] },
    { ...product, products: [{ ...product.products[0], variants: [{ id: "v1", price: "unknown" }] }] },
  ])("never guesses an unavailable or ambiguous price", (data) => {
    const ctx = context([record("product", "get_product", data)], { customerMessage: "Price please" });
    expect(ensureAnswerCompleteness(validate(ctx, { type: "acknowledgement", kind: "thanks" }), ctx).approvedSegments).toHaveLength(1);
  });
  it("never chooses another product merely because its price is equal", () => {
    const other = { products: [{ id: "p2", variants: [{ id: "v2", price: "299.00" }] }] };
    const ctx = context([record("p1", "get_product", product), record("p2", "get_product", other)], { customerMessage: "Price please" });
    expect(ensureAnswerCompleteness(validate(ctx, { type: "acknowledgement", kind: "thanks" }), ctx).approvedSegments).toHaveLength(1);
  });
  it("keeps inventory, fabricated paths and wrong capability bindings rejected", () => {
    const ctx = context([record("product", "get_product", product), record("care", "search_product_knowledge", careData)]);
    for (const segment of [fact("product_value", "product", "products[0].variants[0].inventory_quantity"), fact("product_value", "product", "products[0].variants[0].fake_price"), fact("product_availability", "product", "products[0].variants[0].price"), fact("product_value", "care", "results[0].evidence_sections[0].content")]) expect(validate(ctx, segment).allValid).toBe(false);
  });
});

describe("care content binding and safe source recovery", () => {
  it("maps a care value mislabeled as a live product fact to cited source guidance", () => {
    const ctx = careContext("Can I wash my Aurora cover and how do I dry it?");
    const result = validate(ctx, fact("product_value", "care", "data.results[0].evidence_sections[0].content"));
    expect(result.allValid).toBe(true); expect(result.approvedSegments[0].type).toBe("knowledge_guidance");
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("30°C");
  });
  it("binds a whole retrieved collection to only the named product's care content", () => {
    const ctx = careContext("Can I wash the Cedar throw?");
    const result = validate(ctx, guidance("Do not machine wash. Spot clean with cold water.", "data.results"));
    expect(result.allValid).toBe(true);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("Do not machine wash"); expect(answer).not.toContain("30°C");
    expect(result.approvedSegments[0].basis.field_paths.every(path => !path.startsWith("results[0]"))).toBe(true);
  });
  it("still rejects invented values when the model cites a whole collection", () => {
    const ctx = careContext("Can I wash the Aurora cover?");
    expect(validate(ctx, guidance("Machine wash at 90°C.", "results")).allValid).toBe(false);
  });
  it("binds equivalent numeric-dot and bracket array paths", () => {
    const ctx = careContext("Can I wash my Aurora cover?");
    const result = validate(ctx, guidance("Machine wash at 30°C.", "data.results.0.evidence_sections.0.content"));
    expect(result.allValid).toBe(true);
  });
  it("restores materially omitted drying instructions from the same source", () => {
    const ctx = careContext("Can I wash my Aurora cover and how do I dry it?");
    const initial = validate(ctx, guidance("Machine wash at 30°C.", "results[0].evidence_sections[0].content"));
    const result = ensureAnswerCompleteness(initial, ctx);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("reshape while damp and air dry");
  });
  it("does not let an unrelated negative phrase hide a prohibited washing claim", () => {
    const ctx = careContext("Can I machine wash the Cedar throw?");
    expect(validate(ctx, guidance("Do not bleach, and you can machine wash it.", "results[1].evidence_sections[0].content")).allValid).toBe(false);
  });
  it("recovers source-bound care after malformed output without trusting malformed prose", () => {
    const ctx = careContext("Can I wash my Aurora cover and how do I dry it?");
    const result = ensureAnswerCompleteness(validateStructuredResponse({ text: "wash it at 90 degrees" }, ctx), ctx);
    expect(result.schemaValid).toBe(false); expect(result.approvedSegments).toHaveLength(1);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("30°C");
    expect(renderResponseSegments(result.approvedSegments, ctx)).not.toContain("90");
  });
  it("retains distinct wool care after a product-switch follow-up", () => {
    const ctx = careContext("And can I do the same with my Cedar throw?");
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("Do not machine wash"); expect(answer).toContain("cold water"); expect(answer).toContain("Professional dry cleaning"); expect(answer).not.toContain("30°C");
  });
  it("accepts supported bounded uncertainty about an undocumented cleaning method", () => {
    const data = { results: [care("Aurora Ceramic Vase — Support Guide / Care", "Clean with a soft damp cloth and avoid abrasive cleaners.")] };
    const ctx = careContext("Is the Aurora vase dishwasher safe?", data);
    expect(validate(ctx, guidance("I couldn’t verify dishwasher safety. Clean with a soft damp cloth and avoid abrasive cleaners.", "results[0].evidence_sections[0].content")).allValid).toBe(true);
  });
  it.each(["It is dishwasher safe on a cool cycle.", "It is not dishwasher safe."])("rejects undocumented method certainty: %s", (text) => {
    const ctx = careContext("Is the Aurora vase dishwasher safe?", { results: [care("Aurora Ceramic Vase — Support Guide / Care", "Clean with a soft damp cloth.")] });
    expect(validate(ctx, guidance(text, "results[0].evidence_sections[0].content")).issues.some(issue => issue.code === "unsupported_care_method")).toBe(true);
  });
  it("rejects fabricated care values", () => {
    const ctx = careContext("Can I wash the Aurora cover?");
    expect(validate(ctx, guidance("Machine wash at 90°C.", "results[0].evidence_sections[0].content")).issues.some(issue => issue.code === "unsupported_care_value")).toBe(true);
  });
  it("binds a shortened product reference without conflating two products in one family", () => {
    const data = { results: [care("Aurora Linen Cover", "Machine wash at 30°C."), care("Aurora Wool Throw", "Do not machine wash.")] };
    const ctx = careContext("Can I wash my Aurora cover?", data);
    expect(validate(ctx, guidance("Machine wash at 30°C.", "results[0].evidence_sections[0].content")).allValid).toBe(true);
    expect(validate(ctx, guidance("Do not machine wash.", "results[1].evidence_sections[0].content")).allValid).toBe(false);
  });
  it("does not promote a shared generic product noun into a different named product", () => {
    const ctx = careContext("Can I wash my Unknown cover?");
    expect(validate(ctx, guidance("Machine wash at 30°C.", "results[0].evidence_sections[0].content")).allValid).toBe(false);
  });
  it("rejects transferring linen instructions to wool", () => {
    const ctx = careContext("Can I machine wash the Cedar throw?");
    expect(validate(ctx, guidance("Machine wash at 30°C.", "results[0].evidence_sections[0].content")).allValid).toBe(false);
    expect(validate(ctx, guidance("You can machine wash it.", "results[1].evidence_sections[0].content")).allValid).toBe(false);
  });
  it("never renders unsupported free prose even when source binding exists", () => {
    const ctx = careContext("Can I wash the Aurora cover?");
    const result = validate(ctx, guidance("Steam cleaning reverses all damage and prevents every future stain.", "results[0].evidence_sections[0].content"));
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("30°C"); expect(answer).not.toMatch(/steam|reverses|prevents/i);
  });
  it("requires content rather than treating title metadata as care evidence", () => {
    const ctx = careContext("Can I wash the Aurora cover?");
    expect(validate(ctx, guidance("Machine wash at 30°C.", "results[0].title")).allValid).toBe(false);
  });
  it.each(["example", "operational"])("does not recover care from %s-only knowledge", (authority) => {
    const ctx = careContext("Can I wash the Aurora cover?", { results: [care("Aurora Linen Cover", "Machine wash at 30°C.", { authority })] });
    expect(ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx).approvedSegments).toHaveLength(0);
  });
  it("never substitutes an availability result for missing Knowledge", () => {
    const ctx = context([record("care", "get_product_availability", { products: product.products })], { customerMessage: "Can I wash the Aurora cover?" });
    expect(validate(ctx, guidance("Machine wash it.", "products[0].title")).issues.some(issue => issue.code === "knowledge_evidence_missing")).toBe(true);
  });
  it("never recovers a care rule while the product remains ambiguous", () => {
    const ctx = careContext("Can I put it in the washing machine?");
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    expect(result.approvedSegments.every(segment => segment.type === "question")).toBe(true);
  });
  it("blocks operational commitments even with valid care evidence", () => {
    const ctx = careContext("Can I wash the Aurora cover?");
    expect(validate(ctx, guidance("We will send a replacement.", "results[0].evidence_sections[0].content")).allValid).toBe(false);
  });
});

describe("safe product clarification survives semantic purpose mismatch", () => {
  const question = { type: "question", purpose: "clarify_item", text: "Which product or item are you referring to?", capability: null, missing_arguments: [], basis: null };
  it.each([[[]], [[record("care", "search_product_knowledge", careData)]]])("keeps an ambiguous-product question with no action commitment", (records) => {
    const ctx = context(records, { customerMessage: "Can I chuck it in the washing machine?" });
    const result = validate(ctx, question);
    expect(result.allValid).toBe(true); expect(result.approvedSegments[0].purpose).toBe("clarify_task");
    expect(renderResponseSegments(result.approvedSegments, ctx)).toBe(question.text);
  });
  it("recovers one safe product question after a malformed ambiguous-care answer", () => {
    const ctx = careContext("Can I put it in the washing machine?");
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    expect(result.approvedSegments).toHaveLength(1);
    expect(result.approvedSegments[0].type).toBe("question");
  });
  it("does not permit re-asking a known product", () => {
    const ctx = careContext("Can I wash the Aurora cover?", careData, { customerProvidedContext: { product: "Aurora cover" } });
    expect(validate(ctx, question).allValid).toBe(false);
  });
  it("does not convert a proposal or order-item clarification into a product question", () => {
    const ctx = context([], { customerMessage: "Cancel my order", turnIR: { actions: [{ action: "cancel_order" }] } });
    expect(validate(ctx, question).allValid).toBe(false);
    expect(validate(ctx, { ...question, capability: "cancel_order", missing_arguments: ["order_id"] }).allValid).toBe(false);
  });
  it("blocks an operational commitment smuggled into a question", () => {
    const ctx = context([], { customerMessage: "Can I wash it?" });
    expect(validate(ctx, { ...question, text: "Which product is this? We will send a replacement." }).allValid).toBe(false);
  });
});


describe("bounded source response before generic transport fallback", () => {
  it("preserves verified care after a model/transport failure", () => {
    expect(fallbackResponse(careContext("Can I wash the Aurora cover?"))).toContain("30°C");
  });
  it("preserves a verified price when the model never reaches composition", () => {
    expect(fallbackResponse(context([record("product", "get_product", product)], { customerMessage: "Price please" }))).toContain("299.00");
  });
  it("retains an unresolved-order clarification alongside supported price", () => {
    const ctx = context([record("product", "get_product", product)], { customerMessage: "Order update and price please", activeOrder: { state: "unresolved", requestedOrderId: "9999" } });
    const response = fallbackResponse(ctx);
    expect(response).toContain("299.00"); expect(response).toContain("couldn’t verify order #9999");
  });
  it("keeps generic retry when no safe evidence or clarification is available", () => {
    expect(fallbackResponse(context())).toContain("couldn’t safely complete");
  });
  it("never turns a failed price read into verified price", () => {
    expect(fallbackResponse(context([record("product", "get_product", product, "error")], { customerMessage: "Price please" }))).not.toContain("299.00");
  });
  it("keeps a product ambiguity clarification rather than generic retry", () => {
    const response = fallbackResponse(careContext("Can I put it in the washing machine?"));
    expect(response).toContain("Which product"); expect(response).not.toContain("30°C");
  });
});

describe("verified stock cannot silently become an order-delay explanation", () => {
  const order = record("order", "get_order", { id: "o1", fulfillmentStatus: null, fulfillments: [], items: [{ variantId: "v1" }] });
  const stock = record("stock", "get_product_availability", { status: "ok", products: [{ id: "p1", title: "Aurora Vase", variants: [{ id: "v1", title: "Moss", availability_state: "OUT_OF_STOCK" }] }] });
  it("retains stock and the bounded causal uncertainty for the matching ordered variant", () => {
    const ctx = context([order, stock], { customerMessage: "Is my order delayed because of stock?" });
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("out of stock"); expect(answer).toContain("do not establish");
  });
  it("never uses a different variant as order-specific causal evidence", () => {
    const other = { ...order, result: { status: "ok", data: { ...order.result.data, items: [{ variantId: "other" }] } } };
    const ctx = context([other, stock], { customerMessage: "Is my order delayed because of stock?" });
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    expect(result.approvedSegments.some(segment => segment.type === "limitation")).toBe(false);
  });
  it("does not invent a restock date or a dispatch promise", () => {
    const ctx = context([order, stock], { customerMessage: "Is my order delayed because of stock?" });
    const answer = fallbackResponse(ctx);
    expect(answer).not.toMatch(/restock|dispatch|tomorrow|we will/i);
  });
  it("does not recover ambiguous availability as a selected variant", () => {
    const ambiguous = { ...stock, result: { status: "invalid_request", data: { ...stock.result.data, status: "ambiguous" } } };
    const ctx = context([ambiguous], { customerMessage: "Is it in stock?" });
    expect(ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx).approvedSegments).toHaveLength(0);
  });
});

describe("availability ambiguity can bind only to an independently verified identity", () => {
  const order = record("order", "get_order", { id: "o1", fulfillmentStatus: null, fulfillments: [], items: [{ variantId: "v1" }] });
  const availability = record("stock", "get_product_availability", {
    status: "ambiguous", selection: "ambiguous", provider: "shopify_read_only", source: "shopify_live",
    products: [{ id: "p1", title: "Aurora Vase", variants: [
      { id: "v0", title: "Ivory", availability_state: "AVAILABLE" },
      { id: "v1", title: "Moss", availability_state: "OUT_OF_STOCK" },
    ] }],
  }, "invalid_request");
  const focus = { state: "verified", order: { id: "o1" }, requestedOrderId: "1065" };
  const value = fact("product_availability", "stock", "products[0].variants[1].availability_state");
  it("accepts the canonical variant bound by the current verified order", () => {
    const ctx = context([order, availability], { customerMessage: "Is it in stock?", activeOrder: focus });
    const result = validate(ctx, value);
    expect(result.allValid).toBe(true); expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("Moss) is currently out of stock");
  });
  it("accepts a binding from a separate successful unique catalog read", () => {
    const catalog = record("catalog", "get_product", { products: [{ id: "p1", variants: [{ id: "v1" }] }] });
    expect(validate(context([catalog, availability]), value).allValid).toBe(true);
  });
  it("rejects availability without an independent canonical identity", () => {
    expect(validate(context([availability]), value).allValid).toBe(false);
  });
  it("rejects a different variant from the same live response", () => {
    const ctx = context([order, availability], { activeOrder: focus });
    expect(validate(ctx, fact("product_availability", "stock", "products[0].variants[0].availability_state")).allValid).toBe(false);
  });
  it("does not arbitrarily choose among multiple ordered variants", () => {
    const multiple = { ...order, result: { status: "ok", data: { ...order.result.data, items: [{ variantId: "v0" }, { variantId: "v1" }] } } };
    expect(validate(context([multiple, availability], { activeOrder: focus }), value).allValid).toBe(false);
  });
  it("rejects evidence outside the active verified order focus", () => {
    expect(validate(context([order, availability], { activeOrder: { ...focus, order: { id: "different" } } }), value).allValid).toBe(false);
  });
  it("rejects an unsuccessful order read as identity authority", () => {
    const failed = { ...order, result: { ...order.result, status: "error" } };
    expect(validate(context([failed, availability], { activeOrder: focus }), value).allValid).toBe(false);
  });
  it("rejects ambiguity carrying an unverified provider source", () => {
    const other = { ...availability, result: { ...availability.result, data: { ...availability.result.data, source: "unverified" } } };
    expect(validate(context([order, other], { activeOrder: focus }), value).allValid).toBe(false);
  });
  it("rejects non-normalized availability values", () => {
    const other = { ...availability, result: { ...availability.result, data: { ...availability.result.data, products: [{ id: "p1", variants: [{ id: "v1", availability_state: "IN_STOCK" }] }] } } };
    expect(validate(context([order, other], { activeOrder: focus }), fact("product_availability", "stock", "products[0].variants[0].availability_state")).allValid).toBe(false);
  });
  it("recovers the exact returned field without modifying provider data", () => {
    const bytes = JSON.stringify(availability);
    const ctx = context([order, availability], { customerMessage: "Is it stuck because of stock?", activeOrder: focus });
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("Moss) is currently out of stock"); expect(answer).toContain("do not establish");
    expect(JSON.stringify(availability)).toBe(bytes);
  });
  it("never renders speculative cause prose from a limitation", () => {
    const ctx = context([order, availability], { customerMessage: "Is it stuck because of stock?", activeOrder: focus });
    const result = validate(ctx, { type: "limitation", text: "Stock is a possible reason for the delay.", basis: basis("order", "fulfillmentStatus") });
    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("do not establish");
    expect(renderResponseSegments(result.approvedSegments, ctx)).not.toContain("possible reason");
  });
  it("never normalizes an unsupported operational promise into an approved limitation", () => {
    const ctx = context([order, availability], { customerMessage: "Is it stuck because of stock?", activeOrder: focus });
    expect(validate(ctx, { type: "limitation", text: "Stock may be the reason. We will investigate the delay.", basis: basis("order", "fulfillmentStatus") }).allValid).toBe(false);
  });
});


describe("source uncertainty and absent product remain safe responses", () => {
  it("recovers a missing product clarification even without a model question or tool read", () => {
    const ctx = context([], { customerMessage: "Can I chuck it in the washing machine?" });
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    expect(result.approvedSegments).toHaveLength(1);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("Which product");
    expect(fallbackResponse(ctx)).not.toContain("try again");
  });
  it("does not replace a known product or an action request with an absence question", () => {
    for (const extra of [{ customerProvidedContext: { product: "Aurora" } }, { turnIR: { actions: [{ action: "cancel_order" }] } }]) {
      const ctx = context([], { customerMessage: "Can I wash it?", ...extra });
      expect(ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx).approvedSegments).toHaveLength(0);
    }
  });
  it("preserves documented cloth care alongside explicit dishwasher uncertainty", () => {
    const data = { results: [
      care("Aurora Vase — Support Guide", "The approved product information does not state whether the vase is dishwasher-safe."),
      care("Aurora Vase — Support Guide", "Clean with a soft damp cloth and avoid abrasive cleaners."),
    ] };
    const ctx = careContext("Is the Aurora dishwasher safe on a cool cycle?", data);
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("soft damp cloth"); expect(answer).toContain("abrasive");
    expect(answer).toContain("not established");
    expect(validate(ctx, guidance("The vase is dishwasher safe.", "results[0].evidence_sections[0].content")).allValid).toBe(false);
  });
});


describe("product care binds the source product heading, not generic section headings", () => {
  const data = { results: [
    care("Aurora Ceramic Vase — Support Guide / Verified product support information", "The approved product information does not state whether the vase is dishwasher-safe."),
    care("Aurora Ceramic Vase — Support Guide / Verified product support information", "Clean with a soft damp cloth and avoid abrasive cleaners."),
    care("Cedar Side Table — Support Guide / Verified product support information", "Clean with wood cleaner."),
  ] };
  it("keeps same-product uncertainty and cleaning instructions", () => {
    const ctx = careContext("Is the Aurora dishwasher safe on a cool cycle?", data);
    const result = ensureAnswerCompleteness(validate(ctx, guidance("Dishwasher safety is not established. Clean with a damp cloth.", "results[0].evidence_sections[0].content", "results[1].evidence_sections[0].content")), ctx);
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("soft damp cloth"); expect(answer).toContain("abrasive");
    expect(answer).toContain("not established"); expect(answer).not.toContain("wood cleaner");
    expect(result.rejectedSegments).toHaveLength(0);
  });
  it("rejects another product despite an identical generic section heading", () => {
    const ctx = careContext("Is the Aurora dishwasher safe?", data);
    expect(validate(ctx, guidance("Use wood cleaner.", "results[2].evidence_sections[0].content")).allValid).toBe(false);
  });
});


describe("care limitations cannot smuggle unsupported method instructions", () => {
  const data = { results: [care("Aurora Vase — Support Guide", "The product information does not state whether the vase is dishwasher-safe.")] };
  it("renders only bounded uncertainty from a source-bound limitation", () => {
    const ctx = careContext("Is the Aurora dishwasher safe?", data);
    const result = validate(ctx, { type: "limitation", text: "Dishwasher safety is unverified. I recommend a cool dishwasher cycle.", basis: basis("care", "results[0].evidence_sections[0].content") });
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("not established"); expect(answer).not.toContain("recommend"); expect(answer).not.toContain("cycle");
  });
  it("still rejects operational promises in a care limitation", () => {
    const ctx = careContext("Is the Aurora dishwasher safe?", data);
    expect(validate(ctx, { type: "limitation", text: "Dishwasher safety is unverified. We will send a replacement.", basis: basis("care", "results[0].evidence_sections[0].content") }).allValid).toBe(false);
  });
});


describe("an order update preserves requested shipment state independently of payment", () => {
  const order = record("order", "get_order", { id: "o1", financialStatus: "paid", fulfillmentStatus: null, fulfillments: [] });
  const focus = { state: "verified", requestedOrderId: "1065", order: { id: "o1" } };
  it("restores verified unfulfilled status when only payment was emitted", () => {
    const ctx = context([order], { customerMessage: "Any update on my order?", activeOrder: focus });
    const result = ensureAnswerCompleteness(validate(ctx, fact("order_financial_status", "order", "financialStatus")), ctx);
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain("not shipped yet");
  });
  it("does not duplicate an already approved fulfillment fact", () => {
    const ctx = context([order], { customerMessage: "Order status?", activeOrder: focus });
    const result = ensureAnswerCompleteness(validate(ctx, fact("order_fulfillment_status", "order", "fulfillmentStatus")), ctx);
    expect(result.approvedSegments.filter(s => s.fact_kind === "order_fulfillment_status")).toHaveLength(1);
  });
  it.each([
    { activeOrder: { ...focus, order: { id: "other" } } },
    { activeOrder: { ...focus, state: "unresolved" } },
    { activeOrder: focus, turnIR: { actions: [{ action: "cancel_order" }] } },
  ])("cannot restore state outside the verified read-only order focus", (extra) => {
    const ctx = context([order], { customerMessage: "Order update please", ...extra });
    const result = ensureAnswerCompleteness(validateStructuredResponse({}, ctx), ctx);
    expect(result.approvedSegments.filter(s => s.fact_kind === "order_fulfillment_status")).toHaveLength(0);
  });
});


describe("order evidence cannot carry inventory prose or partial item identity", () => {
  it("replaces source-bound stock-causation prose with the bounded uncertainty", () => {
    const order = record("order", "get_order", { id: "o1", fulfillmentStatus: null, fulfillments: [] });
    const ctx = context([order], { customerMessage: "Is it stuck because of stock?" });
    const result = validate(ctx, { type: "limitation", text: "The product is out of stock and is holding up the order.", basis: basis("order", "id") });
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("do not establish"); expect(answer).not.toContain("is out of stock"); expect(answer).not.toContain("holding up");
  });
  it("rejects an ambiguous stock binding if any order item lacks verified variant identity", () => {
    const order = record("order", "get_order", { id: "o1", items: [{ variantId: "v1" }, { variantId: null }] });
    const stock = record("stock", "get_product_availability", { status: "ambiguous", selection: "ambiguous", provider: "shopify_read_only", source: "shopify_live", products: [{ id: "p1", variants: [{ id: "v1", availability_state: "OUT_OF_STOCK" }] }] }, "invalid_request");
    const ctx = context([order, stock], { activeOrder: { state: "verified", order: { id: "o1" } } });
    expect(validate(ctx, fact("product_availability", "stock", "products[0].variants[0].availability_state")).allValid).toBe(false);
  });
});


describe("multi-fact price answers render actual knowledge content", () => {
  it("preserves shipping facts while excluding invented merchant prose", () => {
    const policy = record("policy", "search_policy", { results: [{ knowledge_type: "policy", authority: "authoritative", evidence_sections: [{ content: "Standard shipping: 49 DKK." }, { content: "Free shipping from 599 DKK." }] }] });
    const ctx = context([policy], { customerMessage: "What is the price and postage?" });
    const result = validate(ctx, { type: "knowledge_guidance", text: "Invented Merchant ships everywhere for free.", basis: basis("policy", "results[0].evidence_sections[0].content", "results[0].evidence_sections[1].content") });
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("49 DKK"); expect(answer).toContain("599 DKK"); expect(answer).not.toContain("Invented Merchant"); expect(answer).not.toContain("everywhere");
  });
  it("cannot turn cover-only knowledge into invented current price", () => {
    const productKnowledge = record("knowledge", "search_product_knowledge", { results: [care("Aurora Cover", "Cover only. Cushion insert is not included.")] });
    const ctx = context([productKnowledge], { customerMessage: "Does it include the insert and what is the price?" });
    const result = validate(ctx, { type: "knowledge_guidance", text: "The current price is 999.", basis: basis("knowledge", "results[0].evidence_sections[0].content") });
    const answer = renderResponseSegments(result.approvedSegments, ctx);
    expect(answer).toContain("Cover only"); expect(answer).not.toContain("999");
  });
  it("still rejects fabricated knowledge paths in multi-fact answers", () => {
    const ctx = careContext("Does it include the insert and what is the price?");
    expect(validate(ctx, guidance("The price is 999.", "results[0].evidence_sections[0].fabricated")).allValid).toBe(false);
  });
});
