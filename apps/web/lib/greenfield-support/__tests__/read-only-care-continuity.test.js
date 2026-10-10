import { describe, expect, it } from "vitest";
import { ScriptedModel, assistantMessage, modelResponse } from "@openai/agents/testing";
import { createDemoDependencies } from "../demo-fixtures";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import fs from "node:fs";
import { normalizeCaseState, prepareCaseContext, prepareReadOnlyAnswers, bindReadOnlyAnswer, completeReadOnlyAnswers } from "../case-state";
import { normalizeTurnIR } from "../turn-ir";
const question = "Can I put it in the washing machine?";
const identification = "The Haven wool throw.";
const care = "Do not machine wash or tumble dry. Professional dry cleaning is recommended; air regularly and spot clean with cold water.";
const initialIR = { actions: [], answerRequests: [{ kind: "product_care", sourceText: question, subject: null, facets: ["prohibited_method"], qualifiers: [{ facet: "prohibited_method", value: "washing machine" }] }] };
const subjectIR = message => ({ actions: [], answerRequests: [{ kind: "product_property", propertyKey: "composition", sourceText: message, subject: "Haven Wool Throw" }], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "Haven Wool Throw" } });
async function session({ unavailable = false, ambiguous = false } = {}) {
 const deps = await createDemoDependencies(); deps.tenant.caseId = "care-case";
 const lookups = [], reads = [];
 deps.commerce.getProduct = async query => { lookups.push(query); return { products: [{ id: "haven", title: "Haven Wool Throw", handle: "haven-wool-throw" }, ...(ambiguous ? [{ id: "haven-other", title: "Haven Wool Throw" }] : [])] }; };
 deps.knowledge.search = async request => { reads.push(request.query); return unavailable ? [] : [{ score: 1, evidenceSections: [{ content: care, heading: "Care", chunkIds: ["care"] }], record: { title: "Haven Wool Throw", knowledgeType: "product", authority: "reference", sourceKind: "knowledge_v2_release", sourceId: "haven-care", structuredData: { semantic_type: "GUIDANCE", support_domain: "care", applicability: { kind: "products", product_ids: ["haven"] } } } }]; };
 let context;
 const turn = async (message, ir, patch = {}) => {
  const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "acknowledgement", kind: "thanks" }] }))])]);
  const result = await runGreenfieldAgentWithAgentsSdk({ ...deps, capabilities: deps, message, conversationContext: context, model, enableDevDiagnostics: true, turnInterpreter: async () => ir, ...patch });
  model.assertComplete(); context = result.conversationContext; return result;
 };
 return { deps, turn, reads, lookups, context: () => context };
}
describe("durable read-only care obligations", () => {
 it("043 retains the original care question after product identification, without model tool cooperation", async () => {
  const s = await session(); const first = await s.turn(question, initialIR); const second = await s.turn(identification, subjectIR(identification));
  if (process.env.CARE_EVIDENCE_FILE) fs.writeFileSync(process.env.CARE_EVIDENCE_FILE, JSON.stringify({ first: { response: first.response, state: first.conversationContext.caseState, trace: first.trace }, second: { response: second.response, state: second.conversationContext.caseState, trace: second.trace }, reads: s.reads, lookups: s.lookups }, null, 2));
  expect(second.response).toContain("Do not machine wash");
  expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(true);
  expect(second.response).not.toContain("material composition");
  expect(second.proposedActions).toEqual([]); expect(second.actionExecutions).toEqual([]);
  expect(first.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
  expect(second.trace.diagnostics.fallback_reason).toBeNull();
 });
});


describe("care continuity negative controls", () => {
 it("keeps unavailable care pending, without treating acknowledgement as completion", async () => {
  const s = await session({ unavailable: true }); await s.turn(question, initialIR);
  const r = await s.turn(identification, subjectIR(identification));
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBe("haven");
  expect(r.response).not.toContain("Do not machine wash");
  expect(r.proposedActions).toEqual([]);
 });
 it.each(["caseId", "workspaceId", "shopId"])("does not carry a request across another %s", async field => {
  const s = await session(); await s.turn(question, initialIR); s.reads.length = 0;
  const r = await s.turn(identification, subjectIR(identification), { tenant: { ...s.deps.tenant, [field]: "other" } });
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers ?? []).toEqual([]);
  expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(false);
  expect(r.response).not.toContain("Do not machine wash");
 });
 it("does not transfer an already bound unresolved request to another product", async () => {
  const s = await session({ unavailable: true }); await s.turn(question, initialIR); await s.turn(identification, subjectIR(identification));
  s.reads.length = 0;
  s.deps.commerce.getProduct = async () => ({ products: [{ id: "halo", title: "Halo Vase" }] });
  const message = "The Halo Vase.";
  const r = await s.turn(message, { actions: [], answerRequests: [{ kind: "product_property", propertyKey: "composition", subject: "Halo Vase", sourceText: message }], readOnlyFollowup: { kind: "provide_subject", subject: "Halo Vase", sourceText: message } });
  expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(false);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBe("haven");
  expect(r.response).not.toContain("Do not machine wash");
 });
 it("rejects a changed catalog ID even when the supplied title is unchanged", async () => {
  const s = await session({ unavailable: true }); await s.turn(question, initialIR); await s.turn(identification, subjectIR(identification)); s.reads.length = 0;
  s.deps.commerce.getProduct = async () => ({ products: [{ id: "other-haven", title: "Haven Wool Throw" }] });
  const r = await s.turn(identification, subjectIR(identification));
  expect(r.trace.events.some(e => e.data?.diagnostic === "read_only_subject_binding_conflict")).toBe(true);
  expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(false);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBe("haven");
 });
 it("suspends carryover for an explicit unrelated request without silently abandoning the old question", async () => {
  const s = await session(); await s.turn(question, initialIR); s.reads.length = 0;
  const message = "What is Halo Vase made of?";
  const r = await s.turn(message, { actions: [], answerRequests: [{ kind: "product_property", propertyKey: "composition", subject: "Halo Vase", sourceText: message }], readOnlyFollowup: { kind: "new_request", subject: null, sourceText: message } });
  expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(false);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
 });
 it("leaves a missing identity unresolved", async () => {
  const s = await session(); await s.turn(question, initialIR); s.reads.length = 0;
  const r = await s.turn("The one I bought.", { actions: [], readOnlyFollowup: { kind: "provide_subject", subject: null, sourceText: "The one I bought." } });
  expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(false);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBeUndefined();
 });
 it("cannot bind ambiguous catalog identities", async () => {
  const s = await session({ ambiguous: true }); await s.turn(question, initialIR); const r = await s.turn(identification, subjectIR(identification));
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBeUndefined();
  expect(r.response).not.toContain("Do not machine wash");
 });
 it("preserves unverified work when a resolution cannot independently establish product and care scope", async () => {
  const s = await session(); await s.turn(question, initialIR);
  const message = "Never mind, I no longer need the washing advice.";
  const r = await s.turn(message, { actions: [], readOnlyFollowup: { kind: "resolve", subject: null, sourceText: message } });
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
 });
 it("an interpreter failure cannot lose pending work or authorize an action", async () => {
  const s = await session(); await s.turn(question, initialIR);
  const r = await s.turn(identification, null, { turnInterpreter: async () => { throw new Error("interpreter unavailable"); } });
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(r.proposedActions).toEqual([]); expect(r.actionExecutions).toEqual([]);
 });
});

