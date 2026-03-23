#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * Sona AI — Tracking Quality Test
 *
 * Henter threads tagget "Tracking" fra Acezone workspace og kører dem
 * igennem den fulde pipeline MED rigtig Shopify-ordre og tracking-data.
 *
 * Viser:
 *   - Fuldt reply (ikke truncated)
 *   - Om svaret bruger det faktiske trackingnummer
 *   - Om svaret nævner den rigtige carrier
 *   - Om svarene varierer efter ordrestatus
 *
 * Kør fra project root:
 *   deno run --allow-net --allow-env --allow-read supabase/scripts/test-tracking-quality.ts
 */

// ─── Trin 1: Load env FØR alle andre imports ──────────────────────────────────
import { load } from "jsr:@std/dotenv@0.225.3";

for (const envFile of ["apps/web/.env.local", ".env.local", ".env"]) {
  try {
    const vars = await load({ envPath: envFile, export: true });
    if (Object.keys(vars).length > 0) {
      console.log(`  → Loader env fra ${envFile} (${Object.keys(vars).length} variabler)\n`);
      break;
    }
  } catch { /* prøv næste */ }
}

// ─── Trin 2: Dynamiske imports (EFTER env er loaded) ──────────────────────────
const { createClient } = await import("jsr:@supabase/supabase-js@2");
const { assessCase } = await import("../functions/_shared/case-assessment.ts");
const { buildReplyStrategy } = await import("../functions/_shared/reply-strategy.ts");
const { generateReplyFromStrategy } = await import("../functions/_shared/reply-generator.ts");
const { fetchPersona, fetchRelevantKnowledge } = await import("../functions/_shared/agent-context.ts");
const { resolveOrderContext, buildOrderSummary } = await import("../functions/_shared/shopify.ts");
const { fetchTrackingDetailsForOrders, } = await import("../functions/_shared/tracking.ts");
const { pickOrderTrackingKey } = await import("../functions/_shared/tracking-reply.ts");
import type { ActionDecisionValidation } from "../functions/_shared/action-validator.ts";

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY");
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const TICKET_LIMIT = Number(Deno.env.get("TICKET_LIMIT") ?? "15");
const ACEZONE_SHOP_ID = Deno.env.get("ACEZONE_SHOP_ID");
const ACEZONE_SHOP_DOMAIN = Deno.env.get("ACEZONE_SHOP_DOMAIN") ?? "acezone";
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";

