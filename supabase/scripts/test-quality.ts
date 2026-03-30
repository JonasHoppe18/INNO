#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * Sona AI — Quality Check Test Script
 *
 * Henter de seneste 20 tickets fra Acezone workspace og kører dem
 * igennem reply-generator for at evaluere quality_check output.
 *
 * Kør fra project root:
 *   deno run --allow-net --allow-env --allow-read supabase/scripts/test-quality.ts
 *
 * Loader automatisk env vars fra (i prioriteret rækkefølge):
 *   1. apps/web/.env.local
 *   2. .env.local
 *   3. .env
 *
 * Optionelt: Angiv shop domain direkte for at undgå DB-opslag
 *   ACEZONE_SHOP_DOMAIN=acezone.myshopify.com
 *   ACEZONE_SHOP_ID=<uuid>   (bruges i stedet for domain-opslag)
 */

// ─── Trin 1: Load env FØR alle andre imports ─────────────────────────────────
// Deno evaluerer module-level konstanter (fx OPENAI_API_KEY) ved import-tid.
// Dotenv SKAL loades her med top-level await, inden de andre moduler importeres.
import { load } from "jsr:@std/dotenv@0.225.3";

for (const envFile of ["apps/web/.env.local", ".env.local", ".env"]) {
  try {
    const vars = await load({ envPath: envFile, export: true });
    if (Object.keys(vars).length > 0) {
      console.log(`  → Loader env fra ${envFile} (${Object.keys(vars).length} variabler)\n`);
      break;
    }
  } catch {
    // fil findes ikke — prøv næste
  }
}

// ─── Trin 2: Dynamiske imports (EFTER env er loaded) ─────────────────────────
// reply-generator.ts fanger OPENAI_API_KEY som module-level konstant —
// dynamisk import sikrer at nøglen er sat inden modulet evalueres.
import type { GenerateReplyResult } from "../functions/_shared/reply-generator.ts";
import type { ActionDecisionValidation } from "../functions/_shared/action-validator.ts";

const { createClient } = await import("jsr:@supabase/supabase-js@2");
const { assessCase } = await import("../functions/_shared/case-assessment.ts");
const { buildReplyStrategy } = await import("../functions/_shared/reply-strategy.ts");
const { generateReplyFromStrategy } = await import("../functions/_shared/reply-generator.ts");
const { fetchPersona, fetchPolicies, fetchRelevantKnowledge } = await import(
  "../functions/_shared/agent-context.ts"
);

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY");
const TICKET_LIMIT = Number(Deno.env.get("TICKET_LIMIT") ?? "20");
const ACEZONE_SHOP_ID = Deno.env.get("ACEZONE_SHOP_ID");
const ACEZONE_SHOP_DOMAIN = Deno.env.get("ACEZONE_SHOP_DOMAIN") ?? "acezone";

if (!SUPABASE_URL) throw new Error("Mangler SUPABASE_URL — tjek apps/web/.env.local");
if (!SERVICE_ROLE_KEY) throw new Error("Mangler SUPABASE_SERVICE_ROLE_KEY — tjek apps/web/.env.local");
if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("Mangler OPENAI_API_KEY — tjek apps/web/.env.local");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketResult = {
  ticketId: string;
  subject: string;
  primaryIntent: string;
  replyPreview: string;
  quality_check: GenerateReplyResult["quality_check"];
  error?: string;
  durationMs: number;
};

// ─── Hjælpere ─────────────────────────────────────────────────────────────────

