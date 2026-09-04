import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { cleanRawContent, SupabaseKnowledgeStore } from "../knowledge";

const DEV_PROJECT_REF = "zxaoycxzdjrbnzvbullk";
const WORKSPACE_ID = "48d4d494-b09c-49ba-920c-b9441204b87f";
const FAQ_URL = "https://www.acezone.io/pages/faq";
const RUN_REAL_EVAL = process.env.GREENFIELD_MERCHANT_TROUBLESHOOTING_REAL_EVAL === "1";

const PROCEDURE_SELECTIONS = [
  {
    id: "a-spire-wireless-dongle-connection",
    question: "3. My dongle for A-Spire Wireless is not connecting",
    productModels: ["A-Spire Wireless"],
  },
  {
    id: "a-blaze-dongle-connection",
    question: "3. My dongle for A-Blaze is not connecting",
    productModels: ["A-Blaze"],
  },
  {
    id: "a-spire-wireless-factory-reset",
    question: "9. How do I factory reset the A-Spire Wireless headset?",
    productModels: ["A-Spire Wireless"],
  },
  {
    id: "a-blaze-factory-reset",
    question: "9. How do I factory reset the A-Blaze headset?",
    productModels: ["A-Blaze"],
  },
  {
    id: "a-spire-factory-reset",
    question: "5. How do I factory reset the A-Spire headset?",
    productModels: ["A-Spire"],
  },
  {
    id: "a-spire-wireless-firmware-update",
    question: "10. How do I update the firmware on the A-Spire Wireless headset?",
    productModels: ["A-Spire Wireless"],
  },
  {
    id: "generic-microphone-troubleshooting",
    question: "3. Why does my microphone not work?",
    productModels: [],
  },
  {
    id: "a-spire-wireless-dongle-interference",
    question: "4. I am experiencing dongle interference on A-Spire Wireless",
    productModels: ["A-Spire Wireless"],
  },
  {
    id: "a-spire-wireless-charging",
    question: "7. Can I charge while using the A-Spire Wireless dongle for audio?",
    productModels: ["A-Spire Wireless"],
  },
];

const RETRIEVAL_CASES = [
  {
    id: "direct_match",
    query: "My A-Spire Wireless USB dongle will not reconnect after I unplugged it.",
    expectedSourceId: "merchant-authored-a-spire-wireless-dongle-connection",
  },
  {
    id: "product_collision",
    query: "The A-Blaze dongle and headset no longer connect. What should I try?",
    expectedSourceId: "merchant-authored-a-blaze-dongle-connection",
  },
  {
    id: "ambiguous_product",
    query: "My USB dongle and headset will not connect. What should I do?",
    expectedSourceId: null,
  },
  {
    id: "unsupported_issue",
    query: "My A-Spire Wireless headband hinge is cracked. What button sequence repairs it?",
    expectedSourceId: null,
  },
  {
    id: "multi_step",
    query: "How do I factory reset my A-Spire Wireless and pair the dongle again?",
    expectedSourceId: "merchant-authored-a-spire-wireless-factory-reset",
  },
];

