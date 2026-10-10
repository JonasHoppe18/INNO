import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { createDemoDependencies } from "../demo-fixtures";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { normalizeTurnIR, TurnIRReadOnlyRecoveryError } from "../turn-ir";
import { prepareCaseContext, prepareReadOnlyAnswers, normalizeCaseState, bindReadOnlyAnswer, completeReadOnlyAnswers } from "../case-state";

const halo = "Is the Halo ceramic vase dishwasher safe?";
const nest = "Can I put the Nest felt basket in the washing machine?";
const resolution = "Never mind the Halo dishwasher question. I still need an answer about washing the Nest basket.";
const request = (message, subject, value) => ({ kind: "product_care", sourceText: message, subject,
 facets: ["cleaning_method", "prohibited_method"], qualifiers: value ? [{ facet: "cleaning_method", value }] : [] });
const haloIR = { actions: [], answerRequests: [request(halo, "Halo ceramic vase", "dishwasher")] };
// Captured DEV traces omit the raw interpreter payload. This controlled malformed
// optional annotation reproduces partial recovery, using the exact customer turn.
const nestIR = { actions: [], answerRequests: [request(nest, "Nest felt basket", "invented qualifier")] };
function recovery(ir = nestIR, message = nest) {
 try { normalizeTurnIR(ir, message); } catch (error) {
  expect(error).toBeInstanceOf(TurnIRReadOnlyRecoveryError); return error;
 }
 throw new Error("Expected partial normalization failure");
}
async function session() {
 const deps = await createDemoDependencies(); deps.tenant.caseId = "partial-care-case";
 deps.commerce.getProduct = async query => ({ products: query.toLowerCase().includes("halo")
  ? [{ id: "halo", title: "Halo Ceramic Vase" }] : [{ id: "nest", title: "Nest Felt Basket" }] });
 deps.knowledge.search = async () => [];
 let context;
 const turn = async (message, ir, patch = {}) => {
  const model = patch.model ?? new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "acknowledgement", kind: "thanks" }] }))])]);
  const result = await runGreenfieldAgentWithAgentsSdk({ ...deps, capabilities: deps, message, conversationContext: context,
   model, enableDevDiagnostics: true, turnInterpreter: async () => ir, ...patch });
  model.assertComplete(); context = JSON.parse(JSON.stringify(result.conversationContext)); return result;
 };
 return { deps, turn };
}
describe("partial read-only recovery durability", () => {
 it("retains Nest independently and closes only Halo in the exact three customer turns", async () => {
  const s = await session(); const first = await s.turn(halo, haloIR); const second = await s.turn(nest, nestIR);
  const haloId = first.conversationContext.caseState.pendingReadOnlyAnswers[0].id;
  const thirdIR = { actions: [], readOnlyFollowup: { kind: "resolve", subject: null, sourceText: "Never mind the Halo dishwasher question.", targetRequestId: haloId },
   answerRequests: [request("I still need an answer about washing the Nest basket.", "Nest basket", "washing")] };
  const third = await s.turn(resolution, thirdIR);
  const nestId = second.conversationContext.caseState.pendingReadOnlyAnswers.find(r => r.verifiedProductId === "nest")?.id;
  if (process.env.RECOVERY_EVIDENCE_FILE) fs.writeFileSync(process.env.RECOVERY_EVIDENCE_FILE, JSON.stringify({
   capture: "Exact DEV customer messages; controlled malformed qualifier, not the unavailable historical raw TurnIR",
   turns: [first, second, third].map((r, i) => ({ message: [halo, nest, resolution][i], response: r.response,
    state: r.conversationContext.caseState, trace: r.trace, proposedActions: r.proposedActions, actionExecutions: r.actionExecutions })) }, null, 2));
  expect(second.trace.diagnostics.turn_ir_unavailable).toBe(true);
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers.map(r => r.verifiedProductId)).toEqual(["halo", "nest"]);
  expect(third.conversationContext.caseState.pendingReadOnlyAnswers.some(r => r.id === haloId)).toBe(false);
  expect(third.conversationContext.caseState.pendingReadOnlyAnswers.some(r => r.id === nestId)).toBe(true);
  expect(third.proposedActions).toEqual([]); expect(third.actionExecutions).toEqual([]);
 });
 it("registers a separate new request on a resolution turn", () => {
  const c = prepareCaseContext(undefined, { workspaceId: "w", shopId: "s", caseId: "c" });
  const old = prepareReadOnlyAnswers(c, haloIR, halo, ["Halo ceramic vase"]).bindings[0].id;
  const ir = normalizeTurnIR({ actions: [], readOnlyFollowup: { kind: "resolve", sourceText: "Never mind Halo.", subject: null, targetRequestId: old },
   answerRequests: [request(nest, "Nest felt basket", "washing machine")] }, `Never mind Halo. ${nest}`);
  const prepared = prepareReadOnlyAnswers(c, ir, `Never mind Halo. ${nest}`, ["Nest felt basket"]);
  expect(prepared.closed).toEqual([old]); expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(c.caseState.pendingReadOnlyAnswers[0].request.subject).toBe("Nest felt basket");
 });
 it("keeps recovered qualifier uncertainty through JSON and a subject follow-up", async () => {
  const s = await session(); const first = await s.turn(nest, nestIR);
  expect(first.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(normalizeCaseState(JSON.parse(JSON.stringify(first.conversationContext.caseState))).pendingReadOnlyAnswers[0].unresolvedFacets).toContain("cleaning_method");
  const message = "The Nest felt basket.";
  const second = await s.turn(message, { actions: [], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "Nest felt basket" } });
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(second.trace.diagnostics.fallback_reason).toBeNull();
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers[0].unresolvedFacets).toContain("cleaning_method");
 });
});

