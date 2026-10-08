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
    expect(reads.map(read => read.query)).toEqual(["Vale Shelf: documented product material composition", "vale-shelf: documented product material composition"]);
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
