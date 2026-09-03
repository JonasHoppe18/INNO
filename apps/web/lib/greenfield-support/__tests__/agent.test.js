import { describe, expect, it } from "vitest";
import { runGreenfieldAgent } from "../agent";
import { createDemoDependencies } from "../demo-fixtures";

function scriptedModel(responses) {
  return {
    complete: async () => {
      const response = responses.shift();
      if (!response) throw new Error("script exhausted");
      return response;
    },
  };
}

function toolCall(name, argumentsObject, callId = `call-${name}`) {
  return { type: "tool_call", toolCall: { name, callId, arguments: JSON.stringify(argumentsObject) } };
}

describe("greenfield model/tool loop", () => {
  it("completes a knowledge-only case and records provenance", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "What is your return window?",
      model: scriptedModel([
        toolCall("search_policy", { query: "return window" }),
        { type: "text", text: "Returns are accepted within 30 days of delivery." },
      ]),
      capabilities: dependencies,
    });

    expect(result.response).toContain("30 days");
    expect(result.proposedActions).toEqual([]);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "agent_started", "model_request", "model_response", "tool_call", "tool_result", "model_request", "model_response", "final_response",
    ]);
    const toolResult = result.trace.events.find((event) => event.type === "tool_result");
    expect(JSON.stringify(toolResult.data)).toContain("Merchant returns policy");
    expect(JSON.stringify(toolResult.data)).toContain("policy-returns-v1");
  });

  it("completes a live order + tracking case without using knowledge", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "Where is order #10231?",
      model: scriptedModel([
        toolCall("get_order", { order_id: "10231" }, "call-order"),
        toolCall("get_tracking", { tracking_number: "PC10231" }, "call-tracking"),
        { type: "text", text: "Order #10231 is in transit with ParcelCo. Track it with PC10231." },
      ]),
      capabilities: dependencies,
    });

    expect(result.response).toContain("in transit");
    const calls = result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name);
    expect(calls).toEqual(["get_order", "get_tracking"]);
    expect(JSON.stringify(result.trace.events)).toContain("PC10231");
  });

  it("keeps a sensitive request proposal-only and honest", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "Please cancel order #10232.",
      model: scriptedModel([
        toolCall("cancel_order", { order_id: "10232", reason: "Customer request" }),
        { type: "text", text: "I can prepare the cancellation request for order #10232." },
      ]),
      capabilities: dependencies,
    });

    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions[0].action).toBe("cancel_order");
    expect(result.response).toContain("not been completed");
    expect(result.response).not.toMatch(/order #10232 (?:was|has been) cancelled/i);
    expect(JSON.stringify(result.trace.events)).toContain('"status":"proposed"');
  });
});
