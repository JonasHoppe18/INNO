import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { SupabaseKnowledgeStore } from "../knowledge";

const WORKSPACE_ID = "48d4d494-b09c-49ba-920c-b9441204b87f";
const RUN_REAL_EVAL = process.env.GREENFIELD_REAL_DEV_EVAL === "1";
const RUN_DIRECT_RETRIEVAL = process.env.GREENFIELD_REAL_DEV_RETRIEVAL_ONLY === "1";
const COMPACT_TRACE = process.env.GREENFIELD_REAL_DEV_EVAL_COMPACT === "1";
const TOP_EVIDENCE_ONLY = process.env.GREENFIELD_REAL_DEV_EVAL_TOP_EVIDENCE_ONLY === "1";
const CASE_FILTER = process.env.GREENFIELD_REAL_DEV_EVAL_CASES
  ? new Set(process.env.GREENFIELD_REAL_DEV_EVAL_CASES.split(",").map((value) => Number(value)).filter(Number.isInteger))
  : null;

const SUPPORTED_CASES = [
  "Can I return my headset after opening the package",
  "How long is the warranty in the EU",
  "When will my order arrive",
  "Is the A-Blaze compatible with PlayStation 5",
  "Can I use the A-Rise wirelessly for competitive gaming",
  "What should I do if my headset is broken",
  "What is AceZone focused on",
];

const UNSUPPORTED_CASES = [
  "Does AceZone ship to Japan?",
  "Can I return an A-Blaze after 90 days?",
  "Does A-Spire Wireless support PlayStation 6?",
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

function unavailableCommerceProvider() {
  return {
    providerName: "unavailable_for_greenfield_evaluation",
    async getOrder() {
      return null;
    },
    async getOrderHistory() {
      return [];
    },
    async getCustomer() {
      return null;
    },
    async getProduct() {
      return { status: "not_found", provider: "unavailable_for_greenfield_evaluation" };
    },
    async getTracking() {
      return [];
    },
    async inspectFulfillment() {
      return { status: "not_found", provider: "unavailable_for_greenfield_evaluation" };
    },
  };
}

function safeTrace(trace) {
  return trace.events
    .filter((event) => (COMPACT_TRACE
      ? ["tool_call", "tool_result", "final_response", "error"].includes(event.type)
      : ["agent_started", "tool_call", "tool_result", "model_response", "final_response", "error"].includes(event.type)))
    .map((event) => {
      if (event.type !== "tool_result") return event;
      const data = event.data;
      const result = data?.result;
      const knowledgeResults = result?.data?.results;
      if (!Array.isArray(knowledgeResults)) return event;
      return {
        ...event,
        data: {
          ...data,
          result: {
            ...result,
            data: {
              ...result.data,
              results: knowledgeResults.map((item) => ({
                title: item.title,
                knowledge_type: item.knowledge_type,
                authority: item.authority,
                score: item.score,
                rank: item.rank,
                match_reason: item.match_reason,
                evidence_sections: TOP_EVIDENCE_ONLY && Array.isArray(item.evidence_sections) && item !== knowledgeResults[0]
                  ? item.evidence_sections.map(({ heading, chunk_ids }) => ({ heading, chunk_ids }))
                  : item.evidence_sections,
                provenance: item.provenance,
                structured_data: item.structured_data,
              })),
            },
          },
        },
      };
    });
}

describe("greenfield real DEV agent evaluation", () => {
  const test = RUN_REAL_EVAL ? it : it.skip;
  const directTest = RUN_DIRECT_RETRIEVAL ? it : it.skip;

  directTest("reports direct DEV semantic retrieval without running the agent", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const knowledge = new SupabaseKnowledgeStore(supabase);
    const queries = [
      { customer_input: SUPPORTED_CASES[0], knowledgeTypes: ["policy"] },
      { customer_input: SUPPORTED_CASES[1], knowledgeTypes: ["policy"] },
      { customer_input: SUPPORTED_CASES[2], knowledgeTypes: ["procedural"] },
      { customer_input: SUPPORTED_CASES[3], knowledgeTypes: ["product"] },
      { customer_input: SUPPORTED_CASES[4], knowledgeTypes: ["product"] },
      { customer_input: SUPPORTED_CASES[5], knowledgeTypes: ["procedural"] },
      { customer_input: SUPPORTED_CASES[6], knowledgeTypes: ["brand"] },
      { customer_input: UNSUPPORTED_CASES[0], knowledgeTypes: ["policy"] },
      { customer_input: UNSUPPORTED_CASES[2], knowledgeTypes: ["product"] },
    ];
    const results = [];
    for (const item of queries) {
      const hits = await knowledge.search({
        workspaceId: WORKSPACE_ID,
        query: item.customer_input,
        knowledgeTypes: item.knowledgeTypes,
        limit: 5,
      });
      results.push({
        customer_input: item.customer_input,
        results: hits.map(({ record, score, rank, evidenceSections }) => ({
          title: record.title,
          authority: record.authority,
          score: Number(score.toFixed(4)),
          rank,
          provenance: { source_kind: record.sourceKind, source_id: record.sourceId },
          evidence_sections: evidenceSections,
        })),
      });
    }
    console.log("GREENFIELD_DIRECT_DEV_RETRIEVAL");
    console.log(JSON.stringify(results, null, 2));
  }, 180_000);

  test("runs the fixed 7 supported and 3 unsupported cases through one agent", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    expect(supabaseUrl).toBeTruthy();
    expect(serviceRoleKey).toBeTruthy();
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const knowledge = new SupabaseKnowledgeStore(supabase);
    const commerce = unavailableCommerceProvider();
    const allCases = [
      ...SUPPORTED_CASES.map((message) => ({ message, supportedByCorpus: true })),
      ...UNSUPPORTED_CASES.map((message) => ({ message, supportedByCorpus: false })),
    ];
    const cases = CASE_FILTER ? allCases.filter((_item, index) => CASE_FILTER.has(index + 1)) : allCases;

    const results = [];
    for (const item of cases) {
      const run = await runGreenfieldAgentWithAgentsSdk({
        tenant: { workspaceId: WORKSPACE_ID, customerEmail: null },
        message: item.message,
        capabilities: {
          tenant: { workspaceId: WORKSPACE_ID, customerEmail: null },
          knowledge,
          commerce,
        },
        maxTurns: 8,
      });
      results.push({
        customer_input: item.message,
        supported_by_corpus: item.supportedByCorpus,
        data_sources: {
          knowledge: "DEV Supabase greenfield knowledge",
          commerce: "unavailable; Shopify was not connected or called",
        },
        final_response: run.response,
        proposed_actions: run.proposedActions,
        trace_id: run.trace.traceId,
        agent_trace: safeTrace(run.trace),
      });
    }

    console.log("GREENFIELD_REAL_DEV_AGENT_EVAL");
    console.log(JSON.stringify(results, null, 2));
  }, 180_000);
});
