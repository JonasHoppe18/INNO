import { describe, expect, it, vi } from "vitest";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { createDemoDependencies } from "../demo-fixtures";
import { createCapabilityRegistry } from "../capabilities";
import { InMemoryCommerceProvider } from "../providers";

const order = { id: "order-123", orderNumber: "123", status: "paid", fulfillmentStatus: "unfulfilled",
  items: [{ id: "line-a", title: "Item A", quantity: 1 }], fulfillments: [] };
const fact = { type: "fact", fact_kind: "order_fulfillment_status",
  evidence: [{ result_id: "tool_result_1", field_paths: ["data.fulfillmentStatus"] }] };
const answer = (...segments) => modelResponse([assistantMessage(JSON.stringify({ segments }))]);
const failures = [
  ["provider error", async () => { throw new Error("Provider failed; private-provider-detail"); }],
  ["timeout", async () => { throw new Error("Request timed out"); }],
  ["malformed output", async () => ({ actions: "invalid" })],
];
async function run(message, turnInterpreter, model) {
  const deps = await createDemoDependencies();
  const execute = vi.fn();
  const result = await runGreenfieldAgentWithAgentsSdk({ ...deps, message, model, turnInterpreter,
    capabilities: { ...deps, commerce: new InMemoryCommerceProvider({ orders: [order] }) },
    enableDevDiagnostics: true, actionExecutor: { execute } });
  model.assertComplete();
  expect(execute).not.toHaveBeenCalled();
  return result;
}

describe("technical TurnIR failure", () => {
  for (const [name, interpreter] of failures) {
    it(`${name}: preserves a safe read-only answer`, async () => {
      const result = await run("What is the status of order #123?", interpreter, new ScriptedModel([answer(fact)]));
      expect(result.trace.events).toContainEqual(expect.objectContaining({ type: "error", data: expect.objectContaining({ code: "turn_ir_unavailable" }) }));
      expect(result.trace.events.some(e => e.type === "error" && e.data.code === "agent_failed")).toBe(false);
      expect(result.trace.diagnostics).toMatchObject({ turn_ir_unavailable: true, fallback_reason: null });
      expect(result.response).not.toContain("couldn’t safely complete");
      expect(result.proposedActions).toEqual([]);
      expect(result.actionExecutions).toEqual([]);
      expect(JSON.stringify(result.trace)).not.toContain("private-provider-detail");
    });
    it(`${name}: rejects a model-created cancellation proposal`, async () => {
      const result = await run("Cancel order #123.", interpreter, new ScriptedModel([
        modelResponse([functionCall("cancel_order", { order_id: "123", reason: "Customer request" }, { callId: "cancel" })]),
        answer(fact, { type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }),
      ]));
      const tool = result.trace.events.find(e => e.type === "tool_result" && e.data.name === "cancel_order");
      expect(tool.data.result).toMatchObject({ status: "unavailable", error: { code: "turn_ir_unavailable" } });
      expect(result.trace.diagnostics.turn_ir_unavailable).toBe(true);
      expect(result.proposedActions).toEqual([]);
      expect(result.actionExecutions).toEqual([]);
      expect(result.trace.events.find(e => e.type === "final_response").data.validation.rejected_segments)
        .toContainEqual(expect.objectContaining({ type: "action_offer", issues: expect.arrayContaining([expect.objectContaining({ code: "action_not_proposed" })]) }));
    });
  }
  for (const action of ["cancel_order", "update_address", "create_return", "create_refund", "send_replacement"]) {
    it(`blocks ${action} before argument parsing or provider access`, async () => {
      const deps = await createDemoDependencies();
      const getOrder = vi.fn();
      const registry = createCapabilityRegistry({ ...deps, proposalActionsBlocked: true, commerce: { ...deps.commerce, getOrder } });
      expect(await registry.execute(action, "malformed arguments")).toMatchObject({ status: "unavailable", error: { code: "turn_ir_unavailable" } });
      expect(getOrder).not.toHaveBeenCalled();
    });
  }
  it("preserves successful empty TurnIR as a distinct state", async () => {
    const result = await run("What is the status of order #123?", async () => ({ actions: [] }), new ScriptedModel([answer(fact)]));
    expect(result.trace.diagnostics).toMatchObject({ turn_ir_unavailable: false, fallback_reason: null });
    expect(result.trace.events.some(e => e.type === "error")).toBe(false);
  });
});