const tenant = { workspaceId: "w", shopId: "s", caseId: "c", customerEmail: null };
function registeredRecovery() {
 const c = prepareCaseContext(undefined, tenant);
 const recovered = recovery();
 const prepared = prepareReadOnlyAnswers(c, null, nest, ["Nest felt basket"], recovered);
 bindReadOnlyAnswer(c, prepared.bindings[0], { id: "nest", title: "Nest Felt Basket" });
 return { c, prepared, recovered };
}
describe("recovered care safety and lifecycle controls", () => {
 it("does not duplicate repeated recovered registration after canonical title binding", () => {
  const { c, prepared, recovered } = registeredRecovery();
  const again = prepareReadOnlyAnswers(c, null, nest, ["Nest felt basket"], recovered);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(again.bindings).toEqual(prepared.bindings);
 });
 it.each(["workspaceId", "shopId", "caseId"])("discards recovered carryover across %s", field => {
  const { c } = registeredRecovery();
  expect(prepareCaseContext(c, { ...tenant, [field]: "different" }).caseState.pendingReadOnlyAnswers ?? []).toEqual([]);
 });
 it.each([false, true])("cannot close uncertain specificity even with fabricated complete coverage, rendered=%s", rendered => {
  const { c, prepared } = registeredRecovery();
  const obligations = ["cleaning_method", "prohibited_method", "cleaning_alternative"].map(facet => ({
   id: `answer.0.${facet}`, status: "supported", subjectIds: ["nest"], satisfied: true, rendered }));
  expect(completeReadOnlyAnswers(c, prepared.bindings, { coverage: { obligations } })).toEqual([]);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(1);
 });
 it("allows a recovered core without uncertain facets to close only on verified rendered coverage", () => {
  const ir = { actions: "bad schema", answerRequests: [request(nest, "Nest felt basket", "washing machine")] };
  const recovered = recovery(ir); const c = prepareCaseContext(undefined, tenant);
  const prepared = prepareReadOnlyAnswers(c, null, nest, ["Nest felt basket"], recovered);
  expect(c.caseState.pendingReadOnlyAnswers[0].unresolvedFacets ?? []).toEqual([]);
  bindReadOnlyAnswer(c, prepared.bindings[0], { id: "nest", title: "Nest Felt Basket" });
  const obligations = ["cleaning_method", "prohibited_method", "cleaning_alternative"].map(facet => ({
   id: `answer.0.${facet}`, status: "supported", subjectIds: ["nest"], satisfied: true, rendered: true }));
  expect(completeReadOnlyAnswers(c, prepared.bindings, { coverage: { obligations: obligations.map(o => ({ ...o, rendered: false })) } })).toEqual([]);
  expect(completeReadOnlyAnswers(c, prepared.bindings, { coverage: { obligations } })).toEqual([prepared.bindings[0].id]);
 });
 it("cannot overwrite a recovered verified product ID", () => {
  const { c, prepared } = registeredRecovery();
  expect(bindReadOnlyAnswer(c, prepared.bindings[0], { id: "conflicting-nest", title: "Nest Felt Basket" })).toBe(false);
  expect(c.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBe("nest");
 });
 it("can explicitly abandon the recovered target without closing another question", () => {
  const { c, prepared } = registeredRecovery(); c.turn++;
  prepareReadOnlyAnswers(c, haloIR, halo, ["Halo ceramic vase"]);
  const message = "Never mind Nest.";
  const result = prepareReadOnlyAnswers(c, normalizeTurnIR({ actions: [], readOnlyFollowup: {
   kind: "resolve", subject: null, sourceText: message, targetRequestId: prepared.bindings[0].id } }, message), message, []);
  expect(result.closed).toEqual([prepared.bindings[0].id]);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(c.caseState.pendingReadOnlyAnswers[0].request.subject).toBe("Halo ceramic vase");
 });
 it.each([
  { actions: "invalid", answerRequests: [] },
  { actions: "invalid", answerRequests: [request("unquoted request", "Nest felt basket", "invented")] },
  { actions: "invalid", answerRequests: [request(nest, "Invented Product", "invented")] },
 ])("full failure with no valid read-only request cannot register intent", async ir => {
  const s = await session(); const result = await s.turn(nest, ir);
  expect(result.trace.diagnostics.turn_ir_unavailable).toBe(true);
  expect(result.trace.events.some(e => e.data?.code === "turn_ir_read_only_recovered")).toBe(false);
  expect(result.conversationContext.caseState.pendingReadOnlyAnswers ?? []).toEqual([]);
  expect(result.proposedActions).toEqual([]); expect(result.actionExecutions).toEqual([]);
 });
 it("an ambiguous product never closes or binds recovered work", async () => {
  const s = await session(); s.deps.commerce.getProduct = async () => ({ products: [
   { id: "nest", title: "Nest Felt Basket" }, { id: "other-nest", title: "Nest Felt Basket" }] });
  const result = await s.turn(nest, nestIR);
  expect(result.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(result.conversationContext.caseState.pendingReadOnlyAnswers[0].verifiedProductId).toBeUndefined();
  expect(result.proposedActions).toEqual([]);
 });
 it("failed interpretation with an action cannot authorize a model-created proposal or confirmation", async () => {
  const s = await session(); const message = `${nest} Cancel order #123.`;
  const execute = vi.fn();
  const model = new ScriptedModel([
   modelResponse([functionCall("cancel_order", { order_id: "123", reason: "Customer request" }, { callId: "cancel" })]),
   modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }] }))]),
  ]);
  const ir = { ...nestIR, actions: [{ action: "cancel_order", sourceText: "Cancel order #123.", orderReference: "123", addressProvided: false }],
   confirmation: { sourceText: "invented confirmation", confirmed: true } };
  const result = await s.turn(message, ir, { model, actionExecutor: { execute } }); model.assertComplete();
  expect(result.trace.diagnostics.turn_ir_unavailable).toBe(true);
  expect(result.trace.events.find(e => e.type === "tool_result" && e.data.name === "cancel_order").data.result)
   .toMatchObject({ status: "unavailable", error: { code: "turn_ir_unavailable" } });
  expect(result.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(result.conversationContext.caseState.pendingAction).toBeUndefined();
  expect(result.conversationContext.caseState.actionConfirmation).toBeUndefined();
  expect(result.proposedActions).toEqual([]); expect(result.actionExecutions).toEqual([]); expect(execute).not.toHaveBeenCalled();
 });
 it("independent recovery cannot apply resolution from the failed full TurnIR", async () => {
  const s = await session(); const first = await s.turn(halo, haloIR);
  const message = `Never mind Halo. ${nest}`;
  const result = await s.turn(message, { ...nestIR, readOnlyFollowup: { kind: "resolve", sourceText: "Never mind Halo.", subject: null,
   targetRequestId: first.conversationContext.caseState.pendingReadOnlyAnswers[0].id } });
  expect(result.trace.diagnostics.turn_ir_unavailable).toBe(true);
  expect(result.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(2);
 });
});

