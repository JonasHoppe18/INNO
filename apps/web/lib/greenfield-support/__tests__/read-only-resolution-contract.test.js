import { describe, it, expect, vi } from "vitest";
import { Agent, Runner, OpenAIResponsesModel } from "@openai/agents";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { createDemoDependencies } from "../demo-fixtures";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { TurnIRSchema, normalizeTurnIR } from "../turn-ir";
import { prepareCaseContext, prepareReadOnlyAnswers } from "../case-state";
// Synthetic frozen requests also run without the private diagnostic artifacts.
const tenant = { workspaceId: "w", shopId: "s", caseId: "c" };
const haloQuestion = "Is the Halo ceramic vase dishwasher safe?";
const nestQuestion = "Can I put the Nest felt basket in the washing machine?";
const a = "Never mind the Halo dishwasher question.";
const b = `${a} I still need an answer about washing the Nest basket.`;
function context() {
 const c = prepareCaseContext(undefined, tenant);
 c.caseState.pendingReadOnlyAnswers = [
  { id: "halo-request", request: { kind: "product_care", sourceText: haloQuestion, subject: "Halo Ceramic Vase", facets: ["cleaning_method", "prohibited_method"], qualifiers: [{ facet: "cleaning_method", value: "dishwasher safe" },{ facet: "prohibited_method", value: "dishwasher" }] }, subjectRequirement: "verification", verifiedProductId: "halo" },
  { id: "nest-request", request: { kind: "product_care", sourceText: nestQuestion, subject: "Nest Felt Basket", facets: ["cleaning_method", "prohibited_method"], qualifiers: [{ facet: "cleaning_method", value: "washing machine" }] }, subjectRequirement: "verification", verifiedProductId: "nest" },
 ]; return c;
}
function resolution(c, message=a, target="halo-request", quote=message) {
 const ir=normalizeTurnIR({ actions: [], readOnlyFollowup: { kind:"resolve", subject:null, sourceText:quote, targetRequestId:target } },message);
 return prepareReadOnlyAnswers(c,ir,message,[]);
}
describe("strict read-only follow-up variants",()=>{
 it.each(["resolve","new_request"])("schema rejects non-null subject for %s",kind=>{
  expect(TurnIRSchema.safeParse({ actions: [], readOnlyFollowup:{kind,subject:"Halo",sourceText:a,targetRequestId:null} }).success).toBe(false);
 });
 it.each(["provide_subject","new_request"])("schema rejects target ID on %s",kind=>{
  expect(TurnIRSchema.safeParse({ actions: [], readOnlyFollowup:{kind,subject:null,sourceText:a,targetRequestId:"halo-request"} }).success).toBe(false);
 });
 it("rejects ungrounded provide_subject while allowing a current grounded subject",()=>{
  expect(()=>normalizeTurnIR({actions:[],readOnlyFollowup:{kind:"provide_subject",subject:"Invented Product",sourceText:"The Halo ceramic vase."}},"The Halo ceramic vase.")).toThrow();
  expect(normalizeTurnIR({actions:[],readOnlyFollowup:{kind:"provide_subject",subject:"Halo ceramic vase",sourceText:"The Halo ceramic vase."}},"The Halo ceramic vase.").readOnlyFollowup.subject).toBe("Halo ceramic vase");
 });
});
describe("independently grounded selected care resolution",()=>{
 it.each([a,b])("closes only Halo for %s",message=>{
  const c=context();expect(resolution(c,message,"halo-request",a).closed).toEqual(["halo-request"]);
  expect(c.caseState.pendingReadOnlyAnswers.map(q=>q.id)).toEqual(["nest-request"]);
 });
 it("rejects the other existing verified target ID",()=>{
  const c=context();expect(resolution(c,a,"nest-request").closed).toEqual([]);
  expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(2);
 });
 it("rejects a target inferred from the continuation that still needs help",()=>{
  const c=context();expect(resolution(c,b,"nest-request",a).closed).toEqual([]);
 });
 it.each([null,"nonexistent-request"])("preserves pending work with target %s",target=>{
  const c=context();expect(resolution(c,a,target).closed).toEqual([]);expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(2);
 });
 it.each(["Never mind that question.","Never mind the Halo question.","Never mind the dishwasher question.","Never mind the Atlas dishwasher question."])("preserves work without independent scope: %s",message=>{
  const c=context();expect(resolution(c,message).closed).toEqual([]);expect(c.caseState.pendingReadOnlyAnswers).toHaveLength(2);
 });
 it("a single pending entry still needs grounded resolution scope",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers=c.caseState.pendingReadOnlyAnswers.slice(0,1);
  expect(resolution(c,"Never mind.").closed).toEqual([]);
 });
 it("rejects a broad resolution quote naming both care requests",()=>{
  const c=context();const message="Never mind the Halo dishwasher and Nest washing machine questions.";
  expect(resolution(c,message).closed).toEqual([]);
 });
 it("uses existing Danish method grounding without a Danish resolution phrase list",()=>{
  const c=context();expect(resolution(c,"Glem spørgsmålet om Halo og opvaskemaskinen.").closed).toEqual(["halo-request"]);
 });
 it("generic prefix identity cannot distinguish two verified product IDs",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[1].request={...c.caseState.pendingReadOnlyAnswers[0].request};
  expect(resolution(c).closed).toEqual([]);
 });
 it("requires a verified product identity on the selected obligation",()=>{
  const c=context();delete c.caseState.pendingReadOnlyAnswers[0].verifiedProductId;
  expect(resolution(c).closed).toEqual([]);
 });
 it("cannot discard another qualifier within the same atomic care request",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[0].request.qualifiers.push({facet:"prohibited_method",value:"bleach"});
  expect(resolution(c).closed).toEqual([]);
 });
 it("failed full TurnIR leaves both obligations unchanged",()=>{
  const c=context();const before=structuredClone(c.caseState.pendingReadOnlyAnswers);
  expect(prepareReadOnlyAnswers(c,null,a,[]).closed).toEqual([]);expect(c.caseState.pendingReadOnlyAnswers).toEqual(before);
 });
});


