import { describe, expect, it } from "vitest";
import { ScriptedModel, assistantMessage, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { createDemoDependencies } from "../demo-fixtures";
function hit(content, domain = "product") {
  return { score: 1, evidenceSections: [{ content, heading: "Evidence boundary", chunkIds: ["c1"] }], record: {
    title: "Vale Shelf", knowledgeType: "product", authority: "guidance", sourceKind: "knowledge_v2_release", sourceId: "source1",
    structuredData: { semantic_type: "GUIDANCE", support_domain: domain, applicability: { kind: "products", product_ids: ["p1"] } }
  } };
}
describe("SDK precise read recovery without model tools", () => {
  it("uses a verified catalog alias when a full-title facet query has no answer", async () => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => ({ products: [{ id: "p1", title: "Vale Shelf", handle: "vale-shelf" }] });
    const reads = [];
    dependencies.knowledge.search = async request => { reads.push(request); return request.query.startsWith("vale-shelf:") ? [hit("Material: 100% wool.")] : []; };
    const message = "Is Vale Shelf all wool?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Vale Shelf", propertyKey: "composition" }] }) });
    model.assertComplete();
    expect(reads.map(read => read.query)).toEqual(["Vale Shelf: documented product material composition", "vale-shelf: documented product material composition Vale Shelf"]);
    expect(result.response).toContain("100% wool");
    expect(result.response).not.toContain("does not establish");
    expect(result.proposedActions).toEqual([]);
  });
  it.each(["How much weight can Vale Shelf hold?", "Hvor meget vægt kan Vale Shelf bære?"])("recovers omitted capacity for %s", async message => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => ({ status: "ok", products: [{ id: "p1", title: "Vale Shelf" }] });
    const reads = [];
    dependencies.knowledge.search = async request => { reads.push(request); return request.knowledgeTypes.includes("product") ? [hit("No approved maximum load rating is specified."), hit("For questions about load, contact the store before installation.", "assembly")] : []; };
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "acknowledgement", kind: "thanks" }] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      enableDevDiagnostics: true, turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["load_capacity"] }] }) });
    model.assertComplete();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(r => r.workspaceId === dependencies.tenant.workspaceId && r.trustedShopId === dependencies.tenant.shopId)).toBe(true);
    expect(result.response).toContain("No approved maximum load rating");
    expect(result.response).toContain("contact the store before installation");
    expect(result.proposedActions).toEqual([]);
    expect(result.actionExecutions).toEqual([]);
    expect(result.trace.events.filter(e => e.type === "tool_call" && !e.data.preloaded)).toHaveLength(0);
    expect(result.trace.diagnostics.fallback_reason).toBeNull();
  });
  it("bounded recovery reads the alternative omitted from the first retrieved result", async () => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => ({ status: "ok", products: [{ id: "p1", title: "Vale Shelf" }] });
    let reads = 0;
    dependencies.knowledge.search = async request => {
      if (!request.knowledgeTypes.includes("product")) return [];
      reads++;
      return reads === 1 ? [hit("Dishwasher safety is not established.")] : [hit("Clean with a soft damp cloth; avoid abrasive cleaners.")];
    };
    const message = "Can I wash Vale Shelf in a dishwasher?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_care", sourceText: message, subject: "Vale Shelf", facets: ["cleaning_method"] }] }) });
    model.assertComplete();
    expect(reads).toBe(2);
    expect(result.response).toContain("Dishwasher safety is not established");
    expect(result.response).toContain("soft damp cloth");
    expect(result.response).not.toContain("safely complete that lookup");
  });
});