function careSource() {
 return [{ score: 1, evidenceSections: [{ content: "Do not machine wash or tumble dry. Professional dry cleaning is recommended.", heading: "Care", chunkIds: ["care"] }],
  record: { title: "Nest Felt Basket", knowledgeType: "product", authority: "reference", sourceKind: "knowledge_v2_release", sourceId: "nest-care",
   structuredData: { semantic_type: "GUIDANCE", support_domain: "care", applicability: { kind: "products", product_ids: ["nest"] } } } }];
}
it("successful rendered coverage closes recovered care when only an unrelated annotation failed", async () => {
 const s = await session(); s.deps.knowledge.search = async () => careSource();
 const ir = { actions: "malformed", answerRequests: [request(nest, "Nest felt basket", "washing machine")] };
 const r = await s.turn(nest, ir);
 expect(r.trace.diagnostics.turn_ir_unavailable).toBe(true);
 expect(r.response).toContain("Do not machine wash"); expect(r.response).toContain("Professional dry cleaning");
 expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
 expect(r.proposedActions).toEqual([]); expect(r.actionExecutions).toEqual([]);
});
it("a subject follow-up with supported evidence cannot erase recovered qualifier uncertainty", async () => {
 const s = await session(); await s.turn(nest, nestIR); s.deps.knowledge.search = async () => careSource();
 const message = "The Nest felt basket.";
 const r = await s.turn(message, { actions: [], readOnlyFollowup: { kind: "provide_subject", sourceText: message, subject: "Nest felt basket" } });
 const validation = r.trace.events.find(e => e.type === "final_response").data.validation;
 expect(validation.required_answer_coverage.obligations.find(o => o.id === "answer.0.cleaning_method").status).toBe("unknown");
 expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
 expect(r.conversationContext.caseState.pendingReadOnlyAnswers[0].unresolvedFacets).toEqual(["cleaning_method"]);
 expect(r.response).toContain("does not establish");
 expect(r.proposedActions).toEqual([]); expect(r.actionExecutions).toEqual([]);
});
it("valid recovered annotations remain attached to the right request after an invalid row is discarded", () => {
 const recovered = recovery({ actions: "bad", answerRequests: [
  { kind: "product_care", sourceText: "unquoted question", subject: "Halo", facets: ["cleaning_method"] },
  request(nest, "Nest felt basket", "invented"),
 ] });
 const c = prepareCaseContext(undefined, tenant);
 const result = prepareReadOnlyAnswers(c, null, nest, ["Nest felt basket"], recovered);
 expect(result.bindings).toHaveLength(1); expect(result.bindings[0].requestIndex).toBe(0);
 expect(c.caseState.pendingReadOnlyAnswers[0].unresolvedFacets).toEqual(["cleaning_method"]);
});

