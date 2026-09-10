import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { createDemoDependencies } from "../demo-fixtures";

const RUN_BENCHMARK = process.env.GREENFIELD_TOOL_SELECTION_BENCHMARK === "1";

const CASES = [
  { id: "troubleshooting_reset", request: "How do I reset my Orion Wireless headset?", expected: "procedural" },
  { id: "troubleshooting_pairing", request: "My Orion Wireless USB receiver will not pair. What steps should I try?", expected: "procedural" },
  { id: "troubleshooting_damage", request: "What information should support collect for a damaged item?", expected: "procedural" },
  { id: "troubleshooting_cancellation", request: "How should support handle a cancellation before fulfillment?", expected: "procedural" },
  { id: "troubleshooting_setup", request: "Walk me through setting up and pairing the headset receiver.", expected: "procedural" },
  { id: "troubleshooting_connection", request: "My wireless headset is not connecting. What should I do step by step?", expected: "procedural" },
  { id: "troubleshooting_microphone", request: "My headset microphone is not working. What troubleshooting steps should I follow?", expected: "procedural" },
  { id: "troubleshooting_broken_return", request: "What procedure should I follow when a product arrives damaged and the customer wants a return?", expected: "procedural" },
  { id: "product_compatibility", request: "Is the Orion Wireless compatible with a USB-C adapter?", expected: "product" },
  { id: "product_battery", request: "What battery life does the Orion Wireless headset have?", expected: "product" },
  { id: "product_materials", request: "What materials and features does the Orion Wireless headset have?", expected: "product" },
  { id: "product_ear_pads", request: "Are the Orion replacement ear pads compatible with Orion Wired?", expected: "product" },
  { id: "policy_returns", request: "How many days do I have to return an unused item?", expected: "policy" },
  { id: "policy_refund_timing", request: "How long does a refund take after an eligible return is approved?", expected: "policy" },
  { id: "policy_warranty", request: "What is the warranty period for a manufacturing defect?", expected: "policy" },
  { id: "policy_shipping", request: "How long does it normally take for an order to leave the warehouse?", expected: "policy" },
  { id: "brand_warmth", request: "How should Sona write a warm and direct support reply?", expected: "brand" },
  { id: "brand_tone", request: "What tone and structure should a customer service response use?", expected: "brand" },
  { id: "ambiguous_broken_headset", request: "My Orion Wireless is broken. What can you help me with?", expected: "ambiguous: procedural or policy" },
  { id: "ambiguous_headset_help", request: "I need help with my headset.", expected: "ambiguous: clarify" },
];

function loadEnvFile(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const rawValue = match[2].trim();
    process.env[match[1]] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function toolSequence(trace) {
  return trace.events
    .filter((event) => event.type === "tool_call")
    .map((event) => event.data?.name)
    .filter(Boolean);
}

describe("generic knowledge tool-selection benchmark", () => {
  const test = RUN_BENCHMARK ? it : it.skip;

  test("measures the unchanged request set through one agent", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    const dependencies = await createDemoDependencies();
    const results = [];
    for (const item of CASES) {
      const run = await runGreenfieldAgentWithAgentsSdk({
        ...dependencies,
        message: item.request,
        model: process.env.OPENAI_MODEL ?? "gpt-5.2",
        capabilities: dependencies,
        maxTurns: 3,
      });
      const tools = toolSequence(run.trace);
      results.push({
        id: item.id,
        customer_request: item.request,
        expected_knowledge_class: item.expected,
        tools_selected: tools,
        first_tool: tools[0] ?? null,
        final_response: run.response,
      });
    }

    console.log("GREENFIELD_TOOL_SELECTION_BENCHMARK");
    console.log(JSON.stringify({ benchmark_version: "knowledge_tool_discoverability_v1", cases: results }, null, 2));
  }, 900_000);
});
