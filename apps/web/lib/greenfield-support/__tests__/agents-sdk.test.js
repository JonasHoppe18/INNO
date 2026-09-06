import { describe, expect, it } from "vitest";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { PlaygroundDryRunExecutor } from "../action-executor";
import { createDemoDependencies } from "../demo-fixtures";

function structured(...segments) {
  return JSON.stringify({ segments });
}

describe("greenfield OpenAI Agents SDK runtime", () => {
  it("uses one model response for a pure acknowledgement", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(1);
    expect(result.response).toBe("You’re welcome.");
    expect(result.trace.events.filter((event) => event.type === "tool_call")).toHaveLength(0);
  });

  it("uses one SDK agent for the knowledge/tool continuation", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([functionCall("search_policy", { query: "return window" }, { callId: "sdk-policy" })]),
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "Returns are accepted within 30 days of delivery.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "What is your return window?",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(2);
    expect(model.firstCall.request.modelSettings.parallelToolCalls).toBe(false);
    expect(result.response).toContain("30 days");
    expect(result.proposedActions).toEqual([]);
    expect(result.trace.events.map((event) => event.type)).toContain("tool_result");
    expect(result.trace.events.at(-1).type).toBe("final_response");
  });

  it("keeps proposal-only actions unexecuted while the SDK continues", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "sdk-order" })]),
      modelResponse([functionCall("cancel_order", { order_id: "10232", reason: "Customer request" }, { callId: "sdk-cancel" })]),
      modelResponse([assistantMessage(structured({
        type: "action_offer",
        capability: "cancel_order",
        mode: "proposal",
        missing_arguments: [],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Please cancel order #10232.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions[0].action).toBe("cancel_order");
    expect(result.response).toContain("will not be completed");
    expect(result.trace.events.filter((event) => event.type === "tool_result")).toHaveLength(2);
  });

  it("runs one verified proposal through the Playground dry-run boundary", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order" })]),
      modelResponse([functionCall("cancel_order", { order_id: "10232", reason: "Customer changed their mind" }, { callId: "cancel" })]),
      modelResponse([assistantMessage(structured({
        type: "action_offer",
        capability: "cancel_order",
        mode: "proposal",
        missing_arguments: [],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Cancel order #10232.",
      model,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    expect(result.actionExecutions).toHaveLength(1);
    expect(result.actionExecutions[0]).toMatchObject({
      action: "cancel_order",
      mode: "dry_run",
      validation_status: "validated",
      execution_status: "dry_run_success",
      executed: false,
    });
    expect(result.trace.events.some((event) => event.type === "action_execution")).toBe(true);
    expect(result.response).toContain("will not be completed");
  });

  it("does not persist a simulated cancellation when the customer changes their mind", async () => {
    const dependencies = await createDemoDependencies();
    const firstModel = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order" })]),
      modelResponse([functionCall("cancel_order", { order_id: "10232", reason: "Customer changed their mind" }, { callId: "cancel" })]),
      modelResponse([assistantMessage(structured({ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }))]),
    ]);
    const first = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Cancel order #10232.",
      model: firstModel,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    const secondModel = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "correction" }))]),
    ]);
    const second = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Actually, don't cancel it.",
      history: [{ role: "user", content: "Cancel order #10232." }, { role: "assistant", content: first.response }],
      conversationContext: first.conversationContext,
      model: secondModel,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    expect(first.actionExecutions[0].executed).toBe(false);
    expect(second.actionExecutions).toEqual([]);
    expect(second.response).toBe("Thanks for clarifying.");
  });

  it("uses the latest refund proposal amount without executing either proposal", async () => {
    const dependencies = await createDemoDependencies();
    const firstModel = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order-1" })]),
      modelResponse([functionCall("create_refund", { order_id: "10232", amount: "500", reason: "Damaged item" }, { callId: "refund-1" })]),
      modelResponse([assistantMessage(structured({ type: "action_offer", capability: "create_refund", mode: "proposal", missing_arguments: [] }))]),
    ]);
    const first = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, message: "Refund 500 for order #10232.", model: firstModel, capabilities: dependencies, actionExecutor: new PlaygroundDryRunExecutor() });

    const secondModel = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order-2" })]),
      modelResponse([functionCall("create_refund", { order_id: "10232", amount: "300", reason: "Customer corrected the amount" }, { callId: "refund-2" })]),
      modelResponse([assistantMessage(structured({ type: "action_offer", capability: "create_refund", mode: "proposal", missing_arguments: [] }))]),
    ]);
    const second = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Actually make it 300.",
      history: [{ role: "user", content: "Refund 500 for order #10232." }, { role: "assistant", content: first.response }],
      conversationContext: first.conversationContext,
      model: secondModel,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    expect(first.actionExecutions[0].arguments.amount).toBe("500");
    expect(second.actionExecutions[0].arguments.amount).toBe("300");
    expect(first.actionExecutions[0].executed).toBe(false);
    expect(second.actionExecutions[0].executed).toBe(false);
  });
});