describe("read-only lifecycle structural controls", () => {
 const tenant = { workspaceId: "w", shopId: "s", caseId: "c", customerEmail: null };
 function pending() { const c = prepareCaseContext(undefined, tenant); const registration = prepareReadOnlyAnswers(c, initialIR, question, []); bindReadOnlyAnswer(c, registration.bindings[0], { id: "haven", title: "Haven Wool Throw" }); return { c, registration }; }
 it("approved source without rendered coverage cannot close the request", () => {
  const { c, registration } = pending();
  const obligations = ["prohibited_method", "cleaning_alternative"].map(facet => ({ id: `answer.0.${facet}`, status: "supported", subjectIds: ["haven"], satisfied: true, rendered: false }));
  expect(completeReadOnlyAnswers(c, registration.bindings, { coverage: { obligations } })).toEqual([]);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(1);
 });
 it("another product's rendered coverage cannot close a bound request", () => {
  const { c, registration } = pending();
  const obligations = ["prohibited_method", "cleaning_alternative"].map(facet => ({ id: `answer.0.${facet}`, status: "supported", subjectIds: ["other"], satisfied: true, rendered: true }));
  expect(completeReadOnlyAnswers(c, registration.bindings, { coverage: { obligations } })).toEqual([]);
 });
 it("does not mutate the previous turn's scoped pending state", () => {
  const c = prepareCaseContext(undefined, tenant); const first = prepareReadOnlyAnswers(c, initialIR, question, []);
  const next = prepareCaseContext(c, tenant); bindReadOnlyAnswer(next, first.bindings[0], { id: "haven", title: "Haven Wool Throw" });
  expect(c.caseState.pendingReadOnlyAnswers[0].request.subject).toBeNull();
 });
 it("no explicit server case ID means no carryover", () => {
  const { c } = pending(); expect(prepareCaseContext(c, { ...tenant, caseId: undefined }).caseState.pendingReadOnlyAnswers).toEqual([]);
 });
 it("follow-up annotations cannot invent a customer resolution quote", () => {
  expect(() => normalizeTurnIR({ actions: [], readOnlyFollowup: { kind: "resolve", sourceText: "Never mind", subject: null } }, identification)).toThrow();
 });
});


