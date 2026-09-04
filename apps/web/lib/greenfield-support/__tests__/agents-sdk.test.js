import { describe, expect, it } from "vitest";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
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
    expect(result.trace.events.filter((event) => event.type === "tool_result")).toHaveLength(1);
  });
});