const AGENT_CASES = [
  {
    id: "direct_dongle",
    message: "My A-Spire Wireless USB dongle will not reconnect after I unplugged it. How do I pair it again?",
    knownProduct: "A-Spire Wireless",
  },
  {
    id: "paraphrased_blaze_dongle",
    message: "The wireless adapter on my A-Blaze no longer finds the headset. What can I try?",
    knownProduct: "A-Blaze",
  },
  {
    id: "wireless_factory_reset",
    message: "I need to reset my A-Spire Wireless to factory settings. What are the steps and what happens to saved Bluetooth devices?",
    knownProduct: "A-Spire Wireless",
  },
  {
    id: "wired_factory_reset",
    message: "How do I factory reset my wired A-Spire headset?",
    knownProduct: "A-Spire",
  },
  {
    id: "firmware_update",
    message: "How do I update the headset and dongle firmware on my A-Spire Wireless?",
    knownProduct: "A-Spire Wireless",
  },
  {
    id: "generic_microphone",
    message: "My headset microphone is not picking up my voice. What should I check?",
    knownProduct: null,
  },
  {
    id: "ambiguous_dongle",
    message: "My USB dongle and headset will not connect. What should I do?",
    knownProduct: null,
  },
  {
    id: "unsupported_hardware_repair",
    message: "My A-Spire Wireless headband hinge is cracked. What button sequence repairs it?",
    knownProduct: "A-Spire Wireless",
  },
  {
    id: "charging",
    message: "Can I keep using my A-Spire Wireless dongle while charging?",
    knownProduct: "A-Spire Wireless",
  },
  {
    id: "already_tried_first_steps",
    message: "I already disconnected the A-Spire Wireless dongle from the PC and powered on the headset, but it still will not reconnect. What should I try next?",
    knownProduct: "A-Spire Wireless",
  },
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

function faqEntries(html) {
  const pattern = /<button[^>]*>([\s\S]*?)<\/button>[\s\S]*?<div class="Collapsible__Content">\s*<div class="Rte">([\s\S]*?)<\/div>/gi;
  return Array.from(html.matchAll(pattern), (match) => ({
    question: cleanRawContent(match[1]).replace(/\s+/g, " ").trim(),
    answer: cleanRawContent(match[2]),
  })).filter((entry) => entry.question && entry.answer);
}

function selectedSources(entries, observedAt) {
  return PROCEDURE_SELECTIONS.map((selection) => {
    const entry = entries.find((candidate) => candidate.question === selection.question);
    if (!entry) throw new Error(`Raw FAQ procedure was not found: ${selection.question}`);
    return {
      sourceKind: "merchant_authored",
      sourceId: `merchant-authored-${selection.id}`,
      title: `AceZone procedure: ${entry.question}`,
      content: `${entry.question}\n\n${entry.answer}`,
      sourceUri: FAQ_URL,
      sourceLabel: `AceZone FAQ — ${entry.question}`,
      knowledgeType: "procedural",
      authority: "authoritative",
      observedAt,
      metadata: {
        status: "published",
        authored_by: "merchant",
        origin: "public_web",
        source_page: "faq",
        content_format: "html_cleaned_by_greenfield",
        applies_to: { product_models: selection.productModels },
      },
    };
  });
}

function unavailableCommerceProvider() {
  return {
    providerName: "unavailable_for_troubleshooting_evaluation",
    async getOrder() { return null; },
    async getOrderHistory() { return []; },
    async getCustomer() { return null; },
    async getProduct() { return { status: "not_found", provider: "unavailable_for_troubleshooting_evaluation" }; },
    async inspectFulfillment() { return { status: "not_found", provider: "unavailable_for_troubleshooting_evaluation" }; },
  };
}

function summarizeHit(hit) {
  return {
    title: hit.record.title,
    source_kind: hit.record.sourceKind,
    source_id: hit.record.sourceId,
    knowledge_type: hit.record.knowledgeType,
    authority: hit.record.authority,
    score: Number(hit.score.toFixed(6)),
    rank: hit.rank ?? null,
    match_reason: hit.matchReason,
    provenance: {
      source_uri: hit.record.sourceUri,
      source_label: hit.record.sourceLabel,
      observed_at: hit.record.observedAt,
    },
    applicability: hit.record.metadata.applies_to ?? null,
    evidence_sections: hit.evidenceSections ?? [],
  };
}

function summarizeToolResults(trace) {
  return trace.events
    .filter((event) => event.type === "tool_call" || event.type === "tool_result")
    .map((event) => {
      const data = event.data ?? {};
      if (event.type === "tool_call") return { type: event.type, name: data.name, arguments: data.arguments };
      const result = data.result ?? {};
      const results = result.data?.results;
      return {
        type: event.type,
        name: data.name,
        status: result.status,
        error: result.error ?? null,
        knowledge_results: Array.isArray(results) ? results.map((item) => ({
          title: item.title,
          source_kind: item.provenance?.source_kind,
          source_id: item.provenance?.source_id,
          knowledge_type: item.knowledge_type,
          authority: item.authority,
          score: item.score,
          rank: item.rank,
          match_reason: item.match_reason,
          provenance: item.provenance,
          applicability: item.structured_data?.applies_to ?? item.provenance?.metadata?.applies_to ?? null,
          evidence_sections: item.evidence_sections,
        })) : null,
      };
    });
}

function summarizeAgentCase(item, run) {
  const finalEvent = run.trace.events.find((event) => event.type === "final_response");
  const knowledgeResults = run.trace.events
    .filter((event) => event.type === "tool_result")
    .flatMap((event) => Array.isArray(event.data?.result?.data?.results) ? event.data.result.data.results : [])
    .map((result) => ({
      title: result.title,
      source_id: result.provenance?.source_id,
      authority: result.authority,
      score: result.score,
      provenance: result.provenance,
      applicability: result.structured_data?.applies_to ?? result.provenance?.metadata?.applies_to ?? null,
      evidence_sections: result.evidence_sections,
    }));
  return {
    id: item.id,
    customer_message: item.message,
    known_product: item.knownProduct,
    retrieval_results: knowledgeResults,
    selected_sources: knowledgeResults.slice(0, 1),
    tools_called: summarizeToolResults(run.trace),
    exact_evidence_exposed_to_agent: knowledgeResults.flatMap((result) => result.evidence_sections ?? []),
    raw_structured_response: finalEvent?.data?.structured_response ?? null,
    exact_final_response: run.response,
  };
}

describe("merchant-authored troubleshooting experiment", () => {
  const test = RUN_REAL_EVAL ? it : it.skip;

  test("ingests raw merchant procedures, measures retrieval, and runs one-agent evaluation", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    expect(supabaseUrl).toBeTruthy();
    expect(new URL(supabaseUrl).hostname).toBe(`${DEV_PROJECT_REF}.supabase.co`);
    expect(serviceRoleKey).toBeTruthy();
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    const response = await fetch(FAQ_URL);
    expect(response.ok).toBe(true);
    const rawHtml = await response.text();
    const entries = faqEntries(rawHtml);
    expect(entries.length).toBeGreaterThan(20);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const knowledge = new SupabaseKnowledgeStore(supabase);
    const observedAt = new Date().toISOString();
    const sources = selectedSources(entries, observedAt);
    const ingested = [];
    for (const source of sources) {
      ingested.push(await knowledge.replaceSource(WORKSPACE_ID, source.sourceId, source));
    }

    const retrieval = [];
    for (const item of RETRIEVAL_CASES) {
      const hits = await knowledge.search({ workspaceId: WORKSPACE_ID, query: item.query, knowledgeTypes: ["procedural"], limit: 5 });
      retrieval.push({
        id: item.id,
        query: item.query,
        expected_source_id: item.expectedSourceId,
        results: hits.map(summarizeHit),
      });
    }

    const commerce = unavailableCommerceProvider();
    const agentCases = [];
    for (const item of AGENT_CASES) {
      const tenant = { workspaceId: WORKSPACE_ID, customerEmail: null };
      const run = await runGreenfieldAgentWithAgentsSdk({
        tenant,
        message: item.message,
        model: process.env.OPENAI_MODEL ?? "gpt-5.2",
        capabilities: { tenant, knowledge, commerce },
        maxTurns: 8,
      });
      agentCases.push(summarizeAgentCase(item, run));
    }

    const { data: counts, error: countError } = await supabase
      .from("greenfield_knowledge_records")
      .select("knowledge_type,authority,source_kind", { count: "exact", head: false })
      .eq("workspace_id", WORKSPACE_ID)
      .eq("source_kind", "merchant_authored");
    if (countError) throw new Error(countError.message);

    console.log("GREENFIELD_MERCHANT_AUTHORED_TROUBLESHOOTING_EVAL");
    console.log(JSON.stringify({
      source: {
        supabase: "DEV",
        project_ref: DEV_PROJECT_REF,
        workspace: "Sona Development",
        raw_source: FAQ_URL,
        raw_source_is_v2_v3: false,
        agent_runtime: "one @openai/agents Sona Support Agent",
      },
      corpus: {
        selected_count: ingested.length,
        source_kind: "merchant_authored",
        knowledge_type: "procedural",
        authority: "authoritative",
        records: ingested.map((record) => ({
          title: record.title,
          source_id: record.sourceId,
          content_hash: record.contentHash,
          chunk_count: record.chunks.length,
          metadata: record.metadata,
        })),
        dev_record_count: counts?.length ?? 0,
      },
      retrieval,
      agent_cases: agentCases,
    }, null, 2));
  }, 600_000);
});