describe("resolution identity and atomic facet boundaries",()=>{
 it("does not borrow a care method from another product in a broad quote",()=>{
  const c=context();expect(resolution(c,b,"halo-request",b).closed).toEqual([]);
 });
 it("short shared product prefix remains ambiguous",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[1].request={...c.caseState.pendingReadOnlyAnswers[0].request,subject:"Halo Glass Vase",sourceText:"Is the Halo glass vase dishwasher safe?"};
  expect(resolution(c,a).closed).toEqual([]);
 });
 it("an explicit distinguishing verified name allows the correct target",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[1].request={...c.caseState.pendingReadOnlyAnswers[0].request,subject:"Halo Glass Vase",sourceText:"Is the Halo glass vase dishwasher safe?"};
  expect(resolution(c,"Never mind the Halo ceramic vase dishwasher question.").closed).toEqual(["halo-request"]);
 });
 it("preserves a customer-grounded alias when the verified title has a brand prefix",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[0].request.subject="Acme Halo Ceramic Vase";
  expect(resolution(c).closed).toEqual(["halo-request"]);
 });
 it("an unverified competing identity cannot be ignored",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[1].request={...c.caseState.pendingReadOnlyAnswers[0].request};
  delete c.caseState.pendingReadOnlyAnswers[1].verifiedProductId;
  expect(resolution(c).closed).toEqual([]);
 });
 it("two care requests for the same verified product remain distinct",()=>{
  const c=context();const other=c.caseState.pendingReadOnlyAnswers[1];
  other.verifiedProductId="halo";other.request={...c.caseState.pendingReadOnlyAnswers[0].request,sourceText:"Can I use bleach on the Halo ceramic vase?",qualifiers:[{facet:"prohibited_method",value:"bleach"}]};
  expect(resolution(c,a,"nest-request").closed).toEqual([]);
  expect(resolution(c).closed).toEqual(["halo-request"]);
  expect(c.caseState.pendingReadOnlyAnswers.map(q=>q.id)).toEqual(["nest-request"]);
 });
 it("identical atomic method scope on the same product cannot pick an arbitrary pending ID",()=>{
  const c=context();c.caseState.pendingReadOnlyAnswers[1].request={...c.caseState.pendingReadOnlyAnswers[0].request};c.caseState.pendingReadOnlyAnswers[1].verifiedProductId="halo";
  expect(resolution(c).closed).toEqual([]);
 });
 it.each(["workspaceId","shopId","caseId"])("cannot resolve old IDs in a different %s",field=>{
  const c=prepareCaseContext(context(),{...tenant,[field]:"different"});expect(resolution(c).closed).toEqual([]);
 });
 it("sourceText must be an actual current customer quote",()=>{
  expect(()=>resolution(context(),"Thanks.","halo-request",a)).toThrow();
 });
 it("a failed follow-up variant cannot authorize a model-created cancellation",async()=>{
  const deps=await createDemoDependencies();deps.tenant.caseId="c";
  const previous=context();previous.caseState.scope={workspaceId:deps.tenant.workspaceId,shopId:deps.tenant.shopId,caseId:"c",customerEmail:deps.tenant.customerEmail};
  const model=new ScriptedModel([
   modelResponse([functionCall("cancel_order",{order_id:"10232",reason:"Customer request"},{callId:"cancel"})]),
   modelResponse([assistantMessage(JSON.stringify({segments:[{type:"action_offer",capability:"cancel_order",mode:"proposal",missing_arguments:[]}]}))]),
  ]);const execute=vi.fn();const message=`${a} Cancel order #10232.`;
  const r=await runGreenfieldAgentWithAgentsSdk({...deps,capabilities:deps,model,message,conversationContext:previous,enableDevDiagnostics:true,actionExecutor:{execute},
   turnInterpreter:async()=>({actions:[{action:"cancel_order",sourceText:"Cancel order #10232.",orderReference:"10232",addressProvided:false}],
    readOnlyFollowup:{kind:"resolve",subject:"Halo",sourceText:a,targetRequestId:"halo-request"}})});
  model.assertComplete();expect(r.trace.diagnostics.turn_ir_unavailable).toBe(true);
  expect(r.conversationContext.caseState.pendingReadOnlyAnswers).toHaveLength(2);
  expect(r.proposedActions).toEqual([]);expect(r.actionExecutions).toEqual([]);expect(execute).not.toHaveBeenCalled();
  expect(r.trace.events.find(e=>e.type==="tool_result"&&e.data.name==="cancel_order").data.result.error.code).toBe("turn_ir_unavailable");
 });
});


it("the installed SDK can serialize the follow-up schema before an offline model transport",async()=>{
 const stop=new Error("offline transport boundary");const create=vi.fn(()=>{throw stop;});
 const model=new OpenAIResponsesModel({responses:{create}},"offline-schema-preflight");
 const agent=new Agent({name:"read-only schema preflight",model,outputType:TurnIRSchema,tools:[]});
 await expect(new Runner({tracingDisabled:true}).run(agent,"Schema preflight",{maxTurns:1})).rejects.toBe(stop);
 expect(create).toHaveBeenCalledTimes(1);
 expect(create.mock.calls[0][0].text.format.schema.properties.readOnlyFollowup).toBeDefined();
});
it("provide_subject cannot borrow its product from a different current clause",()=>{
 const message="The Halo ceramic vase. I also own a Nest felt basket.";
 expect(()=>normalizeTurnIR({actions:[],readOnlyFollowup:{kind:"provide_subject",subject:"Nest felt basket",sourceText:"The Halo ceramic vase."}},message)).toThrow();
});