it("pending care survives the existing JSON CaseState persistence contract", () => {
 const tenant = { workspaceId: "w", shopId: "s", caseId: "c", customerEmail: null };
 const c = prepareCaseContext(undefined, tenant); prepareReadOnlyAnswers(c, initialIR, question, []);
 const restored = normalizeCaseState(JSON.parse(JSON.stringify(c.caseState)));
 expect(restored.pendingReadOnlyAnswers[0].request).toEqual(initialIR.answerRequests[0]);
});

describe("passing R1 safety cases remain supported", () => {
 const controls = [
  ["038", "Can I replace the power cord on my Norr Lamp myself? Mine looks frayed.", "Norr Lamp", ["electrical_safety", "repair_boundary"], "Electrical repairs and cable replacement are not described in the product instructions; contact support if the electrical parts appear damaged.", ["Electrical repairs", "not described"]],
  ["039", "How much weight can Vale Shelf hold? I'd put 8 kg of books on it.", "Vale Shelf", ["load_capacity"], "Maximum load capacity is not documented. Contact support to verify the shelf's load capacity before installation.", ["not documented", "before installation"]],
  ["040", "Is Halo Vase dishwasher safe on a cool cycle?", "Halo Vase", ["cleaning_method"], "Dishwasher safety is not established. Clean with a soft damp cloth; avoid abrasive cleaners.", ["not established", "soft damp cloth"]],
  ["041", "Is Nest Basket certified fire resistant? I'd keep it next to my fireplace.", "Nest Basket", ["certification", "placement"], "Fire resistance certification is not documented. Safe placement near heat is not established.", ["not documented", "not established"]],
 ];
 it.each(controls)("preserves R1 %s with no model tool call", async (_caseId, message, title, facets, content, required) => {
  const deps = await createDemoDependencies(); deps.tenant.caseId = "r1-preservation";
  deps.commerce.getProduct = async () => ({ products: [{ id: "p1", title }] });
  deps.knowledge.search = async () => [{ score: 1, evidenceSections: [{ content, heading: "Evidence boundary", chunkIds: ["c"] }], record: { title, knowledgeType: "product", authority: "reference", sourceKind: "knowledge_v2_release", sourceId: "source1", structuredData: { semantic_type: "GUIDANCE", support_domain: "product", applicability: { kind: "products", product_ids: ["p1"] } } } }];
  const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
  const r = await runGreenfieldAgentWithAgentsSdk({ ...deps, capabilities: deps, message, model, enableDevDiagnostics: true,
    turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: _caseId === "040" ? "product_care" : "product_property", sourceText: message, subject: title, facets }] }) });
  model.assertComplete(); for (const fact of required) expect(r.response).toContain(fact);
  expect(r.proposedActions).toEqual([]); expect(r.actionExecutions).toEqual([]); expect(r.trace.diagnostics.fallback_reason).toBeNull();
 });
});


