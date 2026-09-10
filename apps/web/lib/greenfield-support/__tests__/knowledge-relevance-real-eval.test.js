import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { SupabaseKnowledgeStore } from "../knowledge";

const WORKSPACE_ID = "48d4d494-b09c-49ba-920c-b9441204b87f";
const ARTIFACT_PATH = "/tmp/greenfield-knowledge-relevance-after.json";

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
    providerName: "unavailable_for_knowledge_relevance_eval",
    async getOrder() { return null; },
    async getOrderHistory() { return []; },
    async getCustomer() { return null; },
    async getProduct(query) { return { status: "not_found", query }; },
    async getProductAvailability(query) { return { status: "not_found", query }; },
    async inspectFulfillment(orderId) { return { status: "not_found", order_id: orderId }; },
  };
}

function knowledgeTrace(run) {
  return run.trace.events
    .filter((event) => event.type === "tool_call" || event.type === "tool_result")
    .map((event) => {
      const data = event.data ?? {};
      if (event.type === "tool_call") return { type: event.type, name: data.name, arguments: data.arguments };
      const result = data.result ?? {};
      const results = Array.isArray(result.data?.results) ? result.data.results : null;
      if (!results) return { type: event.type, name: data.name, status: result.status, error: result.error ?? null };
      return {
        type: event.type,
        name: data.name,
        status: result.status,
        task_specificity: result.data?.task_specificity ?? null,
        results: results.map((item) => ({
          title: item.title,
          source_id: item.provenance?.source_id ?? null,
          knowledge_type: item.knowledge_type,
          authority: item.authority,
          score: item.score,
          task_relevance_score: item.task_relevance_score ?? null,
          rank: item.rank,
          evidence_sections: item.evidence_sections,
        })),
      };
    });
}

function caseResult(definition, run, turn = 1) {
  const trace = knowledgeTrace(run);
  const candidates = trace.filter((event) => event.type === "tool_result").flatMap((event) => event.results ?? []);
  return {
    id: definition.id,
    group: definition.group,
    turn,
    customer_input: definition.message,
    product_context: definition.productContext ?? null,
    candidates,
    selected_records: candidates.slice(0, 1),
    evidence_sections: candidates.flatMap((candidate) => candidate.evidence_sections ?? []),
    tool_trace: trace,
    final_response: run.response,
    trace_id: run.trace.traceId,
    conversation_context: run.conversationContext,
  };
}

const SINGLE_CASES = [
  { id: "same_product_dongle", group: "same_product_competing", message: "My A-Spire Wireless USB dongle will not reconnect after I unplugged it. How do I pair it again?", productContext: "A-Spire Wireless" },
  { id: "same_product_pairing", group: "same_product_competing", message: "How do I pair the A-Blaze headset and USB dongle?", productContext: "A-Blaze" },
  { id: "same_product_reset", group: "same_product_competing", message: "How do I factory reset the A-Spire Wireless headset?", productContext: "A-Spire Wireless" },
  { id: "same_product_firmware", group: "same_product_competing", message: "How do I update the A-Spire Wireless headset and dongle firmware?", productContext: "A-Spire Wireless" },
  { id: "different_product_wireless_reset", group: "different_product_same_task", message: "How do I factory reset the A-Spire Wireless headset?", productContext: "A-Spire Wireless" },
  { id: "different_product_blaze_reset", group: "different_product_same_task", message: "How do I factory reset the A-Blaze headset?", productContext: "A-Blaze" },
  { id: "different_product_wired_reset", group: "different_product_same_task", message: "How do I factory reset the wired A-Spire headset?", productContext: "A-Spire" },
  { id: "global_product_compatibility", group: "global_plus_product", message: "Is the A-Blaze compatible with PlayStation 5?", productContext: "A-Blaze" },
  { id: "global_product_use_case", group: "global_plus_product", message: "Can I use the A-Rise wirelessly for competitive gaming?", productContext: "A-Rise" },
  { id: "normal_warranty", group: "normal", message: "How long is the warranty in the EU?", productContext: null },
  { id: "normal_return", group: "normal", message: "Can I return my headset after opening the package?", productContext: null },
  { id: "normal_microphone", group: "normal", message: "My headset microphone is not working. What troubleshooting steps should I follow?", productContext: null },
];

const MULTI_TURN_CASES = [
  { id: "ambiguous_then_pairing", group: "ambiguous_clarified", turns: ["My USB dongle does not work.", "It will not pair with the headset."] },
  { id: "ambiguous_then_reset", group: "ambiguous_clarified", turns: ["My headset has a problem.", "It is the A-Spire Wireless and I need to factory reset it."] },
  { id: "ambiguous_then_blaze_pairing", group: "ambiguous_clarified", turns: ["The headset will not connect.", "It is the A-Blaze and the dongle will not pair."] },
];

describe("greenfield knowledge relevance GPT-5.2 DEV evaluation", () => {
  it("runs 15 read-only one-agent workflows against existing DEV knowledge", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeTruthy();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const knowledge = new SupabaseKnowledgeStore(supabase);
    const commerce = unavailableCommerceProvider();
    const results = [];

    for (const definition of SINGLE_CASES) {
      const run = await runGreenfieldAgentWithAgentsSdk({
        tenant: { workspaceId: WORKSPACE_ID, customerEmail: null },
        message: definition.message,
        model: "gpt-5.2",
        capabilities: { tenant: { workspaceId: WORKSPACE_ID, customerEmail: null }, knowledge, commerce },
        maxTurns: 8,
      });
      results.push(caseResult(definition, run));
    }

    for (const definition of MULTI_TURN_CASES) {
      const history = [];
      let conversationContext;
      for (let index = 0; index < definition.turns.length; index += 1) {
        const message = definition.turns[index];
        const run = await runGreenfieldAgentWithAgentsSdk({
          tenant: { workspaceId: WORKSPACE_ID, customerEmail: null },
          message,
          history,
          conversationContext,
          model: "gpt-5.2",
          capabilities: { tenant: { workspaceId: WORKSPACE_ID, customerEmail: null }, knowledge, commerce },
          maxTurns: 8,
        });
        results.push(caseResult({ ...definition, message }, run, index + 1));
        history.push({ role: "user", content: message }, { role: "assistant", content: run.response });
        conversationContext = run.conversationContext;
      }
    }

    const artifact = {
      benchmark: {
        model: "gpt-5.2",
        workspace: "Sona Development",
        workflow_count: 15,
        read_only: true,
        knowledge_source: "existing DEV Supabase greenfield knowledge",
        commerce_source: "unavailable; no Shopify or other operational calls in this benchmark",
      },
      results,
    };
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log("GREENFIELD_KNOWLEDGE_RELEVANCE_AFTER", JSON.stringify({
      artifact_path: ARTIFACT_PATH,
      model: artifact.benchmark.model,
      workflow_count: artifact.benchmark.workflow_count,
      results: results.map((result) => ({
        id: result.id,
        turn: result.turn,
        group: result.group,
        candidates: result.candidates.map((candidate) => ({ title: candidate.title, source_id: candidate.source_id, score: candidate.score, task_relevance_score: candidate.task_relevance_score, task_specificity: result.tool_trace.find((event) => event.type === "tool_result")?.task_specificity ?? null })),
        final_response: result.final_response,
      })),
    }, null, 2));
  }, 1_800_000);
});