if (!SUPABASE_URL) throw new Error("Mangler SUPABASE_URL");
if (!SERVICE_ROLE_KEY) throw new Error("Mangler SUPABASE_SERVICE_ROLE_KEY");
if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("Mangler OPENAI_API_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Farver ───────────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Find AceZone shop ────────────────────────────────────────────────────────
async function resolveAcezoneShop() {
  if (ACEZONE_SHOP_ID) {
    const { data, error } = await supabase
      .from("shops")
      .select("id, owner_user_id, workspace_id")
      .eq("id", ACEZONE_SHOP_ID)
      .single();
    if (error || !data) throw new Error(`Kunne ikke finde shop: ${error?.message}`);
    return { shopId: data.id, ownerId: data.owner_user_id, workspaceId: data.workspace_id };
  }
  const { data } = await supabase
    .from("shops")
    .select("id, owner_user_id, workspace_id, shop_domain")
    .ilike("shop_domain", `%${ACEZONE_SHOP_DOMAIN}%`)
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error(`Ingen shop matcher "${ACEZONE_SHOP_DOMAIN}"`);
  console.log(`  → Shop: ${bold(data.shop_domain)}`);
  return { shopId: data.id, ownerId: data.owner_user_id, workspaceId: data.workspace_id ?? null };
}

// ─── Hent threads tagget "Tracking" ──────────────────────────────────────────
async function fetchTrackingThreads(workspaceId: string | null, ownerId: string) {
  const query = supabase
    .from("mail_threads")
    .select("id, subject, workspace_id, tags")
    .contains("tags", ["Tracking"])
    .order("last_message_at", { ascending: false })
    .limit(TICKET_LIMIT);

  if (workspaceId) {
    query.eq("workspace_id", workspaceId);
  } else {
    query.eq("user_id", ownerId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Kunne ikke hente tracking threads: ${error.message}`);
  return (data ?? []).map((t) => ({
    threadId: t.id,
    subject: t.subject ?? "(intet emne)",
    tags: t.tags ?? [],
  }));
}

// ─── Hent seneste inbound-besked ──────────────────────────────────────────────
async function fetchLatestInbound(threadId: string) {
  const { data } = await supabase
    .from("mail_messages")
    .select("subject, body_text, clean_body_text, from_email")
    .eq("thread_id", threadId)
    .eq("from_me", false)
    .eq("is_draft", false)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    subject: data.subject ?? "",
    body: data.clean_body_text || data.body_text || "",
    fromEmail: data.from_email ?? "",
  };
}

// ─── Analysér om svaret er specifikt eller generisk ──────────────────────────
function analyzeTrackingReply(reply: string, trackingNumber: string | null, carrier: string | null) {
  const r = reply.toLowerCase();
  const usesTrackingNumber = Boolean(trackingNumber && reply.includes(trackingNumber));
  const usesCarrier = Boolean(
    carrier && r.includes(carrier.toLowerCase()),
  );
  const carrierAlternatives = ["postnord", "gls", "ups", "dhl", "dao", "bring", "fedex", "dpd"];
  const mentionsAnyCarrier = carrierAlternatives.some((c) => r.includes(c));
  const hasTrackingUrl = /https?:\/\/\S+track\S*/i.test(reply) || /sporing|track/i.test(reply);

  const genericPhrases = [
    "we will look into",
    "we are working on",
    "vi arbejder på",
    "vi vil undersøge",
    "contact us",
    "kontakt os",
    "thank you for your patience",
    "tak for din tålmodighed",
    "should arrive soon",
    "burde ankomme",
  ];
  const genericCount = genericPhrases.filter((p) => r.includes(p)).length;
  const isGeneric = !usesTrackingNumber && !mentionsAnyCarrier && !hasTrackingUrl && genericCount > 0;

  return { usesTrackingNumber, usesCarrier, mentionsAnyCarrier, hasTrackingUrl, isGeneric, genericCount };
}

// ─── Kør ét tracking ticket ───────────────────────────────────────────────────
async function runTrackingTicket(
  thread: { threadId: string; subject: string },
  shopId: string,
  ownerId: string,
  workspaceId: string | null,
) {
  const start = Date.now();
  const msg = await fetchLatestInbound(thread.threadId);
  if (!msg) return { skipped: true, reason: "ingen inbound besked" };

  // Shopify ordre
  const orderCtx = await resolveOrderContext({
    supabase,
    userId: ownerId,
    workspaceId,
    email: msg.fromEmail,
    subject: msg.subject,
    tokenSecret: ENCRYPTION_KEY ?? null,
    apiVersion: SHOPIFY_API_VERSION,
  }).catch(() => ({ orders: [], matchedSubjectNumber: null, orderIdMap: {} }));

  const selectedOrder = orderCtx.orders[0] ?? null;
  const orderSummary = selectedOrder ? buildOrderSummary([selectedOrder]) : "";

  // Tracking-data
  let trackingDetails: Record<string, unknown> = {};
  let trackingNumber: string | null = null;
  let carrier: string | null = null;
  let trackingStatus: string | null = null;
  let trackingUrl: string | null = null;

  if (selectedOrder) {
    const detailsMap = await fetchTrackingDetailsForOrders([selectedOrder], {}).catch(() => ({}));
    const key = pickOrderTrackingKey(selectedOrder);
    const detail = key ? (detailsMap as any)[key] : null;
    if (detail) {
      trackingDetails = detail;
      trackingNumber = detail.trackingNumber ?? null;
      carrier = detail.carrier ?? null;
      trackingStatus = detail.statusText ?? null;
      trackingUrl = detail.trackingUrl ?? null;
    }
  }

  // Case assessment
  const assessment = assessCase({
    subject: msg.subject,
    body: msg.body,
    ticketCategory: "Tracking",
    workflow: "tracking",
    trackingIntent: true,
  });

  // Persona + Knowledge
  const [persona, knowledgeMatches] = await Promise.all([
    fetchPersona(supabase, ownerId),
    fetchRelevantKnowledge(supabase, shopId, msg.body, 3),
  ]);

  const knowledgeSummary = knowledgeMatches.map((m) => m.content).join("\n\n").slice(0, 1500);

  // Byg fact summary med tracking-data
  const factParts = [
    orderSummary,
    trackingNumber ? `Tracking number: ${trackingNumber}` : "",
    carrier ? `Carrier: ${carrier}` : "",
    trackingStatus ? `Tracking status: ${trackingStatus}` : "",
    trackingUrl ? `Tracking URL: ${trackingUrl}` : "",
  ].filter(Boolean);
  const factSummary = factParts.join("\n");

  const validation: ActionDecisionValidation = {
    version: 1,
    allowed_actions: [],
    removed_actions: [],
    approval_actions: [],
    decision: "reply_only",
    summary: "Tracking test — reply only",
  };

  const replyStrategy = buildReplyStrategy({
    assessment,
    validation,
    selectedOrder,
    trackingIntent: true,
  });

  const result = await generateReplyFromStrategy({
    customerMessage: `${msg.subject}\n\n${msg.body}`.trim(),
    replyStrategy,
    executionState: "no_action",
    factSummary,
    generalKnowledgeSummary: knowledgeSummary,
    personaInstructions: persona.instructions || undefined,
    languageHint: assessment.language || "da",
  });

  const reply = result?.reply ?? "";
  const analysis = analyzeTrackingReply(reply, trackingNumber, carrier);

  return {
    skipped: false,
    threadId: thread.threadId,
    subject: thread.subject,
    fromEmail: msg.fromEmail,
    orderNumber: selectedOrder ? String((selectedOrder as any).name ?? (selectedOrder as any).order_number ?? "") : null,
    trackingNumber,
    carrier,
    trackingStatus,
    reply,
    analysis,
    quality_check: result?.quality_check ?? null,
    durationMs: Date.now() - start,
  };
}

// ─── Print ────────────────────────────────────────────────────────────────────
function printTicketResult(i: number, r: Awaited<ReturnType<typeof runTrackingTicket>>) {
  if (r.skipped) {
    console.log(`\n${bold(`[${i + 1}]`)} ${yellow("SKIPPED")} — ${r.reason}`);
    return;
  }

  const qc = r.quality_check;
  const readyLabel = qc?.ready_to_send === true ? green("READY") : qc?.ready_to_send === false ? red("NOT READY") : yellow("N/A");
  const a = r.analysis;

  console.log(`\n${"─".repeat(70)}`);
  console.log(`${bold(`[${i + 1}]`)} ${r.subject}`);
  console.log(`    ${dim("Thread:")}  ${r.threadId}`);
  console.log(`    ${dim("Fra:")}     ${r.fromEmail}`);
  console.log(`    ${dim("Ordre:")}   ${r.orderNumber ?? red("(ingen ordre fundet)")}`);
  console.log(`    ${dim("Status:")}  ${r.trackingStatus ?? yellow("(ingen tracking-data)")}`);
  console.log(`    ${dim("Carrier:")} ${r.carrier ?? yellow("(ukendt)")}`);
  console.log(`    ${dim("Tracking:")}${r.trackingNumber ?? yellow("(intet trackingnr)")}`);
  console.log(`    ${dim("QC:")}      ${readyLabel}  (${r.durationMs}ms)`);
  console.log("");
  console.log(`    ${bold("TRACKING ANALYSE:")}`);
  console.log(`    ${a.usesTrackingNumber ? green("✓") : red("✗")} Bruger faktisk trackingnummer i svaret`);
  console.log(`    ${a.usesCarrier ? green("✓") : a.mentionsAnyCarrier ? yellow("~") : red("✗")} Nævner carrier ${a.usesCarrier ? `(${r.carrier})` : a.mentionsAnyCarrier ? "(anden carrier)" : "(nævner ingen carrier)"}`);
  console.log(`    ${a.hasTrackingUrl ? green("✓") : red("✗")} Indeholder tracking-link`);
  console.log(`    ${a.isGeneric ? red("✗ GENERISK svar") : green("✓ SPECIFIKT svar")}`);
  console.log("");
  console.log(`    ${bold("FULDT SVAR:")}`);
  // Print reply med indrykning
  const replyLines = r.reply.split("\n");
  for (const line of replyLines) {
    console.log(`    ${cyan(line)}`);
  }
}

function printSummary(results: Awaited<ReturnType<typeof runTrackingTicket>>[]) {
  const valid = results.filter((r) => !r.skipped) as Array<Exclude<typeof results[0], { skipped: true }>>;
  const withTracking = valid.filter((r) => r.trackingNumber);
  const usesTrackingNr = valid.filter((r) => r.analysis.usesTrackingNumber);
  const mentionsCarrier = valid.filter((r) => r.analysis.mentionsAnyCarrier);
  const hasUrl = valid.filter((r) => r.analysis.hasTrackingUrl);
  const generic = valid.filter((r) => r.analysis.isGeneric);
  const ready = valid.filter((r) => r.quality_check?.ready_to_send === true);

  console.log(`\n${"═".repeat(70)}`);
  console.log(bold("TRACKING KVALITETS-OVERSIGT"));
  console.log("═".repeat(70));
  console.log(`  Tickets kørt:              ${valid.length} (${results.filter((r) => r.skipped).length} skipped)`);
  console.log(`  Med tracking-data:         ${withTracking.length}/${valid.length}`);
  console.log(`  Bruger faktisk tracking-nr: ${usesTrackingNr.length}/${withTracking.length} ${usesTrackingNr.length === withTracking.length ? green("✓") : red("← PROBLEM")}`);
  console.log(`  Nævner carrier:            ${mentionsCarrier.length}/${valid.length} ${mentionsCarrier.length === valid.length ? green("✓") : yellow("~")}`);
  console.log(`  Har tracking-link:         ${hasUrl.length}/${valid.length}`);
  console.log(`  Generiske svar:            ${generic.length}/${valid.length} ${generic.length === 0 ? green("✓ ingen") : red(`← ${generic.length} er generiske`)}`);
  console.log(`  QC ready_to_send:          ${ready.length}/${valid.length}`);

  // Vis de generiske svar separat
  if (generic.length > 0) {
    console.log(`\n${bold(red("GENERISKE SVAR (kræver opmærksomhed):"))}`);
    for (const r of generic) {
      if (!r.skipped) console.log(`  • ${r.subject} (ordre: ${r.orderNumber ?? "ingen"})`);
    }
  }

  // Status-variation
  const statusGroups: Record<string, number> = {};
  for (const r of valid) {
    const s = r.trackingStatus ?? "ingen tracking";
    statusGroups[s] = (statusGroups[s] ?? 0) + 1;
  }
  console.log(`\n${bold("Tracking-status fordeling:")}`);
  for (const [status, count] of Object.entries(statusGroups)) {
    console.log(`  ${count}× ${status}`);
  }
  console.log("═".repeat(70));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold("\n=== Sona AI — Tracking Quality Test ===\n"));

  const { shopId, ownerId, workspaceId } = await resolveAcezoneShop();
  console.log(`  → owner:     ${ownerId}`);
  console.log(`  → workspace: ${workspaceId ?? "(ingen)"}`);

  console.log(`\nHenter op til ${TICKET_LIMIT} threads tagget "Tracking"…`);
  const threads = await fetchTrackingThreads(workspaceId, ownerId);

  if (threads.length === 0) {
    console.log(red("  Ingen tracking-threads fundet. Prøv at sætte TICKET_LIMIT højere."));
    Deno.exit(1);
  }
  console.log(`  → Fandt ${threads.length} tracking-threads\n`);

  const results = [];
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    Deno.stdout.writeSync(new TextEncoder().encode(`  Kører [${i + 1}/${threads.length}] ${t.subject.slice(0, 50)}…`));
    try {
      const r = await runTrackingTicket(t, shopId, ownerId, workspaceId);
      results.push(r);
      printTicketResult(i, r);
    } catch (err) {
      console.log(` ${red("FEJL")}: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ skipped: true as const, reason: String(err) });
    }
  }

  printSummary(results);
}

main().catch((err) => {
  console.error(red(`\nFejl: ${err instanceof Error ? err.message : String(err)}`));
  Deno.exit(1);
});