it("a care facet is durable even under the existing product_property semantic shape", async () => {
 const s = await session(); const ir = { ...initialIR, answerRequests: [{ ...initialIR.answerRequests[0], kind: "product_property" }] };
 await s.turn(question, ir); const r = await s.turn(identification, subjectIR(identification));
 expect(r.response).toContain("Do not machine wash"); expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
});
it("a model-invented follow-up subject is not customer grounding", async () => {
 const s = await session(); await s.turn(question, initialIR); s.reads.length = 0;
 const message = "The one I bought.";
 const r = await s.turn(message, { actions: [], readOnlyFollowup: { kind: "provide_subject", subject: "Haven Wool Throw", sourceText: message } });
 expect(s.reads.some(query => query.includes("prohibited cleaning"))).toBe(false);
 expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBeUndefined();
});

describe("PR123 equivalent customer-grounded subjects", () => {
 it.each([
  ["The Haven wool throw", "Haven wool throw"],
  ["HAVEN WOOL THROW", "Haven wool throw"],
  ["The Haven wool-throw", "haven wool throw"],
 ])("carries care for equivalent subjects %s / %s", async (answerSubject, followupSubject) => {
  const s = await session(); await s.turn(question, initialIR);
  const message = "The HAVEN wool-throw.";
  const r = await s.turn(message, { actions: [], answerRequests: [{ kind: "product_property", propertyKey: "composition", sourceText: message, subject: answerSubject }], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: followupSubject } });
  expect(r.response).toContain("Do not machine wash");
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
 });
 it("does not collapse genuinely different product names", async () => {
  const s = await session(); await s.turn(question, initialIR);
  const message = "The Haven wool throw or the Halo Vase.";
  const r = await s.turn(message, { actions: [], answerRequests: [
   { kind: "product_property", sourceText: message, subject: "Haven wool throw", propertyKey: "composition" },
   { kind: "product_property", sourceText: message, subject: "Halo Vase", propertyKey: "composition" },
  ], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "Haven wool throw" } });
  expect(r.trace.events.some(e => e.data?.diagnostic === "read_only_answer_lifecycle" && e.data.carried.length)).toBe(false);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
 });
 it("equivalent wording cannot override ambiguous verified IDs", async () => {
  const s = await session({ ambiguous: true }); await s.turn(question, initialIR);
  const message = "The Haven wool throw.";
  const r = await s.turn(message, { actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "The Haven wool throw", propertyKey: "composition" }], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "Haven wool throw" } });
  expect(r.response).not.toContain("Do not machine wash");
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBeUndefined();
 });
 it("equivalent wording cannot override a conflicting verified product ID", async () => {
  const s = await session({ unavailable: true }); await s.turn(question, initialIR); await s.turn(identification, subjectIR(identification));
  s.deps.commerce.getProduct = async () => ({ products: [{ id: "different-haven", title: "Haven Wool Throw" }] });
  const message = "The Haven wool throw.";
  const r = await s.turn(message, { actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "The Haven wool throw", propertyKey: "composition" }], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "Haven wool throw" } });
  expect(r.trace.events.some(e => e.data?.diagnostic === "read_only_subject_binding_conflict")).toBe(true);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBe("haven");
 });
});

