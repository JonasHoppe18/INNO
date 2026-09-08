import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { SupabaseKnowledgeStore } from "../knowledge";

const RUN_REAL_EVAL = process.env.GREENFIELD_KNOWLEDGE_V1_AGENT_EVAL === "1";
const WORKSPACE_ID = process.env.GREENFIELD_DEV_WORKSPACE_ID || "48d4d494-b09c-49ba-920c-b9441204b87f";
const CASE_FILTER = process.env.GREENFIELD_KNOWLEDGE_V1_AGENT_EVAL_CASES
  ? new Set(process.env.GREENFIELD_KNOWLEDGE_V1_AGENT_EVAL_CASES.split(",").map((value) => Number(value)).filter(Number.isInteger))
  : null;

function loadEnvFile(path) {
  let source;
  try { source = readFileSync(path, "utf8"); } catch { return; }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const rawValue = match[2].trim();
    process.env[match[1]] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function unavailableCommerceProvider() {
  return {
    providerName: "unavailable_for_knowledge_v1_evaluation",
    async getOrder() { return null; },
    async getOrderHistory() { return []; },
    async getCustomer() { return null; },
    async getProduct() { return { status: "not_found", provider: "unavailable_for_knowledge_v1_evaluation" }; },
    async inspectFulfillment() { return { status: "not_found", provider: "unavailable_for_knowledge_v1_evaluation" }; },
  };
}

function summarize(run) {
  const knowledge = run.trace.events
    .filter((event) => event.type === "tool_result")
    .flatMap((event) => Array.isArray(event.data?.result?.data?.results) ? event.data.result.data.results : [])
    .slice(0, 3)
    .map((item) => ({
      title: item.title,
      type: item.knowledge_type,
      authority: item.authority,
      source_id: item.provenance?.source_id,
      task_key: item.structured_data?.procedure?.task?.key || null,
      score: item.score,
    }));
  return {
    response: run.response,
    tools: run.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data?.name),
    knowledge,
    errors: run.trace.events.filter((event) => event.type === "error").map((event) => event.data),
    validation: run.trace.events.find((event) => event.type === "final_response")?.data?.validation || null,
  };
}

describe.skipIf(!RUN_REAL_EVAL)("Greenfield Knowledge V1 one-agent DEV evaluation", () => {
  it("runs 14 focused Luna cases against real DEV knowledge", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    expect(process.env.OPENAI_API_KEY).toBeTruthy();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toContain("zxaoycxzdjrbnzvbullk");

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const knowledge = new SupabaseKnowledgeStore(supabase);
    const commerce = unavailableCommerceProvider();
    const tenant = { workspaceId: WORKSPACE_ID, customerEmail: null };
    const cases = [
      { id: "structured_factory_reset", message: "How do I factory reset my A-Spire Wireless headset?" },
      { id: "structured_dongle_pairing", message: "My A-Spire Wireless dongle will not connect to the headset. What should I try?" },
      { id: "structured_firmware", message: "How do I update the A-Spire Wireless headset and dongle firmware?" },
      { id: "structured_microphone", message: "My headset microphone is not picking up my voice. What should I check?" },
      { id: "structured_interference", message: "I am experiencing dongle interference on A-Spire Wireless." },
      { id: "structured_charging", message: "Can I keep using my A-Spire Wireless dongle while charging?" },
      { id: "ambiguous_same_product", message: "My A-Spire Wireless is not working. What should I do?" },
      { id: "cross_product_dongle", message: "The dongle for my A-Blaze is not connecting. What can I try?" },
      { id: "policy_returns", message: "Can I return my headset after opening the package?" },
      { id: "policy_warranty", message: "How long is the warranty in the EU?" },
      { id: "product_compatibility", message: "Is the A-Spire Wireless compatible with PlayStation 5?" },
      { id: "legacy_product", message: "What can I use A-Rise Bluetooth for, and is it suitable for gaming?" },
      { id: "brand_guidance", message: "What is AceZone focused on as a brand?" },
      { id: "multi_intent", message: "My A-Spire Wireless microphone is not working, and I also want to know whether the warranty covers a replacement." },
    ];

    const results = [];
    const selectedCases = CASE_FILTER ? cases.filter((_item, index) => CASE_FILTER.has(index + 1)) : cases;
    for (const item of selectedCases) {
      const run = await runGreenfieldAgentWithAgentsSdk({
        tenant,
        message: item.message,
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        capabilities: { tenant, knowledge, commerce },
        maxTurns: 8,
      });
      expect(run.response, item.id).toBeTruthy();
      results.push({ id: item.id, customer_message: item.message, ...summarize(run) });
    }

    const firstTurn = await runGreenfieldAgentWithAgentsSdk({
      tenant,
      message: "My A-Spire Wireless is not working. What should I do?",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      capabilities: { tenant, knowledge, commerce },
      maxTurns: 8,
    });
    const continuation = await runGreenfieldAgentWithAgentsSdk({
      tenant,
      history: [
        { role: "user", content: "My A-Spire Wireless is not working. What should I do?" },
        { role: "assistant", content: firstTurn.response },
      ],
      message: "It is specifically the microphone; nobody can hear me.",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      capabilities: { tenant, knowledge, commerce },
      maxTurns: 8,
    });
    expect(continuation.response).toBeTruthy();
    results.push({ id: "multi_turn_microphone_clarification", customer_message: continuation.trace.events.find((event) => event.type === "agent_started")?.data?.message, ...summarize(continuation) });

    console.log("GREENFIELD_KNOWLEDGE_V1_LUNA_MEDIUM_DEV_EVAL");
    console.log(JSON.stringify({
      model: "gpt-5.6-luna",
      reasoning: "medium",
      supabase: "sona-development",
      workspace: WORKSPACE_ID,
      architecture: "one Sona Support Agent + existing deterministic tools",
      case_count: results.length,
      results,
    }, null, 2));
  }, 900_000);
});