describe("PR125 valid qualifier reconciliation", () => {
 it("reconciles the repeated exact request to the original ID, then closes it on rendered support", async () => {
  const s = await session(); const first = await s.turn(nest, nestIR);
  const originalId = first.conversationContext.caseState.pendingReadOnlyAnswers[0].id;
  const valid = { actions: [], answerRequests: [request(nest, "Nest felt basket", "washing machine")] };
  const second = await s.turn(nest, valid);
  s.deps.knowledge.search = async () => careSource();
  const third = await s.turn(nest, valid);
  if (process.env.RECONCILIATION_EVIDENCE_FILE) fs.writeFileSync(process.env.RECONCILIATION_EVIDENCE_FILE,
   JSON.stringify({ originalId, turns: [first, second, third].map(r => ({ response: r.response,
    state: r.conversationContext.caseState, trace: r.trace })) }, null, 2));
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers[0]).toMatchObject({ id: originalId, verifiedProductId: "nest" });
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers[0].unresolvedFacets ?? []).toEqual([]);
  expect(third.response).toContain("Do not machine wash");
  expect(third.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
  expect(third.trace.events.some(e => e.data?.diagnostic === "read_only_answer_coverage" && e.data.closed.includes(originalId))).toBe(true);
 });
 it("does not leave an obsolete recovered entry when the valid repeat is immediately answerable", async () => {
  const s = await session(); const first = await s.turn(nest, nestIR);
  const originalId = first.conversationContext.caseState.pendingReadOnlyAnswers[0].id;
  s.deps.knowledge.search = async () => careSource();
  const second = await s.turn(nest, { actions: [], answerRequests: [request(nest, "Nest felt basket", "washing machine")] });
  expect(second.conversationContext.caseState.pendingReadOnlyAnswers).toEqual([]);
  expect(second.trace.events.some(e => e.data?.diagnostic === "read_only_answer_coverage" && e.data.closed.includes(originalId))).toBe(true);
 });
});