describe("PR123 scoped read-only resolution", () => {
 const tenant = { workspaceId: "w", shopId: "s", caseId: "c", customerEmail: null };
 function twoPending() {
  const c = prepareCaseContext(undefined, tenant);
  const message = "Can I machine wash Haven? Can I machine wash Halo?";
  const ir = { actions: [], answerRequests: [
   { kind: "product_care", sourceText: "Can I machine wash Haven?", subject: "Haven", facets: ["prohibited_method"] },
   { kind: "product_care", sourceText: "Can I machine wash Halo?", subject: "Halo", facets: ["prohibited_method"] },
  ] };
  const registered = prepareReadOnlyAnswers(c, ir, message, ["Haven", "Halo"]);
  registered.bindings.forEach((binding, i) => bindReadOnlyAnswer(c, binding, { id: ["haven", "halo"][i], title: ["Haven", "Halo"][i] })); return c;
 }
 it("resolves only the selected pending request", () => {
  const c = twoPending(); const [first, second] = c.caseState.pendingReadOnlyAnswers;
  const message = "Never mind the Haven machine wash question.";
  const ir = normalizeTurnIR({ actions: [], readOnlyFollowup: { kind: "resolve", sourceText: message, subject: null, targetRequestId: first.id } }, message);
  const result = prepareReadOnlyAnswers(c, ir, message, []);
  expect(result.closed).toEqual([first.id]); expect(c.caseState.pendingReadOnlyAnswers.map(r => r.id)).toEqual([second.id]);
 });
 it.each([null, "unknown-request", undefined])("preserves both pending questions for ambiguous/invalid target %s", targetRequestId => {
  const c = twoPending(); const original = structuredClone(c.caseState.pendingReadOnlyAnswers);
  const message = "Never mind that question.";
  prepareReadOnlyAnswers(c, { actions: [], readOnlyFollowup: { kind: "resolve", sourceText: message, subject: null, targetRequestId } }, message, []);
  expect(c.caseState.pendingReadOnlyAnswers).toEqual(original);
 });
 it("does not infer resolution from thanks or an assistant acknowledgement", () => {
  const c = twoPending(); const original = structuredClone(c.caseState.pendingReadOnlyAnswers);
  prepareReadOnlyAnswers(c, { actions: [] }, "Thanks.", []);
  completeReadOnlyAnswers(c, [], { approvedSegments: [{ type: "acknowledgement", kind: "thanks" }], coverage: { obligations: [] } });
  expect(c.caseState.pendingReadOnlyAnswers).toEqual(original);
 });
 it("a single verified pending question can be explicitly resolved with grounded scope", () => {
  const c = twoPending(); c.caseState.pendingReadOnlyAnswers = c.caseState.pendingReadOnlyAnswers.slice(0, 1);
  const id = c.caseState.pendingReadOnlyAnswers[0].id; const message = "Never mind the Haven machine wash question.";
  expect(prepareReadOnlyAnswers(c, { actions: [], readOnlyFollowup: { kind: "resolve", sourceText: message, subject: null } }, message, []).closed).toEqual([id]);
 });
});


it("grounds equivalent article-prefixed subjects against an unprefixed current message", async () => {
 const s = await session(); await s.turn(question, initialIR); const message = "Haven wool throw.";
 const r = await s.turn(message, { actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "The Haven wool throw", propertyKey: "composition" }], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "The Haven wool throw" } });
 expect(r.response).toContain("Do not machine wash"); expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
});
it("an explicit request ID distinguishes two care questions about the same product", () => {
 const tenant = { workspaceId: "w", shopId: "s", caseId: "c", customerEmail: null };
 const c = prepareCaseContext(undefined, tenant); const message = "Can I machine wash Haven? Can I use bleach on Haven?";
 const requests = [
  { kind: "product_care", sourceText: "Can I machine wash Haven?", subject: "Haven", facets: ["cleaning_method"], qualifiers: [{ facet: "cleaning_method", value: "machine wash" }] },
  { kind: "product_care", sourceText: "Can I use bleach on Haven?", subject: "Haven", facets: ["prohibited_method"], qualifiers: [{ facet: "prohibited_method", value: "bleach" }] },
 ];
 const registered = prepareReadOnlyAnswers(c, { actions: [], answerRequests: requests }, message, ["Haven"]);
 registered.bindings.forEach(binding => bindReadOnlyAnswer(c, binding, { id: "haven", title: "Haven" }));
 const [machine, bleach] = c.caseState.pendingReadOnlyAnswers; const resolution = "Never mind the Haven machine-wash question.";
 const ir = normalizeTurnIR({ actions: [], readOnlyFollowup: { kind: "resolve", sourceText: resolution, subject: null, targetRequestId: machine.id } }, resolution);
 expect(prepareReadOnlyAnswers(c, ir, resolution, []).closed).toEqual([machine.id]);
 expect(c.caseState.pendingReadOnlyAnswers.map(r => r.id)).toEqual([bleach.id]);
});
it("resolution IDs cannot be supplied by a subject-identification annotation", () => {
 expect(() => normalizeTurnIR({ actions: [], readOnlyFollowup: { kind: "provide_subject", sourceText: identification, subject: "Haven Wool Throw", targetRequestId: "care-case:read-only:0:0" } }, identification)).toThrow();
});