describe("PR 104 SDK per-product reads", () => {
  it.each([false, true])("resolves both subjects before facet reads; unknown second=%s", async unknown => {
    const dependencies = await createDemoDependencies();
    const lookups = [], reads = [];
    dependencies.commerce.getProduct = async query => {
      lookups.push(query);
      if (query === "Luna Lamp" && unknown) return { products: [] };
      return { products: [{ id: query === "Vale Shelf" ? "p1" : "p2", title: query }] };
    };
    dependencies.knowledge.search = async request => {
      reads.push(request.query);
      const luna = request.query.startsWith("Luna Lamp:");
      const result = hit(luna ? "Certification: verified standard ABC." : "Maximum load capacity: 5 kg.");
      if (luna) {
        result.record.title = "Luna Lamp";
        result.record.sourceId = "luna-source";
        result.record.structuredData.applicability.product_ids = ["p2"];
      }
      return [result];
    };
    const message = "What is Vale Shelf's load capacity, and is Luna Lamp certified?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      enableDevDiagnostics: true, turnInterpreter: async () => ({ actions: [], answerRequests: [
        { kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["load_capacity"] },
        { kind: "product_property", sourceText: message, subject: "Luna Lamp", facets: ["certification"] },
      ] }) });
    model.assertComplete();
    expect(lookups).toEqual(["Vale Shelf", "Luna Lamp"]);
    expect(result.response).toContain("Vale Shelf: Maximum load capacity: 5 kg");
    if (unknown) {
      expect(reads.some(query => query.startsWith("Luna Lamp:"))).toBe(true);
      expect(result.response).toContain("Luna Lamp: Certification: verified standard ABC");
      expect(result.response).not.toContain("cannot verify this product's identity");
    } else {
      expect(reads.some(query => query.startsWith("Luna Lamp:"))).toBe(true);
      expect(result.response).toContain("Luna Lamp: Certification: verified standard ABC");
    }
    expect(result.proposedActions).toEqual([]);
    expect(result.actionExecutions).toEqual([]);
    expect(result.trace.diagnostics.fallback_reason).toBeNull();
  });
  it("keeps facet reads available for the second subject when the first exhausts its budget", async () => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async query => ({ products: [{ id: query === "Vale Shelf" ? "p1" : "p2", title: query, handle: query === "Vale Shelf" ? "vale-shelf" : "luna-lamp" }] });
    const reads = [];
    dependencies.knowledge.search = async request => {
      reads.push(request.query);
      if (!request.query.startsWith("Luna Lamp:")) return [];
      const result = hit("Certification: verified standard ABC.");
      result.record.title = "Luna Lamp"; result.record.sourceId = "luna-source";
      result.record.structuredData.applicability.product_ids = ["p2"];
      return [result];
    };
    const message = "Vale Shelf load, placement and electrical safety; Luna Lamp certification?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [
        { kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["load_capacity", "placement", "electrical_safety"] },
        { kind: "product_property", sourceText: message, subject: "Luna Lamp", facets: ["certification"] },
      ] }) });
    model.assertComplete();
    expect(reads.filter(query => /^(?:Vale Shelf|vale-shelf):/.test(query))).toHaveLength(5);
    expect(reads.some(query => query.startsWith("Luna Lamp:"))).toBe(true);
    expect(result.response).toContain("Luna Lamp: Certification: verified standard ABC");
    expect(result.response).not.toContain("Luna Lamp: I cannot verify the requested safety certification");
  });
  it.each([
    ["da", "Kan Vale Shelf bære den vægt?", "kan ikke bekræfte en godkendt bæreevne", "Bed butikken eller producenten"],
    ["en", "Can Vale Shelf hold that weight?", "cannot verify an approved load capacity", "Ask the store or manufacturer"],
  ])("normal locale handling renders %s limitations without model tools", async (_locale, message, limitation, handoff) => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => ({ products: [{ id: "p1", title: "Vale Shelf" }] });
    dependencies.knowledge.search = async () => [];
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["load_capacity"] }] }) });
    model.assertComplete();
    expect(result.response).toContain(limitation);
    expect(result.response).toContain(handoff);
  });
});

describe("second review SDK boundary", () => {
  it("verified branded catalog title drives scoped reads despite omitted prefix", async () => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => ({ products: [{ id: "p1", title: "Acme Vale Shelf" }] });
    const reads = [];
    dependencies.knowledge.search = async request => { reads.push(request.query); return [hit("Maximum load: 5 kg.")]; };
    const message = "What is Vale Shelf's maximum load?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["load_capacity"] }] }) });
    model.assertComplete();
    expect(reads[0]).toMatch(/^Acme Vale Shelf:/);
    expect(result.response).toContain("Maximum load: 5 kg");
    expect(result.proposedActions).toEqual([]);
    expect(result.actionExecutions).toEqual([]);
  });
  it("passes the requested certification qualifier into reads and fails closed on another certificate", async () => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => ({ products: [{ id: "p1", title: "Vale Shelf" }] });
    const reads = [];
    dependencies.knowledge.search = async request => { reads.push(request.query); return [hit("FSC certified.")]; };
    const message = "Is Vale Shelf UL certified?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["certification"], qualifiers: [{ facet: "certification", value: "UL" }] }] }) });
    model.assertComplete();
    expect(reads[0]).toContain("UL");
    expect(result.response).toContain("cannot verify the requested safety certification");
    expect(result.response).not.toContain("FSC certified");
    expect(result.proposedActions).toEqual([]);
  });
});

