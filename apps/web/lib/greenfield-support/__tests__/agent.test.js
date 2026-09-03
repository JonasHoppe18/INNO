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

function structured(...segments) {
  return { type: "text", text: JSON.stringify({ segments }) };
}

describe("greenfield model/tool loop", () => {
  it("completes a knowledge-only case and records provenance", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "What is your return window?",
      model: scriptedModel([
        toolCall("search_policy", { query: "return window" }),
        structured({
          type: "knowledge_guidance",
          text: "Returns are accepted within 30 days of delivery.",
          basis: { result_id: "tool_result_1", field_paths: ["results"] },
        }),
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
        structured(
          { type: "fact", fact_kind: "order_fulfillment_status", evidence: [{ result_id: "tool_result_1", field_paths: ["fulfillmentStatus"] }] },
          { type: "fact", fact_kind: "shipment_status", evidence: [{ result_id: "tool_result_2", field_paths: ["live_tracking.status"] }] },
        ),
      ]),
      capabilities: dependencies,
    });

    expect(result.response).toContain("in_transit");
    const calls = result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name);
    expect(calls).toEqual(["get_order", "get_tracking"]);
    expect(JSON.stringify(result.trace.events)).toContain("PC10231");
    expect(JSON.stringify(result.trace.events)).toContain("verified_order_number");
  });

  it("can ask for clarification after an unresolved order without receiving history candidates", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "Where is my order #9999?",
      model: scriptedModel([
        toolCall("get_order", { order_id: "9999" }, "call-missing-order"),
        toolCall("get_order_history", {}, "call-history"),
        structured(
          { type: "limitation", text: "I could not find order #9999.", basis: { result_id: "tool_result_1", field_paths: [] } },
          { type: "question", purpose: "enable_capability", text: "Please confirm the order number or the email used at checkout.", capability: "get_order", missing_arguments: ["order_id"] },
        ),
      ]),
      capabilities: dependencies,
    });

    expect(result.response).toContain("Please provide order ID");
    const historyResult = result.trace.events.find((event) => event.type === "tool_result" && event.data.name === "get_order_history");
    expect(historyResult.data.result.data).toMatchObject({ candidate_only: true, has_order_history: true });
    expect(historyResult.data.result.data).not.toHaveProperty("orders");
    expect(JSON.stringify(historyResult.data.result.data)).not.toContain("10231");
  });

  it("keeps full history available when the customer asks for a latest order without an order reference", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "Where is my latest order?",
      model: scriptedModel([
        toolCall("get_order_history", {}, "call-latest-history"),
        structured({
          type: "fact",
          fact_kind: "order_reference",
          evidence: [{ result_id: "tool_result_1", field_paths: ["orders[0].orderNumber"] }],
        }),
      ]),
      capabilities: dependencies,
    });

    expect(result.response).toContain("#10231");
    const historyResult = result.trace.events.find((event) => event.type === "tool_result" && event.data.name === "get_order_history");
    expect(historyResult.data.result.data.orders).toHaveLength(4);
    expect(historyResult.data.result.data.candidate_only).toBeUndefined();
  });

  it("keeps a sensitive request proposal-only and honest", async () => {
    const dependencies = await createDemoDependencies();
    const result = await runGreenfieldAgent({
      ...dependencies,
      message: "Please cancel order #10232.",
      model: scriptedModel([
        toolCall("cancel_order", { order_id: "10232", reason: "Customer request" }),
        structured({
          type: "action_offer",
          capability: "cancel_order",
          mode: "proposal",
          missing_arguments: [],
        }),
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