function truncate(text: string, length = 100): string {
  return text.length <= length ? text : text.slice(0, length) + "…";
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

function red(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function checkMark(val: boolean): string {
  return val ? green("✓") : red("✗");
}

// ─── Opslag: Acezone shop ─────────────────────────────────────────────────────

async function resolveAcezoneShop(): Promise<{
  shopId: string;
  ownerId: string;
  workspaceId: string | null;
}> {
  if (ACEZONE_SHOP_ID) {
    const { data, error } = await supabase
      .from("shops")
      .select("id, owner_user_id, workspace_id")
      .eq("id", ACEZONE_SHOP_ID)
      .single();
    if (error || !data) throw new Error(`Kunne ikke finde shop med id=${ACEZONE_SHOP_ID}: ${error?.message}`);
    return { shopId: data.id, ownerId: data.owner_user_id, workspaceId: data.workspace_id };
  }

  // Søg først via shop_domain
  const { data: domainMatch } = await supabase
    .from("shops")
    .select("id, owner_user_id, workspace_id, shop_domain")
    .ilike("shop_domain", `%${ACEZONE_SHOP_DOMAIN}%`)
    .limit(1)
    .maybeSingle();

  if (domainMatch) {
    console.log(`  → Fandt shop via domain: ${bold(domainMatch.shop_domain)} (id: ${domainMatch.id})`);
    return { shopId: domainMatch.id, ownerId: domainMatch.owner_user_id, workspaceId: domainMatch.workspace_id ?? null };
  }

  // Søg via workspaces.name (join)
  const { data: workspaceMatch } = await supabase
    .from("shops")
    .select("id, owner_user_id, workspace_id, shop_domain, workspaces!inner(name)")
    .ilike("workspaces.name", `%${ACEZONE_SHOP_DOMAIN}%`)
    .limit(1)
    .maybeSingle();

  if (workspaceMatch) {
    const wsName = (workspaceMatch as { workspaces?: { name?: string } }).workspaces?.name ?? workspaceMatch.shop_domain;
    console.log(`  → Fandt shop via workspace: ${bold(wsName)} (id: ${workspaceMatch.id})`);
    return { shopId: workspaceMatch.id, ownerId: workspaceMatch.owner_user_id, workspaceId: workspaceMatch.workspace_id ?? null };
  }

  // Intet match — list alle shops så bruger kan vælge
  const { data: allShops } = await supabase
    .from("shops")
    .select("id, shop_domain, workspace_id")
    .order("created_at", { ascending: false })
    .limit(10);

  const list = (allShops ?? [])
    .map((s) => `  • ${s.shop_domain}  →  ACEZONE_SHOP_ID=${s.id}`)
    .join("\n");

  throw new Error(
    `Ingen shop matcher "${ACEZONE_SHOP_DOMAIN}".\n\n` +
    `Tilgængelige shops:\n${list || "  (ingen shops fundet)"}\n\n` +
    `Sæt ACEZONE_SHOP_ID=<uuid> eller ACEZONE_SHOP_DOMAIN=<del-af-domain>`,
  );
}

// ─── Hent 20 nyeste inbound-threads ──────────────────────────────────────────

async function fetchRecentThreads(
  workspaceId: string | null,
  ownerId: string,
): Promise<Array<{ threadId: string; subject: string; workspaceId: string | null }>> {
  const query = supabase
    .from("mail_threads")
    .select("id, subject, workspace_id")
    .order("last_message_at", { ascending: false })
    .limit(TICKET_LIMIT);

  if (workspaceId) {
    query.eq("workspace_id", workspaceId);
  } else {
    query.eq("user_id", ownerId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Kunne ikke hente threads: ${error.message}`);
  return (data ?? []).map((t) => ({
    threadId: t.id,
    subject: t.subject ?? "(intet emne)",
    workspaceId: t.workspace_id,
  }));
}

// ─── Hent seneste inbound-besked for en thread ────────────────────────────────

async function fetchLatestInboundMessage(
  threadId: string,
): Promise<{ subject: string; body: string; fromEmail: string } | null> {
  const { data, error } = await supabase
    .from("mail_messages")
    .select("subject, body_text, clean_body_text, from_email")
    .eq("thread_id", threadId)
    .eq("from_me", false)
    .eq("is_draft", false)
    .order("received_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return {
    subject: data.subject ?? "",
    body: data.clean_body_text || data.body_text || "",
    fromEmail: data.from_email ?? "",
  };
}

// ─── Kør pipeline for ét ticket ───────────────────────────────────────────────

async function runPipelineForTicket(
  thread: { threadId: string; subject: string },
  shopId: string,
  ownerId: string,
  workspaceId: string | null,
): Promise<TicketResult> {
  const start = Date.now();

  const msg = await fetchLatestInboundMessage(thread.threadId);
  if (!msg) {
    return {
      ticketId: thread.threadId,
      subject: thread.subject,
      primaryIntent: "ingen_besked",
      replyPreview: "(ingen inbound besked fundet)",
      quality_check: null,
      error: "no_inbound_message",
      durationMs: Date.now() - start,
    };
  }

  const fullMessage = `${msg.subject}\n\n${msg.body}`.trim();

  // Case assessment (sync)
  const assessment = assessCase({
    subject: msg.subject,
    body: msg.body,
  });

  // Hent persona + policies (paralleliseret)
  const [persona, policies, knowledgeMatches] = await Promise.all([
    fetchPersona(supabase, ownerId),
    fetchPolicies(supabase, ownerId, workspaceId),
    fetchRelevantKnowledge(supabase, shopId, msg.body, 4),
  ]);

  const policySummary = [
    policies.policy_refund ? `Refund policy: ${policies.policy_refund}` : "",
    policies.policy_shipping ? `Shipping policy: ${policies.policy_shipping}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const knowledgeSummary = knowledgeMatches
    .map((m) => m.content)
    .join("\n\n")
    .slice(0, 2000);

  // Minimal ActionDecisionValidation (reply only — ingen Shopify/action-decision kald)
  const validation: ActionDecisionValidation = {
    version: 1,
    allowed_actions: [],
    removed_actions: [],
    approval_actions: [],
    decision: "reply_only",
    summary: "Test run — ingen actions",
  };

  // Reply strategy
  const replyStrategy = buildReplyStrategy({
    assessment,
    validation,
    selectedOrder: null,
  });

  // Generer svar og fang quality_check
  const result = await generateReplyFromStrategy({
    customerMessage: fullMessage,
    replyStrategy,
    executionState: "no_action",
    factSummary: "",
    policySummary,
    generalKnowledgeSummary: knowledgeSummary,
    personaInstructions: persona.instructions || undefined,
  });

  return {
    ticketId: thread.threadId,
    subject: thread.subject,
    primaryIntent: assessment.primary_case_type,
    replyPreview: result?.reply ?? "(intet svar genereret)",
    quality_check: result?.quality_check ?? null,
    durationMs: Date.now() - start,
  };
}

// ─── Skriv resultater til konsol ─────────────────────────────────────────────

function printResult(i: number, r: TicketResult): void {
  const qc = r.quality_check;
  const status = qc?.ready_to_send === true
    ? green("READY")
    : qc?.ready_to_send === false
    ? red("NOT READY")
    : yellow("N/A");

  console.log(`\n${bold(`[${i + 1}]`)} ${truncate(r.subject, 60)}`);
  console.log(`    ID:      ${r.ticketId}`);
  console.log(`    Intent:  ${bold(r.primaryIntent)}`);
  console.log(`    Status:  ${status}  (${r.durationMs}ms)`);

  if (r.error) {
    console.log(`    ${yellow("⚠")} ${r.error}`);
    return;
  }

  if (qc) {
    console.log(
      `    answers_core_question:    ${checkMark(qc.answers_core_question)}`,
    );
    console.log(
      `    matches_brand_voice:      ${checkMark(qc.matches_brand_voice)}`,
    );
    console.log(
      `    contains_ungrounded:      ${checkMark(!qc.contains_ungrounded_claims)} ${qc.contains_ungrounded_claims ? red("(PROBLEM)") : ""}`,
    );
    console.log(`    ready_to_send:            ${checkMark(qc.ready_to_send)}`);
  } else {
    console.log(`    ${yellow("⚠")} Ingen quality_check i svar`);
  }

  console.log(`    Preview: "${yellow(r.replyPreview)}"`);
}

function printSummary(results: TicketResult[]): void {
  const withQC = results.filter((r) => r.quality_check !== null);
  const readyCount = withQC.filter((r) => r.quality_check!.ready_to_send).length;
  const brandVoiceCount = withQC.filter((r) => r.quality_check!.matches_brand_voice).length;
  const ungroundedCount = withQC.filter((r) => r.quality_check!.contains_ungrounded_claims).length;
  const answersCount = withQC.filter((r) => r.quality_check!.answers_core_question).length;
  const errorCount = results.filter((r) => r.error).length;

  // Intent distribution for failures
  const failedByIntent: Record<string, number> = {};
  for (const r of results) {
    if (r.quality_check?.ready_to_send === false) {
      failedByIntent[r.primaryIntent] = (failedByIntent[r.primaryIntent] ?? 0) + 1;
    }
  }

  const total = results.length;

  console.log("\n" + "─".repeat(60));
  console.log(bold("SAMLET SCORE"));
  console.log("─".repeat(60));
  console.log(
    `  ready_to_send:            ${readyCount}/${withQC.length} ${readyCount === withQC.length ? green("✓ ALLE") : red(`— ${withQC.length - readyCount} fejler`)}`,
  );
  console.log(
    `  answers_core_question:    ${answersCount}/${withQC.length}`,
  );
  console.log(
    `  matches_brand_voice:      ${brandVoiceCount}/${withQC.length}`,
  );
  console.log(
    `  contains_ungrounded:      ${ungroundedCount}/${withQC.length} ${ungroundedCount > 0 ? red("(PROBLEM)") : green("✓ ingen")}`,
  );
  console.log(`  errors (ingen besked):    ${errorCount}/${total}`);
  console.log(
    `  total kørt:               ${total} tickets`,
  );

  if (Object.keys(failedByIntent).length > 0) {
    console.log("\n" + bold("Intent-kategorier der fejler oftest (ready_to_send=false):"));
    const sorted = Object.entries(failedByIntent).sort(([, a], [, b]) => b - a);
    for (const [intent, count] of sorted) {
      console.log(`  ${red("✗")} ${intent}: ${count}`);
    }
  } else if (withQC.length > 0) {
    console.log(`\n  ${green("✓")} Ingen intent-kategorier med ready_to_send=false`);
  }

  console.log("─".repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold("\n=== Sona AI — Quality Check Test ===\n"));

  // 1. Find Acezone shop
  console.log("Finder Acezone workspace…");
  const { shopId, ownerId, workspaceId } = await resolveAcezoneShop();
  console.log(`  → owner_user_id: ${ownerId}`);
  console.log(`  → workspace_id:  ${workspaceId ?? "(ingen)"}`);

  // 2. Hent threads
  console.log(`\nHenter de seneste ${TICKET_LIMIT} threads…`);
  const threads = await fetchRecentThreads(workspaceId, ownerId);
  if (threads.length === 0) {
    console.log(red("  Ingen threads fundet. Tjek workspace_id og user_id."));
    Deno.exit(1);
  }
  console.log(`  → Fandt ${threads.length} threads\n`);

  // 3. Kør pipeline for hver thread
  const results: TicketResult[] = [];
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i];
    process.stdout?.write?.(`  [${i + 1}/${threads.length}] ${truncate(thread.subject, 50)}…`);

    try {
      const result = await runPipelineForTicket(thread, shopId, ownerId, workspaceId);
      results.push(result);
      printResult(i, result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(` ${red("FEJL")}: ${errMsg}`);
      results.push({
        ticketId: thread.threadId,
        subject: thread.subject,
        primaryIntent: "unknown",
        replyPreview: "",
        quality_check: null,
        error: errMsg,
        durationMs: 0,
      });
    }
  }

  // 4. Samlet score
  printSummary(results);
}

main().catch((err) => {
  console.error(red(`\nFejl: ${err.message}`));
  Deno.exit(1);
});