function repeatRecovered(c, { message = nest, value = "washing machine", facets, productId = "nest", valid = true } = {}) {
 c.turn++;
 const raw = { actions: [], answerRequests: [{ ...request(message, "Nest felt basket", value), ...(facets ? { facets } : {}) }] };
 const ir = valid ? normalizeTurnIR(raw, message) : null;
 const result = prepareReadOnlyAnswers(c, ir, message, ["Nest felt basket"], valid ? null : recovery({ ...raw, actions: "invalid" }, message));
 const bound = bindReadOnlyAnswer(c, result.bindings[0], { id: productId, title: "Nest Felt Basket" },
  valid ? { request: ir.answerRequests[0], message } : undefined);
 return { result, bound };
}
describe("reconciliation boundaries", () => {
 it("retains the original ID and coverage gate after reconciliation", () => {
  const { c, prepared } = registeredRecovery(); const originalId = prepared.bindings[0].id;
  const { result } = repeatRecovered(c);
  expect(result.bindings[0].id).toBe(originalId);
  const obligations = ["cleaning_method", "prohibited_method", "cleaning_alternative"].map(facet => ({
   id: `answer.0.${facet}`, status: "supported", subjectIds: ["nest"], satisfied: true, rendered: false }));
  expect(completeReadOnlyAnswers(c, result.bindings, { coverage: { obligations } })).toEqual([]);
  expect(completeReadOnlyAnswers(c, result.bindings, { coverage: { obligations: obligations.map(o => ({ ...o, rendered: true, subjectIds: ["wrong-product"] })) } })).toEqual([]);
  expect(c.caseState.pendingReadOnlyAnswers.map(r => r.id)).toEqual([originalId]);
 });
 it.each([
  { message: "Can I put the Nest felt basket in the dishwasher?", value: "dishwasher" },
  { facets: ["cleaning_method"] },
  { productId: "different-nest" },
  { value: null },
  { valid: false },
 ])("preserves uncertainty rather than guessing equivalence: %j", patch => {
  const { c, prepared } = registeredRecovery(); const id = prepared.bindings[0].id;
  repeatRecovered(c, patch);
  expect(c.caseState.pendingReadOnlyAnswers.find(r => r.id === id).unresolvedFacets).toEqual(["cleaning_method"]);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(2);
 });
 it("does not reconcile ambiguous recovered candidates", () => {
  const { c } = registeredRecovery();
  c.caseState.pendingReadOnlyAnswers.push({ ...structuredClone(c.caseState.pendingReadOnlyAnswers[0]), id: "another-recovered-candidate" });
  repeatRecovered(c);
  expect(c.caseState.pendingReadOnlyAnswers.filter(r => r.unresolvedFacets?.length)).toHaveLength(2);
 });
 it("never removes a previously valid qualifier or restriction", () => {
  const message = "Can I put the Nest felt basket in the washing machine and tumble dry it?";
  const raw = { actions: [], answerRequests: [{ ...request(message, "Nest felt basket", "invented qualifier"),
   qualifiers: [{ facet: "cleaning_method", value: "invented qualifier" }, { facet: "prohibited_method", value: "tumble dry" }] }] };
  const c = prepareCaseContext(undefined, tenant);
  const prepared = prepareReadOnlyAnswers(c, null, message, ["Nest felt basket"], recovery(raw, message));
  bindReadOnlyAnswer(c, prepared.bindings[0], { id: "nest", title: "Nest Felt Basket" });
  const id = prepared.bindings[0].id;
  repeatRecovered(c, { message });
  const old = c.caseState.pendingReadOnlyAnswers.find(r => r.id === id);
  expect(old.request.qualifiers).toEqual([{ facet: "prohibited_method", value: "tumble dry" }]);
  expect(old.unresolvedFacets).toEqual(["cleaning_method"]);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(2);
 });
 it("keeps every existing restriction when reconciliation is supported", () => {
  const message = "Can I put the Nest felt basket in the washing machine and tumble dry it?";
  const raw = { actions: [], answerRequests: [{ ...request(message, "Nest felt basket", "invented qualifier"),
   qualifiers: [{ facet: "cleaning_method", value: "invented qualifier" }, { facet: "prohibited_method", value: "tumble dry" }] }] };
  const c = prepareCaseContext(undefined, tenant);
  const prepared = prepareReadOnlyAnswers(c, null, message, ["Nest felt basket"], recovery(raw, message));
  bindReadOnlyAnswer(c, prepared.bindings[0], { id: "nest", title: "Nest Felt Basket" }); c.turn++;
  const valid = normalizeTurnIR({ actions: [], answerRequests: [{ ...request(message, "Nest felt basket", "washing machine"),
   qualifiers: [{ facet: "cleaning_method", value: "washing machine" }, { facet: "prohibited_method", value: "tumble dry" }] }] }, message);
  const result = prepareReadOnlyAnswers(c, valid, message, ["Nest felt basket"]);
  bindReadOnlyAnswer(c, result.bindings[0], { id: "nest", title: "Nest Felt Basket" }, { request: valid.answerRequests[0], message });
  expect(result.bindings[0].id).toBe(prepared.bindings[0].id);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(1);
  expect(c.caseState.pendingReadOnlyAnswers[0].request.qualifiers).toEqual(valid.answerRequests[0].qualifiers);
 });
 it("ambiguous current identity cannot repair an old verified obligation", async () => {
  const s = await session(); const first = await s.turn(nest, nestIR); const id = first.conversationContext.caseState.pendingReadOnlyAnswers[0].id;
  s.deps.commerce.getProduct = async () => ({ products: [{ id: "nest", title: "Nest Felt Basket" }, { id: "other", title: "Nest Felt Basket" }] });
  const r = await s.turn(nest, { actions: [], answerRequests: [request(nest, "Nest felt basket", "washing machine")] });
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers.find(p => p.id === id).unresolvedFacets).toEqual(["cleaning_method"]);
 });
 it("invalid later grounding cannot repair a recovered annotation", async () => {
  const s = await session(); const first = await s.turn(nest, nestIR); const id = first.conversationContext.caseState.pendingReadOnlyAnswers[0].id;
  const r = await s.turn(nest, { actions: [], answerRequests: [request(nest, "Nest felt basket", "60°C")] });
  expect(r.trace.diagnostics.turn_ir_unavailable).toBe(true);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers.find(p => p.id === id).unresolvedFacets).toEqual(["cleaning_method"]);
 });
});

it("a qualifier belonging to another current request cannot repair the Nest obligation", async () => {
 const s = await session(); const first = await s.turn(nest, nestIR); const id = first.conversationContext.caseState.pendingReadOnlyAnswers[0].id;
 const other = "Can I use bleach on the Halo ceramic vase?";
 const r = await s.turn(`${nest} ${other}`, { actions: [], answerRequests: [
  request(nest, "Nest felt basket", "bleach"), request(other, "Halo ceramic vase", "bleach"),
 ] });
 expect(r.trace.diagnostics.turn_ir_unavailable).toBe(true);
 expect(r.conversationContext.caseState.pendingReadOnlyAnswers.find(p => p.id === id).unresolvedFacets).toEqual(["cleaning_method"]);
 expect(r.proposedActions).toEqual([]); expect(r.actionExecutions).toEqual([]);
});
