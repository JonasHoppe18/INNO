import { describe, expect, it } from "vitest";
import { compilePreciseAnswerRequests, sourceSupportsFacet, sourceSupportsRequest } from "../answer-facets";
import { ensureAnswerCompleteness, validateStructuredResponse, renderWithAnswerCoverage, missingPreciseEvidence } from "../response-contract";
const scope = { workspaceId: "w1", shopId: "s1" };
function setup(facets, texts = [], overrides = {}) {
  const sources = texts.map((text, i) => ({ title: "Vale Shelf", knowledge_type: "product", authority: "reference", shop_id: "s1", workspace_id: "w1",
    provenance: { source_id: `source-${i}`, source_kind: "knowledge_v2_release" },
    structured_data: { semantic_type: "GUIDANCE", support_domain: "product", applicability: { kind: "products", product_ids: ["p1"] } },
    evidence_sections: [{ heading: "Evidence boundary", content: text }] }));
  const records = [{ resultId: "catalog", toolName: "get_product", result: { status: "ok", data: { id: "p1", title: "Vale Shelf" } } },
    { resultId: "knowledge", toolName: "search_product_knowledge", result: { status: "ok", data: { results: sources } } }];
  const ctx = { operationalScope: scope, customerMessage: "Question about Vale Shelf", turnIR: { actions: [], answerRequests: [{ kind: "product_property", subject: "Vale Shelf", sourceText: "Question about Vale Shelf", facets }] },
    manifest: { readTools: [], proposalOnlyTools: [] }, definitions: [], getResults: () => records, getResult: id => records.find(r => r.resultId === id), ...overrides };
  return { ctx, sources, records };
}
function recover(ctx, output = { segments: [{ type: "acknowledgement", kind: "thanks" }] }) {
  return renderWithAnswerCoverage(ensureAnswerCompleteness(validateStructuredResponse(output, ctx), ctx), ctx);
}
const sourceSegment = (facet, result_id = "knowledge") => ({ type: "source_content", kind: "product_constraint", facet, basis: { result_id, field_paths: ["results[0].evidence_sections[0].content"] } });
describe("precise request coverage", () => {
  it("preserves an approved alternative sharing a block with method uncertainty", () => {
    const result = recover(setup(["cleaning_method"], ["Dishwasher safety is not established. Clean with a soft damp cloth and avoid abrasive cleaners."]).ctx);
    expect(result.response).toContain("soft damp cloth");
    expect(result.response).not.toContain("No approved alternative");
    expect(result.validation.coverage.obligations.find(o => o.facet === "cleaning_alternative")).toMatchObject({ status: "supported", rendered: true });
  });
  it("a prohibited wiping method is not an approved alternative", () => {
    const result = recover(setup(["cleaning_method", "prohibited_method"], ["Do not wipe with a cloth. No approved alternative is specified."]).ctx);
    expect(result.response).toContain("Do not wipe with a cloth");
    expect(result.validation.coverage.obligations.find(o => o.facet === "cleaning_alternative")).toMatchObject({ status: "unknown" });
  });
  it("normalizes care from verified semantic source fields on an alternate model shape", () => {
    const { ctx, sources } = setup([], ["Do not machine wash or tumble dry.", "For full cleaning, professional dry cleaning is recommended."]);
    ctx.turnIR.answerRequests = []; ctx.customerMessage = "the Vale Shelf";
    for (const source of sources) source.structured_data.support_domain = "care";
    const result = recover(ctx, { segments: [{ type: "knowledge_guidance", text: "Machine wash at 90 degrees.", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
    expect(result.response).toContain("Do not machine wash");
    expect(result.response).toContain("professional dry cleaning");
    expect(result.response).not.toContain("90 degrees");
  });
  it("preserves approved care alternatives on a product-clarification response without adding intent state", () => {
    const { ctx, sources } = setup([], ["Do not machine wash or tumble dry.", "For full cleaning, professional dry cleaning is recommended.", "For everyday care, air regularly and spot clean with cold water."]);
    ctx.turnIR.answerRequests = []; ctx.customerMessage = "the Vale Shelf";
    for (const source of sources) source.structured_data.support_domain = "care";
    const result = recover(ctx, { segments: [{ type: "source_content", kind: "care_constraint", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
    expect(result.response).toContain("Do not machine wash");
    expect(result.response).toContain("professional dry cleaning");
    expect(result.response).toContain("cold water");
    expect(ctx.turnIR.answerRequests).toEqual([]);
  });
  it("blocks non-authoritative examples and expired sources", () => {
    const { ctx, sources } = setup(["certification"], ["Verified fire certification."]);
    sources[0].authority = "example";
    expect(validateStructuredResponse({ segments: [sourceSegment("certification")] }, ctx).issues.map(i => i.code)).toContain("knowledge_authority_insufficient");
    sources[0].authority = "guidance";
    sources[0].provenance.expires_at = "2000-01-01T00:00:00Z";
    expect(validateStructuredResponse({ segments: [sourceSegment("certification")] }, ctx).issues.map(i => i.code)).toContain("evidence_expired");
  });
  it.each(["It is fire certified.", "Repair the live cable yourself.", "Use bleach.", "A refund has been issued."])("blocks arbitrary precise limitation prose: %s", text => {
    const { ctx } = setup(["certification"]);
    const validation = validateStructuredResponse({ segments: [{ type: "limitation", text, basis: { result_id: "catalog", field_paths: ["title"] } }] }, ctx);
    expect(validation.issues.map(issue => issue.code)).toContain("answer_facet_binding_required");
    expect(recover(ctx, { segments: [{ type: "limitation", text, basis: { result_id: "catalog", field_paths: ["title"] } }] }).response).not.toContain(text);
  });
  it("recovers supported facts even when the model output has the wrong envelope", () => {
    const result = recover(setup(["load_capacity"], ["Maximum load capacity: 5 kg."]).ctx, { answer: "omitted structured segments" });
    expect(result.response).toContain("5 kg");
    expect(result.validation.coverage.missing).toEqual([]);
  });
  it("does not borrow one requested product's evidence for a different subject", () => {
    const { ctx } = setup(["certification"], ["Vale Shelf has verified fire resistance certification."]);
    ctx.turnIR.answerRequests[0].subject = "Other Product";
    const result = recover(ctx);
    expect(result.response).not.toContain("has verified fire resistance certification");
    expect(result.validation.coverage.missing).toContain("answer.0.certification");
  });
  it("read-only scope still rejects tenant conflicts without operational authority", () => {
    const { ctx, sources } = setup(["load_capacity"], ["Maximum load capacity: 500 kg."]);
    ctx.operationalScope = undefined; ctx.evidenceScope = scope; sources[0].shop_id = "other";
    expect(recover(ctx).response).not.toContain("500 kg");
  });
  it("cannot choose from multiple catalog identities", () => {
    const { ctx, records } = setup(["load_capacity"], []);
    records[0].result.data = { products: [{ id: "p1", title: "Vale Shelf" }, { id: "p2", title: "Vale Shelf Large" }] };
    expect(recover(ctx).validation.coverage.missing).toContain("answer.0.load_capacity");
  });
  it("does not answer material uncertainty when a source explicitly specifies veneer and core", () => {
    const { ctx, sources } = setup([], ["The Oak variant uses oak veneer over an engineered wood core."]);
    sources[0].structured_data.semantic_type = "FACT";
    ctx.turnIR.answerRequests[0].propertyKey = "composition";
    const result = recover(ctx);
    expect(result.response).toContain("oak veneer");
    expect(result.response).not.toContain("does not establish its material composition");
  });
  it("registers unknown requests before evidence exists", () => {
    expect(compilePreciseAnswerRequests([{ facets: ["load_capacity", "certification"] }]).map(r => r.facet)).toEqual(["load_capacity", "certification", "qualified_next_step"]);
    const { ctx } = setup(["load_capacity"]);
    expect(missingPreciseEvidence(ctx).map(r => r.facet)).toContain("load_capacity");
    const result = recover(ctx);
    expect(result.response).toContain("cannot verify an approved load capacity");
    expect(result.validation.coverage.missing).toEqual([]);
    expect(result.validation.coverage.unknown).toContain("answer.0.load_capacity");
  });
  it.each([
    ["load_capacity", "No approved maximum load rating is specified."],
    ["repair_boundary", "Electrical repairs and cable replacement are not described. Contact store support if electrical parts appear damaged."],
    ["certification", "Fire resistance certification is not established."],
    ["placement", "Safe distance from a fireplace is not established."],
    ["prohibited_method", "Do not use bleach or abrasive chemicals."],
  ])("recovers genuine negative GUIDANCE %s despite boundary heading", (facet, text) => {
    const result = recover(setup([facet], [text]).ctx);
    expect(result.response).toContain(text);
    expect(result.validation.coverage.obligations.find(o => o.facet === facet)).toMatchObject({ satisfied: true, rendered: true });
  });
  it("dimensions cannot satisfy capacity", () => {
    const { ctx } = setup(["load_capacity"], ["Dimensions: 60 × 18 × 2.5 cm."]);
    const result = recover(ctx);
    expect(result.response).toContain("cannot verify an approved load capacity");
    expect(result.response).not.toContain("Dimensions:");
  });
  it("a description cannot satisfy certification", () => {
    const result = recover(setup(["certification"], ["Recycled felt wall panels."]).ctx);
    expect(result.response).toContain("cannot verify the requested safety certification");
    expect(result.validation.coverage.unknown).toContain("answer.0.certification");
  });
  it("keeps cleaning alternatives separate from dishwasher uncertainty", () => {
    const result = recover(setup(["cleaning_method"], ["Dishwasher safety is not established.", "Clean with a soft damp cloth; avoid abrasive cleaners."]).ctx);
    expect(result.response).toContain("Dishwasher safety is not established");
    expect(result.response).toContain("soft damp cloth");
    expect(result.validation.coverage.obligations.find(o => o.facet === "cleaning_alternative")).toMatchObject({ status: "supported", rendered: true });
  });
  it("preserves unlabeled dimensions without inventing depth", () => {
    const result = recover(setup(["dimension_depth"], ["Dimensions: 60 × 18 × 2.5 cm."]).ctx);
    expect(result.response).toContain("do not establish a labeled depth");
    expect(result.response).toContain("60 × 18 × 2.5");
    expect(result.response).not.toMatch(/depth (?:is |of )?18/i);
  });
  it("retrieval order cannot change required coverage", () => {
    const a = setup(["cleaning_method"], ["Dishwasher safety is not established.", "Clean with a soft damp cloth."]);
    const b = setup(["cleaning_method"], ["Clean with a soft damp cloth.", "Dishwasher safety is not established."]);
    for (const ctx of [a.ctx,b.ctx]) expect(recover(ctx).validation.coverage.obligations.every(o => o.rendered)).toBe(true);
  });
  it.each([[], [{ type: "acknowledgement", kind: "thanks" }]])("recovers omitted facts from alternate empty/ack shapes %j", segments => {
    const result = recover(setup(["load_capacity"], ["Maximum load capacity: 5 kg."]).ctx, { segments });
    expect(result.response).toContain("5 kg");
    expect(result.validation.coverage.obligations.find(o => o.facet === "load_capacity")).toMatchObject({ status: "supported", rendered: true });
  });
  it.each(["Do not invent load capacity values.", "The model should claim certification."])("blocks internal instructions: %s", text => {
    const { ctx } = setup(["load_capacity"], [text]);
    expect(validateStructuredResponse({ segments: [sourceSegment("load_capacity")] }, ctx).issues.map(i => i.code)).toContain("non_answer_source_role");
    expect(recover(ctx).response).not.toContain(text);
  });
  it.each(["workspace_id", "shop_id"])("blocks conflicting tenant %s", field => {
    const { ctx, sources } = setup(["load_capacity"], ["Maximum load capacity: 500 kg."]);
    sources[0][field] = "other";
    expect(validateStructuredResponse({ segments: [sourceSegment("load_capacity")] }, ctx).allValid).toBe(false);
    expect(recover(ctx).response).not.toContain("500 kg");
  });
  it("blocks another product and stale IDs", () => {
    const { ctx, sources } = setup(["load_capacity"], ["Maximum load capacity: 500 kg."]);
    sources[0].structured_data.applicability.product_ids = ["p2"];
    expect(validateStructuredResponse({ segments: [sourceSegment("load_capacity")] }, ctx).issues.map(i => i.code)).toContain("product_scope_mismatch");
    expect(validateStructuredResponse({ segments: [sourceSegment("load_capacity", "stale")] }, ctx).issues.map(i => i.code)).toContain("unknown_result_id");
  });
  it("cannot substitute fabricated repair, cleaning, certification or remedy prose", () => {
    const { ctx } = setup(["repair_boundary"], ["No approved repair procedure is specified. Contact store support."]);
    for (const text of ["Replace the live power cord yourself.", "Use bleach.", "It is fire certified.", "A refund has been issued."]) {
      const result = recover(ctx, { segments: [{ type: "knowledge_guidance", text, basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
      expect(result.response).not.toContain(text);
    }
  });
});

describe("PR 104 dimension semantics and localized limitations", () => {
  it.each([
    ["dimension_width", "Width: 60 cm"], ["dimension_width", "Width is 60 cm"], ["dimension_width", "The shelf is 60 cm wide"],
    ["dimension_depth", "Depth: 18 cm"], ["dimension_depth", "Depth is 18 cm"], ["dimension_depth", "The shelf is 18 cm deep"],
    ["dimension_height", "Height: 2.5 cm"], ["dimension_height", "Height is 2.5 cm"], ["dimension_height", "The shelf is 2.5 cm high"],
    ["dimension_width", "Bredde: 60 cm"], ["dimension_width", "Bredde er 60 cm"], ["dimension_width", "Hylden er 60 cm bred"],
    ["dimension_depth", "Dybde: 18 cm"], ["dimension_depth", "Dybde er 18 cm"], ["dimension_depth", "Hylden er 18 cm dyb"],
    ["dimension_height", "Højde: 2,5 cm"], ["dimension_height", "Højde er 2,5 cm"], ["dimension_height", "Hylden er 2,5 cm høj"],
    ["dimension_width", "Bordet er 60 cm bredt"], ["dimension_depth", "Bordet er 18 cm dybt"], ["dimension_height", "Bordet er 2,5 cm højt"],
    ["dimension_width", "Bredden er 60 cm"], ["dimension_depth", "Dybden er 18 cm"], ["dimension_height", "Højden er 2,5 cm"],
  ])("recovers a source-authored %s from %s", (facet, text) => {
    const result = recover(setup([facet], [text]).ctx);
    expect(sourceSupportsFacet(text, facet)).toBe(true);
    expect(result.response).toContain(text);
    expect(result.response).not.toContain("do not establish a labeled");
    expect(result.response).not.toContain("cannot verify documented dimensional values");
    expect(result.validation.coverage.obligations.find(o => o.facet === facet)).toMatchObject({ status: "supported", rendered: true });
  });
  it("another axis's uncertainty does not discard a verified labeled width", () => {
    expect(sourceSupportsFacet("Width is 60 cm. Depth is not established.", "dimension_width")).toBe(true);
    expect(sourceSupportsFacet("Width is 60 cm but is not established.", "dimension_width")).toBe(false);
  });
  it.each(["dimension_width", "dimension_depth", "dimension_height"])("unlabeled tuples do not establish %s", facet => {
    for (const text of ["60×18×2.5 cm", "Dimensions: 60 × 18 × 2.5 cm", "Width is unknown; dimensions: 60×18×2.5 cm"]) expect(sourceSupportsFacet(text, facet)).toBe(false);
    expect(sourceSupportsFacet("Depth: 18 cm", "dimension_width")).toBe(false);
  });
  it.each([
    ["en", "certification", "cannot verify the requested safety certification", "Ask the store or manufacturer"],
    ["da", "certification", "kan ikke bekræfte den ønskede sikkerhedscertificering", "Bed butikken eller producenten"],
    ["en", "repair_boundary", "cannot verify an approved customer repair", "Contact the store or a qualified professional"],
    ["da", "repair_boundary", "kan ikke bekræfte en godkendt fremgangsmåde", "Kontakt butikken eller en kvalificeret fagperson"],
    ["en", "load_capacity", "cannot verify an approved load capacity", "Ask the store or manufacturer"],
    ["da", "load_capacity", "kan ikke bekræfte en godkendt bæreevne", "Bed butikken eller producenten"],
  ])("uses %s for unavailable %s and qualified next steps", (locale, facet, limitation, handoff) => {
    const result = recover(setup([facet], [], { locale }).ctx);
    expect(result.response).toContain(limitation);
    expect(result.response).toContain(handoff);
    expect(result.validation.coverage.missing).toEqual([]);
    if (locale === "da") expect(result.response).not.toMatch(/I cannot|Ask the store|Contact the store/);
  });
});
function mixedSetup(secondFacet = "load_capacity", unresolved = false) {
  const { ctx, records, sources } = setup(["load_capacity"], ["Maximum load capacity: 5 kg."]);
  ctx.customerMessage = "What are the Vale Shelf load capacity and Luna Lamp specifications?";
  ctx.turnIR.answerRequests.push({ kind: "product_property", subject: "Luna Lamp", sourceText: ctx.customerMessage, facets: [secondFacet] });
  records.push({ resultId: "catalog-luna", toolName: "get_product", result: unresolved ? { status: "not_found", data: null } : { status: "ok", data: { id: "p2", title: "Luna Lamp" } } });
  sources.push({ ...sources[0], title: "Luna Lamp", provenance: { source_id: "source-luna", source_kind: "knowledge_v2_release" },
    structured_data: { ...sources[0].structured_data, applicability: { kind: "products", product_ids: ["p2"] } },
    evidence_sections: [{ heading: "Evidence boundary", content: secondFacet === "load_capacity" ? "Maximum load capacity: 2 kg." : "Certification: verified standard ABC." }] });
  ctx.preciseReadResults = Object.fromEntries(compilePreciseAnswerRequests(ctx.turnIR.answerRequests).map(r => [r.id, [r.requestIndex ? "catalog-luna" : "catalog"]]));
  return { ctx, records, sources };
}
describe("PR 104 per-subject evidence and coverage", () => {
  it.each([false, true])("binds same-facet recovery to both verified products, reordered=%s", reordered => {
    const { ctx, records, sources } = mixedSetup();
    if (reordered) { records.reverse(); sources.reverse(); }
    const result = recover(ctx);
    expect(result.response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
    expect(result.response).toContain("Luna Lamp: Maximum load capacity: 2 kg");
    expect(result.validation.coverage.missing).toEqual([]);
    for (const [index, id] of [[0,"p1"],[1,"p2"]]) expect(result.validation.coverage.obligations.find(o => o.id === `answer.${index}.load_capacity`)).toMatchObject({ status: "supported", subjectIds: [id], rendered: true });
  });
  it("preserves different requested facets without a first-product limitation", () => {
    const result = recover(mixedSetup("certification").ctx);
    expect(result.response).toContain("Luna Lamp: Certification: verified standard ABC");
    expect(result.response).not.toContain("cannot verify the requested safety certification");
    expect(result.validation.coverage.missing).toEqual([]);
  });
  it("one product's available facet cannot complete the other's missing facet", () => {
    const { ctx, sources } = mixedSetup(); sources.pop();
    const result = recover(ctx);
    expect(result.response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
    expect(result.response).toContain("Luna Lamp: I cannot verify an approved load capacity");
    expect(result.validation.coverage.obligations.find(o => o.id === "answer.1.load_capacity")).toMatchObject({ status: "unknown", subjectIds: ["p2"], rendered: true });
    expect(result.validation.coverage.obligations.find(o => o.id === "answer.0.qualified_next_step")).toMatchObject({ status: "supported" });
  });
  it.each(["en", "da"])("unverified second identity receives only its own %s limitation", locale => {
    const { ctx, sources } = mixedSetup("load_capacity", true); sources.pop(); ctx.locale = locale;
    const result = recover(ctx);
    expect(result.response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
    expect(result.response).not.toContain("2 kg");
    expect(result.response).toContain(locale === "da" ? "Luna Lamp: Jeg kan ikke bekræfte produktets identitet" : "Luna Lamp: I cannot verify this product's identity");
    expect(result.validation.coverage.obligations.find(o => o.id === "answer.1.load_capacity")).toMatchObject({ status: "unknown", subjectIds: [], rendered: true });
    const wrongLimit = { type: "facet_limit", request_index: 1, facet: "load_capacity", basis: { result_id: "catalog", field_paths: ["status"] } };
    expect(validateStructuredResponse({ segments: [wrongLimit] }, ctx).issues.map(i => i.code)).toContain("answer_facet_scope_unverified");
  });
  it("unverified identities cannot be repaired by a care segment from returned knowledge", () => {
    const { ctx, records, sources } = mixedSetup("cleaning_method", true); sources[0].title = "Other Shelf";
    records.find(r => r.resultId === "catalog").result = { status: "not_found", data: null };
    const output = { segments: [{ ...sourceSegment("load_capacity"), kind: "care_constraint" }] };
    expect(validateStructuredResponse(output, ctx).issues.map(i => i.code)).toContain("product_scope_mismatch");
    expect(recover(ctx, output).response).not.toContain("5 kg");
  });
  it("rejects a facet assigned to the wrong requested product", () => {
    const { ctx, sources } = mixedSetup("certification");
    sources[0].evidence_sections[0].content = "Certification: verified standard WRONG.";
    const validation = validateStructuredResponse({ segments: [sourceSegment("certification")] }, ctx);
    expect(validation.issues.map(i => i.code)).toContain("answer_facet_scope_unverified");
    expect(recover(ctx).response).not.toContain("standard WRONG");
  });
  it("does not merge distinct variants sharing their first title token", () => {
    const { ctx, records } = mixedSetup();
    ctx.customerMessage = "Compare Vale Shelf and Vale Cabinet load capacity.";
    ctx.turnIR.answerRequests[1].subject = "Vale Cabinet";
    records.find(r => r.resultId === "catalog-luna").result.data = { id: "p1", title: "Vale Shelf" };
    const result = recover(ctx);
    expect(result.validation.coverage.obligations.find(o => o.id === "answer.1.load_capacity")).toMatchObject({ subjectIds: [], status: "unknown" });
    expect(result.response).toContain("Vale Cabinet: I cannot verify this product's identity");
  });
});

describe("second review: exact property entailment", () => {
  function question(facet, message, texts, qualifiers) {
    const { ctx, sources, records } = setup([facet], texts);
    ctx.customerMessage = message;
    ctx.turnIR.answerRequests[0].sourceText = message;
    if (qualifiers) ctx.turnIR.answerRequests[0].qualifiers = qualifiers.map(value => ({ facet, value }));
    return { ctx, sources, records };
  }
  it.each([
    ["Is Vale Shelf UL certified?", "FSC certified.", "UL"],
    ["Is Vale Shelf UL 153 certified?", "UL 1598 certified.", "UL 153"],
    ["Er Vale Shelf UL-certificeret?", "FSC-certificeret.", "UL"],
    ["Is Vale Shelf UL certified?", "FSC certified. UL is the model name.", "UL"],
    ["Is Vale Shelf UL certified?", "UL model, FSC certified.", "UL"],
    ["Is Vale Shelf UL certified?", "FSC certified, UL is the model name.", "UL"],
  ])("another certification cannot satisfy %s", (message, source, qualifier) => {
    const { ctx } = question("certification", message, [source]);
    const result = recover(ctx, { segments: [sourceSegment("certification")] });
    expect(result.validation.rejectedSegments.length).toBeGreaterThan(0);
    expect(result.validation.coverage.obligations.find(o => o.facet === "certification")).toMatchObject({ status: "unknown", qualifiers: [qualifier] });
    expect(result.response).toContain("cannot verify the requested safety certification");
    expect(result.response).not.toContain(source);
  });
  it.each([
    ["Is Vale Shelf UL certified?", "UL certified.", "supported"],
    ["Is Vale Shelf UL certified?", "UL and FSC certified.", "supported"],
    ["Is Vale Shelf UL certified?", "Certification: UL.", "supported"],
    ["Is Vale Shelf UL 153 certified?", "Certified to UL 153.", "supported"],
    ["Er Vale Shelf UL-certificeret?", "UL-certificering er ikke dokumenteret.", "unknown"],
    ["Is Vale Shelf UL certified?", "UL certification is not established.", "unknown"],
  ])("preserves specifically supported or unavailable certification: %s", (message, source, status) => {
    const result = recover(question("certification", message, [source]).ctx);
    expect(result.response).toContain(source);
    expect(result.validation.coverage.obligations.find(o => o.facet === "certification")).toMatchObject({ status, rendered: true });
  });
  it.each([
    "Hand wash with warm water.", "Machine wash at 30 degrees.",
    "Vask i hånden med varmt vand.", "Hand wash only. Dishwasher is the model name.",
    "Hand wash the item; dishwasher is the model name.", "Hand wash this model, dishwasher is just its name.",
  ])("generic washing cannot establish dishwasher safety: %s", source => {
    const result = recover(question("cleaning_method", "Is Vale Shelf dishwasher-safe?", [source]).ctx);
    expect(result.validation.coverage.obligations.find(o => o.facet === "cleaning_method")).toMatchObject({ status: "unknown", qualifiers: ["dishwasher"] });
    expect(result.response).toContain("does not establish that the requested cleaning method is safe");
  });
  it.each([
    ["Is Vale Shelf dishwasher-safe?", "Dishwasher-safe.", "supported"],
    ["Is Vale Shelf dishwasher-safe?", "Dishwasher safety is not established.", "unknown"],
    ["Kan Vale Shelf vaskes i opvaskemaskinen?", "Tåler opvaskemaskine.", "supported"],
    ["Kan Vale Shelf vaskes i opvaskemaskinen?", "Sikkerhed ved vask i opvaskemaskine er ikke dokumenteret.", "unknown"],
    ["Can I machine wash Vale Shelf?", "Do not machine wash or tumble dry.", "supported"],
  ])("keeps exact method guidance or uncertainty for %s", (message, source, status) => {
    const result = recover(question("cleaning_method", message, [source]).ctx);
    expect(result.response).toContain(source);
    expect(result.validation.coverage.obligations.find(o => o.facet === "cleaning_method")).toMatchObject({ status, rendered: true });
  });
  it("unsupported model prose cannot substitute UL for a source's FSC", () => {
    const { ctx, sources } = question("certification", "Is Vale Shelf UL certified?", ["FSC certified."]);
    sources[0].structured_data.semantic_type = "FACT";
    const result = recover(ctx, { segments: [{ type: "knowledge_guidance", text: "Yes, it is UL certified.", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
    expect(result.response).not.toContain("it is UL certified");
    expect(result.validation.coverage.obligations.find(o => o.facet === "certification")).toMatchObject({ status: "unknown" });
  });
  it.each(["Product weight: 5 kg.", "Produktets vægt: 5 kg.", "Load information. Product weight: 5 kg."])("product mass does not establish maximum load: %s", source => {
    const result = recover(question("load_capacity", "What is Vale Shelf's maximum load?", [source]).ctx);
    expect(result.response).toContain("cannot verify an approved load capacity");
    expect(result.response).not.toContain(source);
    expect(result.validation.coverage.obligations.find(o => o.facet === "load_capacity")).toMatchObject({ status: "unknown" });
  });
  it("keeps a supported alternative when the requested method remains unavailable", () => {
    const result = recover(question("cleaning_method", "Is Vale Shelf dishwasher-safe?", ["Clean with a soft damp cloth and avoid abrasive cleaners."]).ctx);
    expect(result.response).toContain("soft damp cloth");
    expect(result.response).toContain("does not establish that the requested cleaning method is safe");
    expect(result.validation.coverage.obligations.find(o => o.facet === "cleaning_alternative")).toMatchObject({ status: "supported", rendered: true });
  });
});

describe("second review: Danish and English verified evidence", () => {
  it.each([
    ["load_capacity", "Maksimal belastning: 5 kg.", "supported"],
    ["load_capacity", "Maximum load: 5 kg.", "supported"],
    ["weight_limit", "Tilladt belastning er 5 kg.", "supported"],
    ["weight_limit", "Weight limit: 5 kg.", "supported"],
    ["load_capacity", "Maksimal belastning er ikke oplyst.", "unknown"],
    ["load_capacity", "No approved maximum load rating is specified.", "unknown"],
    ["electrical_safety", "Elektrisk reparation og udskiftning af kabel er ikke dokumenteret. Kontakt butikken ved beskadigede elektriske dele.", "unknown"],
    ["repair_boundary", "Reparation af strømledning er ikke beskrevet. Kontakt en kvalificeret fagperson.", "unknown"],
    ["certification", "Brandcertificering er ikke dokumenteret.", "unknown"],
    ["certification", "Fire resistance certification is not established.", "unknown"],
    ["placement", "Sikker afstand til pejs er ikke dokumenteret.", "unknown"],
    ["prohibited_method", "Brug ikke blegemiddel eller skuremidler.", "supported"],
    ["prohibited_method", "Undgå skuremidler og stærke kemikalier.", "supported"],
    ["load_capacity", "Der er ingen oplysninger om maksimal belastning.", "unknown"],
    ["certification", "UL certification is not verified.", "unknown"],
    ["prohibited_method", "Do not use bleach or abrasive cleaners.", "supported"],
    ["cleaning_alternative", "Rengør med en blød fugtig klud.", "supported"],
    ["cleaning_alternative", "Clean with a soft damp cloth.", "supported"],
  ])("retains source meaning for %s: %s", (facet, source, status) => {
    const result = recover(setup([facet], [source]).ctx);
    expect(result.response).toContain(source);
    expect(result.validation.coverage.obligations.find(o => o.facet === facet)).toMatchObject({ status, rendered: true });
  });
  it.each(["Rengør ikke med en klud.", "Vask ved 90 grader er ikke tilladt.", "Do not wipe with a cloth."])("a prohibited method is not an approved alternative: %s", source => {
    expect(sourceSupportsFacet(source, "cleaning_alternative")).toBe(false);
  });
  it("localized evidence retains product, tenant and source authority controls", () => {
    const { ctx, sources } = setup(["load_capacity"], ["Maksimal belastning: 500 kg."]);
    sources[0].structured_data.applicability.product_ids = ["wrong-product"];
    expect(recover(ctx).response).not.toContain("500 kg");
    sources[0].structured_data.applicability.product_ids = ["p1"];
    sources[0].shop_id = "wrong-shop";
    expect(recover(ctx).response).not.toContain("500 kg");
  });
});

describe("second review: prefixed titles and paragraph deduplication", () => {
  it("accepts a single verified title with an omitted brand prefix", () => {
    const { ctx, records } = setup(["load_capacity"], ["Maximum load: 5 kg."]);
    records[0].result.data.title = "Acme Vale Shelf";
    const result = recover(ctx);
    expect(result.response).toContain("Maximum load: 5 kg");
    expect(result.response).not.toContain("cannot verify this product's identity");
    expect(result.validation.coverage.obligations.find(o => o.facet === "load_capacity")).toMatchObject({ subjectIds: ["p1"], rendered: true });
  });
  it.each(["ambiguous", "wrong-product", "wrong-tenant"])("prefix matching remains fail closed for %s", mode => {
    const { ctx, records } = setup(["load_capacity"], ["Maximum load: 500 kg."]);
    ctx.preciseReadResults = Object.fromEntries(compilePreciseAnswerRequests(ctx.turnIR.answerRequests).map(r => [r.id,["catalog"]]));
    if (mode === "wrong-product") records[1].result.data.results[0].title = "Acme Luna Lamp";
    if (mode === "wrong-tenant") records[1].result.data.results[0].shop_id = "other";
    records[0].result.data = mode === "ambiguous" ? { products: [{ id: "p1", title: "Acme Vale Shelf" }, { id: "p2", title: "Other Vale Shelf" }] } : { id: "p1", title: mode === "wrong-product" ? "Acme Luna Lamp" : "Acme Vale Shelf", ...(mode === "wrong-tenant" ? { shop_id: "other" } : {}) };
    expect(recover(ctx).response).not.toContain("500 kg");
  });
  it("one source paragraph renders once while satisfying three obligations", () => {
    const text = "Electrical repairs and cable replacement are not described. Contact store support if electrical parts appear damaged.";
    const result = recover(setup(["electrical_safety", "repair_boundary"], [text]).ctx);
    expect(result.response.split(text)).toHaveLength(2);
    expect(result.validation.coverage.obligations).toHaveLength(3);
    expect(result.validation.coverage.obligations.every(o => o.satisfied && o.rendered)).toBe(true);
  });
  it("overlapping model source paths cannot duplicate a shared paragraph after recovery", () => {
    const texts = ["Do not machine wash or tumble dry.", "Clean with a soft damp cloth."];
    const { ctx } = setup(["cleaning_method", "prohibited_method"], texts);
    const segments = [
      { type: "source_content", kind: "product_constraint", facet: "cleaning_method", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content", "results[1].evidence_sections[0].content"] } },
      { type: "source_content", kind: "product_constraint", facet: "prohibited_method", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } },
    ];
    const result = recover(ctx,{segments});
    for (const text of texts) expect(result.response.split(text)).toHaveLength(2);
    expect(result.validation.coverage.obligations.every(o => o.satisfied && o.rendered)).toBe(true);
  });
  it("does not deduplicate different product subjects or unique negative conditions", () => {
    const { ctx, sources } = mixedSetup();
    sources[1].evidence_sections[0].content = sources[0].evidence_sections[0].content;
    const result = recover(ctx);
    expect(result.response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
    expect(result.response).toContain("Luna Lamp: Maximum load capacity: 5 kg");
    const distinct = recover(setup(["repair_boundary"], ["Repairs are not described. Contact store support.", "Cable replacement is not approved. Contact a qualified professional."]).ctx);
    expect(distinct.response).toContain("Repairs are not described");
    expect(distinct.response).toContain("Cable replacement is not approved");
  });
});


describe("second review qualifier contract", () => {
  it("fire safety certification does not establish specifically requested fire resistance", () => {
    const request = compilePreciseAnswerRequests([{ facets: ["certification"], sourceText: "Is it fire-resistant?" }])[0];
    expect(sourceSupportsRequest("Fire safety certification is verified.", request)).toBe(false);
    expect(sourceSupportsRequest("Fire resistance certification is not established.", request)).toBe(true);
  });
  it("exact load qualifiers reject another load property", () => {
    const request = compilePreciseAnswerRequests([{ facets: ["load_capacity"], qualifiers: [{ facet: "load_capacity", value: "shelf load" }] }])[0];
    expect(sourceSupportsRequest("Maximum load: 5 kg.", request)).toBe(false);
    expect(sourceSupportsRequest("Maximum shelf load is not specified.", request)).toBe(true);
  });
  it("a model cannot turn a Danish prohibited method into positive prose", () => {
    const { ctx } = setup(["prohibited_method"], ["Må ikke vaskes i opvaskemaskine."]);
    ctx.customerMessage = "Må Vale Shelf vaskes i opvaskemaskine?";
    ctx.turnIR.answerRequests[0].sourceText = ctx.customerMessage;
    const result = recover(ctx, { segments: [{ type: "knowledge_guidance", text: "Det er sikkert at vaske i opvaskemaskine.", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
    expect(result.response).toContain("Må ikke vaskes i opvaskemaskine");
    expect(result.response).not.toContain("Det er sikkert");
  });
});


describe("qualified limitation disposition", () => {
  it("names only the unavailable certificate when another requested certificate is verified", () => {
    const { ctx } = setup(["certification"], ["FSC certified."]);
    const message = "Is Vale Shelf UL and FSC certified?";
    ctx.customerMessage = message;
    ctx.turnIR.answerRequests = ["UL", "FSC"].map(value => ({ kind: "product_property", subject: "Vale Shelf", sourceText: value, facets: ["certification"], qualifiers: [{ facet: "certification", value }] }));
    const result = recover(ctx);
    expect(result.response).toContain("For UL: I cannot verify");
    expect(result.response).toContain("FSC certified");
    expect(result.response).not.toContain("For FSC: I cannot verify");
    expect(result.validation.coverage.obligations.find(o => o.id === "answer.0.certification")).toMatchObject({ status: "unknown", qualifiers: ["UL"], rendered: true });
    expect(result.validation.coverage.obligations.find(o => o.id === "answer.1.certification")).toMatchObject({ status: "supported", qualifiers: ["FSC"], rendered: true });
  });
  it("names the unavailable method using the existing Danish locale", () => {
    const { ctx } = setup(["cleaning_method"], ["Rengør med en blød fugtig klud."], { locale: "da" });
    ctx.turnIR.answerRequests[0].sourceText = "Må Vale Shelf vaskes i opvaskemaskine?";
    const result = recover(ctx);
    expect(result.response).toContain("Om opvaskemaskine:");
    expect(result.response).not.toContain("dishwasher");
    expect(result.response).toContain("fugtig klud");
  });
});

describe("candidate predicates versus specifically requested properties", () => {
  it.each([
    ["solid oak", "The Oak variant uses oak veneer over an engineered wood core."],
    ["all wool", "Material: 100% wool."],
    ["cotton", "Material: 100% wool."],
  ])("answers candidate material %s using the actual source value", (qualifier, text) => {
    const { ctx, sources } = setup(["material_composition"], [text]);
    sources[0].structured_data.semantic_type = "FACT";
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "material_composition", value: qualifier }];
    const result = recover(ctx, { segments: [{ type: "knowledge_guidance", text: "Material: 100% cotton.", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
    expect(result.response).toContain(text);
    expect(result.response).not.toContain("does not establish the requested material");
    expect(result.response).not.toContain("100% cotton");
    expect(result.validation.coverage.obligations.find(o => o.facet === "material_composition")).toMatchObject({ status: "supported", rendered: true });
  });
  it("a documented rated load answers the candidate load without affirming it", () => {
    const { ctx } = setup(["load_capacity"], ["Maximum load: 5 kg."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "load_capacity", value: "20 kg" }];
    const result = recover(ctx, { segments: [{ type: "knowledge_guidance", text: "It can safely hold 20 kg.", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } }] });
    expect(result.response).toContain("Maximum load: 5 kg");
    expect(result.response).not.toContain("hold 20 kg");
    expect(result.response).not.toContain("cannot verify an approved load capacity");
  });
  it("a documented negative chemical restriction addresses a specifically asked strong cleaner", () => {
    const { ctx } = setup(["cleaning_method", "prohibited_method"], ["Avoid prolonged contact with standing water and strong household chemicals.", "For care, wipe with a lightly damp cloth and dry immediately."]);
    ctx.turnIR.answerRequests[0].sourceText = "Can I use strong bathroom cleaner?";
    ctx.turnIR.answerRequests[0].qualifiers = ["cleaning_method", "prohibited_method"].map(facet => ({ facet, value: "strong bathroom cleaner" }));
    const result = recover(ctx);
    expect(result.response).toContain("strong household chemicals");
    expect(result.response).toContain("lightly damp cloth");
    expect(result.response).not.toContain("cannot verify all applicable cleaning restrictions");
    expect(result.response).not.toContain("does not establish that the requested cleaning method is safe");
    expect(result.validation.coverage.obligations.every(o=>o.satisfied&&o.rendered)).toBe(true);
  });
  it("generic positive care advice does not certify a specific strong cleaner", () => {
    const { ctx } = setup(["cleaning_method"], ["Clean with household cleaning products."]);
    ctx.turnIR.answerRequests[0].sourceText = "Can I use strong bathroom cleaner?";
    const result = recover(ctx);
    expect(result.validation.coverage.obligations.find(o=>o.facet==='cleaning_method')).toMatchObject({status:'unknown'});
  });
});

describe("precise qualifier normalization", () => {
  it("keeps the quoted qualifier but does not duplicate its normalized equivalent", () => {
    const requests = compilePreciseAnswerRequests([{ facets: ["certification"], sourceText: "Is it fire resistant?", qualifiers: [{ facet: "certification", value: "fire resistant" }] }]);
    expect(requests[0].qualifiers).toEqual(["fire resistant"]);
  });
  it("proposed books load remains answered by the documented absence of a rating", () => {
    const { ctx } = setup(["load_capacity"], ["No approved maximum load rating is specified."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "load_capacity", value: "8 kg of books" }];
    const result = recover(ctx);
    expect(result.response).toContain("No approved maximum load rating is specified");
    expect(result.response).not.toContain("I cannot verify an approved load capacity");
  });
  it("a redundant depth qualifier does not reject a verified axis phrasing", () => {
    const { ctx } = setup(["dimension_depth"], ["Depth is 18 cm."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "dimension_depth", value: "deep" }];
    const result = recover(ctx);
    expect(result.response).toContain("Depth is 18 cm");
    expect(result.response).not.toContain("do not establish a labeled depth");
  });
});

describe("qualified method parameters", () => {
  it("a safe method alone cannot establish the requested temperature", () => {
    const { ctx } = setup(["cleaning_method"], ["Dishwasher-safe at 30 degrees."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "cleaning_method", value: "dishwasher at 90 degrees" }];
    const result = recover(ctx);
    expect(result.validation.coverage.obligations.find(o=>o.facet==='cleaning_method')).toMatchObject({status:'unknown'});
    expect(result.response).not.toContain("Dishwasher-safe at 30 degrees");
  });
  it("different care clauses cannot supply a method's missing parameter", () => {
    const { ctx } = setup(["cleaning_method"], ["Dishwasher-safe at 30 degrees. Dry at 90 degrees."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "cleaning_method", value: "dishwasher at 90 degrees" }];
    expect(recover(ctx).validation.coverage.obligations.find(o=>o.facet==='cleaning_method')).toMatchObject({status:'unknown'});
  });
});


describe("qualified component and axis guidance", () => {
  it("genuine electrical repair uncertainty supports a power-cord replacement question", () => {
    const text = "Electrical repairs and cable replacement are not described. Contact store support if electrical parts appear damaged.";
    const { ctx } = setup(["electrical_safety", "repair_boundary"], [text]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "electrical_safety", value: "power cord" }, { facet: "repair_boundary", value: "replace the power cord" }];
    const result = recover(ctx);
    expect(result.response.split(text)).toHaveLength(2);
    expect(result.response).not.toContain("I cannot verify an approved customer repair");
    expect(result.validation.coverage.obligations.every(o=>o.satisfied&&o.rendered)).toBe(true);
  });
  it("an unrelated repair property is not established by an electrical paragraph", () => {
    const { ctx } = setup(["repair_boundary"], ["Cable replacement is documented. Contact store support."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "repair_boundary", value: "shade replacement" }];
    expect(recover(ctx).validation.coverage.obligations.find(o=>o.facet==='repair_boundary')).toMatchObject({status:'unknown'});
  });
  it("a question-shaped axis label does not suppress a labeled dimension", () => {
    const { ctx } = setup(["dimension_depth"], ["Depth is 18 cm."]);
    ctx.turnIR.answerRequests[0].qualifiers = [{ facet: "dimension_depth", value: "how deep" }];
    expect(recover(ctx).response).toContain("Depth is 18 cm");
  });
});


describe("qualified method units", () => {
  it("equal numeric temperatures in different units do not establish the requested setting", () => {
    const request = compilePreciseAnswerRequests([{ facets: ["cleaning_method"], qualifiers: [{ facet: "cleaning_method", value: "dishwasher at 90°F" }] }])[0];
    expect(sourceSupportsRequest("Dishwasher-safe at 90°C.", request)).toBe(false);
    expect(sourceSupportsRequest("Dishwasher-safe at 90 degrees Fahrenheit.", request)).toBe(true);
  });
});

describe("product identity: independent static authority and grounded subjects", () => {
  it.each(["not_found", "unavailable", "error", "absent"])("preserves verified static load evidence after %s catalog", mode => {
    const { ctx, records } = setup(["load_capacity"], ["Maximum load: 5 kg."]);
    ctx.preciseReadResults = Object.fromEntries(compilePreciseAnswerRequests(ctx.turnIR.answerRequests).map(r => [r.id,["catalog"]]));
    if (mode === "absent") records.shift(); else records[0].result = { status: mode, data: null };
    const result = recover(ctx);
    expect(result.response).toContain("Maximum load: 5 kg");
    expect(result.response).not.toContain("cannot verify this product's identity");
    expect(result.validation.coverage.obligations.find(o => o.facet === "load_capacity")).toMatchObject({ status: "supported", subjectIds: ["p1"], rendered: true });
  });
  it.each(["wrong-tenant", "wrong-product", "missing-provenance", "wrong-authority", "competing-id", "unknown"])("static fallback rejects %s", mode => {
    const { ctx, records, sources } = setup(["load_capacity"], ["Maximum load: 500 kg."]);
    records[0].result = { status: "not_found", data: null };
    if (mode === "wrong-tenant") sources[0].workspace_id = "other";
    if (mode === "wrong-product") sources[0].title = "Vale Cabinet";
    if (mode === "missing-provenance") delete sources[0].provenance;
    if (mode === "wrong-authority") sources[0].authority = "example";
    if (mode === "unknown") sources.splice(0);
    if (mode === "competing-id") sources.push({ ...sources[0], structured_data: { ...sources[0].structured_data, applicability: { kind: "products", product_ids: ["p2"] } } });
    expect(recover(ctx).response).not.toContain("500 kg");
  });
  it.each(["Shelf Vale", "Vale Shelf Large", "Vale Shelf 2"])("rejects invented identifying subject %s", subject => {
    const { ctx, records, sources } = setup(["load_capacity"], ["Maximum load: 500 kg."]);
    ctx.customerMessage = subject === "Shelf Vale" ? "What can this shelf hold?" : "How much can Vale Shelf hold?";
    ctx.turnIR.answerRequests[0].subject = subject;
    records[0].result.data.title = subject;
    sources[0].title = subject;
    expect(recover(ctx).response).not.toContain("500 kg");
  });
  it("accepts a genuine follow-up to a customer-provided verified product", () => {
    const { ctx } = setup(["load_capacity"], ["Maximum load: 5 kg."]);
    ctx.customerMessage = "And how much can it hold?";
    ctx.customerProvidedContext = { product: "Vale Shelf" };
    expect(recover(ctx).response).toContain("5 kg");
  });
  it("keeps separate static identities across multiple products and read order", () => {
    const { ctx, records } = mixedSetup();
    records.filter(r => r.toolName === "get_product").forEach(r => { r.result = { status: "unavailable", data: null }; });
    records.reverse();
    const result = recover(ctx);
    expect(result.response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
    expect(result.response).toContain("Luna Lamp: Maximum load capacity: 2 kg");
  });
  it("accepts an omitted source-title brand prefix without allowing competing identities", () => {
    const { ctx, records, sources } = setup(["load_capacity"], ["Maximum load: 5 kg."]);
    records[0].result = { status: "not_found", data: null };
    sources[0].title = "Acme Vale Shelf";
    expect(recover(ctx).response).toContain("5 kg");
    sources.push({ ...sources[0], title: "Other Vale Shelf", structured_data: { ...sources[0].structured_data, applicability: { kind: "products", product_ids: ["p2"] } } });
    expect(recover(ctx).response).not.toContain("5 kg");
  });
  it("rejects catalog and static identity disagreement", () => {
    const { ctx, sources } = setup(["load_capacity"], ["Maximum load: 500 kg."]);
    sources[0].structured_data.applicability.product_ids = ["p2"];
    expect(recover(ctx).response).not.toContain("500 kg");
  });
});
it("current named competing product overrides a retained prior focus", () => {
  const { ctx, records } = setup(["load_capacity"], ["Maximum load: 500 kg."]);
  ctx.customerMessage = "What about the Luna Lamp's load capacity?";
  ctx.customerProvidedContext = { product: "Vale Shelf" };
  records.push({ resultId: "current-luna", toolName: "get_product", result: { status: "ok", data: { id: "p2", title: "Luna Lamp" } } });
  expect(recover(ctx).response).not.toContain("500 kg");
});
it.each(["In stock now.", "Out of stock.", "Price: 50 DKK", "Pris: 50 DKK", "Available to buy."])("static product identity does not authorize live field: %s", text => {
  const { ctx, sources, records } = setup([], [text]);
  ctx.turnIR.answerRequests = []; records[0].result = { status: "unavailable", data: null };
  sources[0].structured_data.semantic_type = "FACT";
  const source = { type: "source_content", kind: "product_property", basis: { result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] } };
  expect(validateStructuredResponse({ segments: [source] }, ctx).issues.map(i => i.code)).toContain("product_live_field_requires_provider");
});
it("static documentation never authorizes a live availability fact", () => {
  const { ctx } = setup([], ["In stock now."]);
  const segment = { type: "fact", fact_kind: "product_availability", evidence: [{ result_id: "knowledge", field_paths: ["results[0].evidence_sections[0].content"] }] };
  expect(validateStructuredResponse({ segments: [segment] }, ctx).approvedSegments).toEqual([]);
});
it("a matching applicability ID cannot launder a different product title", () => {
  const { ctx, sources } = setup(["load_capacity"], ["Maximum load: 500 kg."]);
  sources[0].title = "Vale Cabinet";
  expect(recover(ctx).response).not.toContain("500 kg");
});
it("does not render invented product identifiers in scoped limitations", () => {
  const { ctx } = mixedSetup();
  ctx.turnIR.answerRequests[1].subject = "Imaginary Lamp 7";
  expect(recover(ctx).response).not.toContain("Imaginary Lamp 7");
  expect(recover(ctx).response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
});
it("an unambiguous source numeric-size suffix does not erase a customer-named product", () => {
  const { ctx, sources, records } = setup([], ["No approved maximum load rating is specified."]);
  ctx.turnIR.answerRequests = []; ctx.customerMessage = "How much can Vale Shelf hold?";
  records.shift(); sources[0].title = "Vale Shelf 60";
  const output = { segments: [{ ...sourceSegment("load_capacity"), facet: "load_capacity" }] };
  expect(recover(ctx, output).response).toContain("No approved maximum load");
  sources.push({ ...sources[0], title: "Vale Shelf 80", structured_data: { ...sources[0].structured_data, applicability: { kind: "products", product_ids: ["p2"] } } });
  expect(recover(ctx, output).response).not.toContain("No approved maximum load");
});

describe("final review material values", () => {
  it.each(["Material: solid oak", "100% wool", "Made from stainless steel", "Materiale: massivt egetræ", "100% uld", "Fremstillet af rustfrit stål", "Material: recycled polypropylene"])("accepts actual composition: %s", text => {
    expect(sourceSupportsFacet(text,"material_composition")).toBe(true);
    const result = recover(setup(["material_composition"],[text]).ctx);
    expect(result.validation.coverage.obligations.find(o=>o.facet==="material_composition")).toMatchObject({status:"supported",rendered:true});
  });
  it.each(["Material care: wipe with a damp cloth", "Dimensional tolerance: 5%", "Materials are selected for comfort", "Material: care instructions", "Material care is not documented", "Tolerance is 5% wool shrinkage", "Material: various materials"])("rejects topic-only composition: %s", text => {
    expect(sourceSupportsFacet(text,"material_composition")).toBe(false);
    const result=recover(setup(["material_composition"],[text]).ctx);
    expect(result.validation.coverage.obligations.find(o=>o.facet==="material_composition")).toMatchObject({status:"unknown",rendered:true});
  });
});
describe("final review subjectless binding", () => {
  it("recovers care for a retained product without a model subject", () => {
    const {ctx}=setup(["cleaning_method"],["Dishwasher safety is not established. Clean with a soft damp cloth."]);
    ctx.customerMessage="Can it go in the dishwasher?";ctx.customerProvidedContext={product:"Vale Shelf"};ctx.turnIR.answerRequests[0].subject=null;
    expect(recover(ctx).response).toContain("soft damp cloth");
  });
  it.each([undefined,"Vale Shelf and Luna Lamp","Vale Shelf or Luna Lamp"])("does not choose an absent or ambiguous retained subject: %s", product => {
    const {ctx}=setup(["load_capacity"],["Maximum load: 500 kg."]);
    ctx.customerMessage="How much can it hold?";ctx.customerProvidedContext={product};ctx.turnIR.answerRequests[0].subject=null;
    expect(recover(ctx).response).not.toContain("500 kg");
  });
});
it.each(["Can the other one go in the dishwasher?","Kan den anden komme i opvaskemaskinen?"])("does not bind an ambiguous alternative reference: %s", message=>{
  const {ctx}=setup(["load_capacity"],["Maximum load: 500 kg."]);
  ctx.customerMessage=message;ctx.customerProvidedContext={product:"Vale Shelf"};ctx.turnIR.answerRequests[0].subject=null;
  expect(recover(ctx).response).not.toContain("500 kg");
});