describe("SDK grounded independent static reads", () => {
  it.each(["not_found", "provider-error"])("recovers static knowledge after %s catalog without model tools", async mode => {
    const dependencies = await createDemoDependencies();
    dependencies.commerce.getProduct = async () => { if (mode === "provider-error") throw new Error("provider unavailable"); return { products: [] }; };
    const queries = [];
    dependencies.knowledge.search = async request => { queries.push(request.query); return [hit("Maximum load: 5 kg.")]; };
    const message = "How much can Vale Shelf hold?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Vale Shelf", facets: ["load_capacity"] }] }) });
    expect(queries.some(q => q.startsWith("Vale Shelf:"))).toBe(true);
    expect(result.response).toContain("Maximum load: 5 kg");
    expect(result.proposedActions).toEqual([]); expect(result.actionExecutions).toEqual([]);
    expect(result.response).not.toMatch(/in stock|available to buy|price is/i);
  });
  it("does not query an invented semantic product identifier", async () => {
    const dependencies = await createDemoDependencies();
    const lookups = [], queries = [];
    dependencies.commerce.getProduct = async q => { lookups.push(q); return { products: [{ id: "p1", title: "Vale Shelf" }] }; };
    dependencies.knowledge.search = async request => { queries.push(request.query); return [hit("Maximum load: 500 kg.")]; };
    const message = "How much can this shelf hold?";
    const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
      turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_property", sourceText: message, subject: "Shelf Vale", facets: ["load_capacity"] }] }) });
    expect(lookups).toEqual([]); expect(queries).toEqual([]);
    expect(result.response).not.toContain("500 kg");
  });
});
it("static-only recovery keeps the product label rather than the guide title", async () => {
  const dependencies = await createDemoDependencies();
  dependencies.commerce.getProduct = async () => ({ products: [] });
  const queries = [];
  dependencies.knowledge.search = async request => {
    queries.push(request.query);
    const item = hit(queries.length === 1 ? "Dishwasher safety is not established." : "Clean with a soft damp cloth.");
    item.record.title = "Product Care Guide / Vale Shelf";
    return [item];
  };
  const message = "Is Vale Shelf dishwasher safe?";
  const model = new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({ segments: [] }))])]);
  const result = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, capabilities: dependencies, message, model,
    turnInterpreter: async () => ({ actions: [], answerRequests: [{ kind: "product_care", sourceText: message, subject: "Vale Shelf", facets: ["cleaning_method"] }] }) });
  expect(queries.every(q => q.startsWith("Vale Shelf:"))).toBe(true);
  expect(result.response).toContain("soft damp cloth");
  expect(result.response).not.toContain("cannot verify this product's identity");
});

describe("final review subjectless SDK follow-ups", () => {
  it.each(["en","da"])("retains verified customer product for %s follow-up with no model tools", async locale => {
    const dependencies=await createDemoDependencies();const queries=[];
    dependencies.commerce.getProduct=async()=>({products:[{id:"p1",title:"Halo Vase"}]});
    dependencies.knowledge.search=async request=>{queries.push(request.query);const item=hit(request.query.includes("composition")?"Material: ceramic.":"Dishwasher safety is not established. Clean with a soft damp cloth.");item.record.title="Halo Vase";return[item];};
    const first="What material is the Halo Vase made of?";
    const run=(message,ir,conversationContext)=>runGreenfieldAgentWithAgentsSdk({...dependencies,capabilities:dependencies,message,conversationContext,model:new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]),turnInterpreter:async()=>({actions:[],answerRequests:[{kind:"product_property",sourceText:message,...ir}]})});
    const one=await run(first,{subject:"Halo Vase",propertyKey:"composition"});
    expect(one.conversationContext.customerProvided.product).toBe("Halo Vase");
    const message=locale==="da"?"Kan den komme i opvaskemaskinen?":"Can it go in the dishwasher?";
    const two=await run(message,{subject:null,facets:["cleaning_method"]},one.conversationContext);
    expect(queries.filter(q=>q.includes(":")).every(q=>q.startsWith("Halo Vase:"))).toBe(true);
    expect(two.response).toContain("soft damp cloth");expect(two.response).not.toContain("product's identity");
    expect(two.proposedActions).toEqual([]);expect(two.actionExecutions).toEqual([]);
  });
  it("retained context from another tenant cannot supply a subject",async()=>{
    const dependencies=await createDemoDependencies();const queries=[];dependencies.commerce.getProduct=async q=>{queries.push(q);return{products:[{id:"p1",title:"Halo Vase"}]}};
    const message="Can it go in the dishwasher?";
    const result=await runGreenfieldAgentWithAgentsSdk({...dependencies,capabilities:dependencies,message,conversationContext:{turn:1,customerProvided:{product:"Halo Vase"},caseState:{scope:{workspaceId:"other",shopId:dependencies.tenant.shopId,caseId:"foreign",customerEmail:null}}},model:new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]),turnInterpreter:async()=>({actions:[],answerRequests:[{kind:"product_care",sourceText:message,subject:null,facets:["cleaning_method"]}]})});
    expect(queries).toEqual([]);expect(result.response).not.toContain("Halo Vase");
  });
});
it("a product switch replaces retained focus rather than reading the earlier product",async()=>{
  const dependencies=await createDemoDependencies(),queries=[];
  dependencies.commerce.getProduct=async q=>{queries.push(q);return{products:[{id:q==="Luna Lamp"?"p2":"p1",title:q}]}};
  dependencies.knowledge.search=async request=>{queries.push(request.query);const item=hit("Clean with a soft damp cloth.");item.record.title="Luna Lamp";item.record.structuredData.applicability.product_ids=["p2"];return[item]};
  const message="Can Luna Lamp be cleaned?";
  const result=await runGreenfieldAgentWithAgentsSdk({...dependencies,capabilities:dependencies,message,conversationContext:{turn:1,customerProvided:{product:"Halo Vase"}},model:new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]),turnInterpreter:async()=>({actions:[],answerRequests:[{kind:"product_care",sourceText:message,subject:"Luna Lamp",facets:["cleaning_method"]}]})});
  expect(queries.every(q=>q.startsWith("Luna Lamp"))).toBe(true);expect(result.response).toContain("soft damp cloth");expect(result.conversationContext.customerProvided.product).toBe("Luna Lamp");
});
it("a compound retained reference does not trigger deterministic product reads",async()=>{
  const dependencies=await createDemoDependencies(),queries=[];
  dependencies.commerce.getProduct=async q=>{queries.push(q);return{products:[]}};
  const message="Can it be washed?";
  await runGreenfieldAgentWithAgentsSdk({...dependencies,capabilities:dependencies,message,conversationContext:{turn:1,customerProvided:{product:"Halo Vase and Luna Lamp"}},model:new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]),turnInterpreter:async()=>({actions:[],answerRequests:[{kind:"product_care",sourceText:message,subject:null,facets:["cleaning_method"]}]})});
  expect(queries).toEqual([]);
});
it("old history cannot revive an earlier product after the scoped focus switched",async()=>{
  const dependencies=await createDemoDependencies(),queries=[];
  dependencies.commerce.getProduct=async q=>{queries.push(q);return{products:[{id:"p2",title:"Luna Lamp"}]}};
  dependencies.knowledge.search=async()=>{const item=hit("Clean with a soft damp cloth.");item.record.title="Luna Lamp";item.record.structuredData.applicability.product_ids=["p2"];return[item]};
  const message="Can it be cleaned?";
  const result=await runGreenfieldAgentWithAgentsSdk({...dependencies,capabilities:dependencies,message,history:[{role:"user",content:"I own Halo Vase."}],conversationContext:{turn:2,customerProvided:{product:"Luna Lamp"}},model:new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]),turnInterpreter:async()=>({actions:[],answerRequests:[{kind:"product_care",sourceText:message,subject:null,facets:["cleaning_method"]}]})});
  expect(queries).toEqual(["Luna Lamp"]);expect(result.conversationContext.customerProvided.product).toBe("Luna Lamp");expect(result.response).toContain("soft damp cloth");
});
