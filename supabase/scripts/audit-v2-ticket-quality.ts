#!/usr/bin/env -S deno run --node-modules-dir=auto --allow-net --allow-env --allow-read --allow-write
/**
 * Audit generate-draft-v2 against real tickets.
 *
 * Examples:
 *   TICKET_LIMIT=20 deno run --node-modules-dir=auto --allow-net --allow-env --allow-read --allow-write supabase/scripts/audit-v2-ticket-quality.ts
 *   SOURCE=threads TICKET_LIMIT=10 deno run --node-modules-dir=auto --allow-net --allow-env --allow-read --allow-write supabase/scripts/audit-v2-ticket-quality.ts
 */
import { load } from "jsr:@std/dotenv@0.225.3";

for (const envFile of ["apps/web/.env.local", ".env.local", ".env"]) {
  try {
    const vars = await load({ envPath: envFile, export: true });
    if (Object.keys(vars).length > 0) {
      console.log(`Loaded env from ${envFile}`);
      break;
    }
  } catch {
    // Try next file.
  }
}

const { createClient } = await import("jsr:@supabase/supabase-js@2");
const { runDraftV2Pipeline } = await import(
  "../functions/generate-draft-v2/pipeline.ts"
);
const { anchorFinalAgentReply, isZendeskAutoReply, stripZendeskHtml } =
  await import(
    "../../apps/web/lib/server/zendesk-import-helpers.ts"
  );
const { classifyAnchor } = await import(
  "../../apps/web/lib/server/eval-anchor.js"
);
const { classifyLiveFactDependency } = await import(
  "../../apps/web/lib/server/eval-live-fact.js"
);

const SUPABASE_URL = (
  Deno.env.get("SUPABASE_URL") ??
    Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ??
    Deno.env.get("PROJECT_URL") ??
    ""
).replace(/\/$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LIMIT = Math.max(
  1,
  Math.min(Number(Deno.env.get("TICKET_LIMIT") ?? "20"), 100),
);
const SOURCE = (Deno.env.get("SOURCE") ?? "zendesk").toLowerCase();
const SHOP_ID = Deno.env.get("ACEZONE_SHOP_ID") ?? Deno.env.get("SHOP_ID") ??
  "";
const SHOP_DOMAIN = Deno.env.get("ACEZONE_SHOP_DOMAIN") ??
  Deno.env.get("SHOP_DOMAIN") ?? "acezone";
const JUDGE_MODEL = Deno.env.get("JUDGE_MODEL") ?? "gpt-4o-mini";
const WRITER_MODEL = Deno.env.get("WRITER_MODEL") ?? "gpt-5-mini";
const STRONG_MODEL = Deno.env.get("STRONG_MODEL") ?? "gpt-5-mini";
const REPORT_PATH = Deno.env.get("REPORT_PATH") ??
  `supabase/scripts/v2-quality-audit-${
    new Date().toISOString().replace(/[:.]/g, "-")
  }.json`;

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL");
}
if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Ticket = {
  id: string;
  subject: string;
  customerBody: string;
  humanReply?: string | null;
  conversationHistory?: string | null;
  source: string;
  anchorClass?: "comparable" | "action_required" | "non_comparable_anchor";
  liveFactDependent?: boolean;
  excludedFromAggregate?: boolean;
  exclusionReasons?: string[];
};

type JudgeResult = {
  correctness: number;
  completeness: number;
  tone: number;
  actionability: number;
  overall_10: number;
  send_ready: boolean;
  primary_gap: string;
  missing_for_10: string[];
  likely_root_cause: string;
  reasoning: string;
};

function decodeCredentials(raw: string | null | undefined): string {
  if (!raw) return "";
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return raw;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

// B2B/internal senders that should not be evaluated with end-customer criteria.
// "empty draft: review" for these is correct pipeline behavior, not a failure.
const B2B_INDICATORS = [
  "lagerkompagniet",
  "ldlc",
  "freight forwarder",
  "service apres vente",
  "rma request",
  "webshipper",
  "api kode",
  "speditør",
  "freight",
  "savfournisseurs",
  "warehouse manager",
  "ready to be fulfilled",
  "new uk order",
  "sales@",
  "purchase order",
];

function isB2BSender(ticket: Ticket): boolean {
  const combined = ((ticket.customerBody ?? "") + " " + (ticket.subject ?? ""))
    .toLowerCase();
  return B2B_INDICATORS.some((indicator) => combined.includes(indicator));
}

async function resolveShop(): Promise<
  { id: string; ownerUserId: string; workspaceId: string | null }
> {
  if (SHOP_ID) {
    const { data, error } = await supabase
      .from("shops")
      .select("id, owner_user_id, workspace_id")
      .eq("id", SHOP_ID)
      .single();
    if (error || !data) {
      throw new Error(`Shop not found by id: ${error?.message}`);
    }
    return {
      id: data.id,
      ownerUserId: data.owner_user_id,
      workspaceId: data.workspace_id ?? null,
    };
  }

  const { data, error } = await supabase
    .from("shops")
    .select("id, owner_user_id, workspace_id, shop_domain")
    .ilike("shop_domain", `%${SHOP_DOMAIN}%`)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Shop not found for domain fragment "${SHOP_DOMAIN}": ${
        error?.message ?? ""
      }`,
    );
  }
  console.log(`Shop: ${data.shop_domain} (${data.id})`);
  return {
    id: data.id,
    ownerUserId: data.owner_user_id,
    workspaceId: data.workspace_id ?? null,
  };
}

async function fetchThreadTickets(
  shop: { ownerUserId: string; workspaceId: string | null },
): Promise<Ticket[]> {
  let query = supabase
    .from("mail_threads")
    .select("id, subject, workspace_id, user_id, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(LIMIT * 3);

  query = shop.workspaceId
    ? query.eq("workspace_id", shop.workspaceId)
    : query.eq("user_id", shop.ownerUserId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not fetch threads: ${error.message}`);

  const tickets: Ticket[] = [];
  for (const thread of data ?? []) {
    const { data: msg } = await supabase
      .from("mail_messages")
      .select("subject, body_text, clean_body_text, from_email")
      .eq("thread_id", thread.id)
      .eq("from_me", false)
      .eq("is_draft", false)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const body = String(msg?.clean_body_text || msg?.body_text || "").trim();
    if (!body) continue;
    tickets.push({
      id: String(thread.id),
      subject: String(msg?.subject || thread.subject || ""),
      customerBody: body.slice(0, 5000),
      source: "threads",
    });
    if (tickets.length >= LIMIT) break;
  }
  return tickets;
}

async function fetchZendeskTickets(
  shop: { ownerUserId: string; workspaceId: string | null },
): Promise<Ticket[]> {
  let integrationQuery = supabase
    .from("integrations")
    .select("id, config, credentials_enc")
    .eq("provider", "zendesk")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  integrationQuery = shop.workspaceId
    ? integrationQuery.eq("workspace_id", shop.workspaceId)
    : integrationQuery.eq("user_id", shop.ownerUserId);

  const { data: integration, error } = await integrationQuery.maybeSingle();
  if (error || !integration) {
    throw new Error(`Zendesk integration not found: ${error?.message ?? ""}`);
  }

  const config = integration.config || {};
  const email = String(config.email || "").trim();
  const baseUrl = String(
    config.domain || config.base_url || config.subdomain || "",
  ).replace(/\/$/, "");
  const token = decodeCredentials(integration.credentials_enc);
  if (!email || !baseUrl || !token) {
    throw new Error("Zendesk integration credentials are incomplete");
  }

  const authorization = `Basic ${btoa(`${email}/token:${token}`)}`;
  const perPage = Math.min(Math.max(LIMIT, 30), 100);
  const [solvedRes, closedRes] = await Promise.all([
    fetch(
      `${baseUrl}/api/v2/tickets.json?status=solved&sort_by=created_at&sort_order=desc&per_page=${perPage}`,
      {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
      },
    ),
    fetch(
      `${baseUrl}/api/v2/tickets.json?status=closed&sort_by=created_at&sort_order=desc&per_page=${perPage}`,
      {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
      },
    ),
  ]);
  if (!solvedRes.ok && !closedRes.ok) {
    throw new Error(
      `Zendesk API failed: solved=${solvedRes.status} closed=${closedRes.status}`,
    );
  }

  const solvedData = solvedRes.ok
    ? await solvedRes.json().catch(() => ({ tickets: [] }))
    : { tickets: [] };
  const closedData = closedRes.ok
    ? await closedRes.json().catch(() => ({ tickets: [] }))
    : { tickets: [] };
  const seen = new Set<string>();
  const rawTickets = [
    ...(solvedData.tickets ?? []),
    ...(closedData.tickets ?? []),
  ]
    .filter((ticket) => {
      const id = String(ticket.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return !/\b(faktura|invoice|payment reminder|påmindelse|bill|betaling|regning)\b/i
        .test(String(ticket.subject || ""));
    })
    .sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const tickets: Ticket[] = [];
  for (const ticket of rawTickets) {
    const commentsRes = await fetch(
      `${baseUrl}/api/v2/tickets/${ticket.id}/comments.json?sort_order=asc`,
      {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
      },
    );
    if (!commentsRes.ok) continue;
    const { comments = [] } = await commentsRes.json().catch(() => ({
      comments: [],
    }));
    const publicComments: Array<{ role: "customer" | "agent"; body: string }> =
      comments
        .filter((c: Record<string, unknown>) => c.public)
        .map((c: Record<string, unknown>) => ({
          role: c.author_id === ticket.requester_id
            ? "customer" as const
            : "agent" as const,
          body: stripZendeskHtml(String(c.html_body || c.body || "")),
        }))
        .filter((c: { role: "customer" | "agent"; body: string }) =>
          c.body && (c.role === "customer" || !isZendeskAutoReply(c.body))
        );
    if (publicComments.length < 2) continue;

    const anchored = anchorFinalAgentReply(publicComments);
    if (!anchored) continue;
    const anchor = classifyAnchor({ humanReply: anchored.agentReply });
    const liveFact = classifyLiveFactDependency({
      body: anchored.customerBody,
      humanReply: anchored.agentReply,
    });
    const exclusionReasons = [
      ...(anchor.anchor_class === "non_comparable_anchor"
        ? ["non_comparable_action_anchor"]
        : []),
      ...(liveFact.live_fact_dependent
        ? [liveFact.reason || "unresolvable_live_fact"]
        : []),
    ];
    const candidate: Ticket = {
      id: String(ticket.id),
      subject: String(ticket.subject || ""),
      customerBody: anchored.customerBody.slice(0, 5000),
      humanReply: anchored.agentReply.slice(0, 5000),
      conversationHistory: String(anchored.conversationContext || "").slice(
        -5000,
      ),
      source: "zendesk",
      anchorClass: anchor.anchor_class,
      liveFactDependent: liveFact.live_fact_dependent,
      excludedFromAggregate: exclusionReasons.length > 0,
      exclusionReasons,
    };
    // Keep the end-customer benchmark clean. Internal fulfilment/vendor threads
    // belong in a separate operations eval with different success criteria.
    if (isB2BSender(candidate)) continue;
    tickets.push(candidate);
    if (tickets.length >= LIMIT) break;
  }
  return tickets;
}

async function judge(
  ticket: Ticket,
  draft: string,
  confidence: number | null,
  sourcesCount: number,
): Promise<JudgeResult> {
  const system =
    `You are a strict support QA evaluator. Score the AI draft from 1 to 10.
10 means a senior human agent could send it as-is: it answers the exact latest customer request, uses the right language, is factually grounded, includes the necessary next step, avoids irrelevant process/policy, and is natural.

Treat the historical human reply as a strong resolution reference, not automatic policy truth. It may include a warehouse conversation, repair estimate, refund, shipment or other out-of-band action that the eval payload cannot reproduce. Never require the AI to claim that such an action happened when it has no executed action or live fact. A precise request for the one missing identifier can be the correct response.

Hard caps: fabricated facts/actions/policies or invented availability => max 2 and not send-ready; wrong language => max 2; wrong product or reversed conversation direction => max 3. Fluent tone cannot compensate for a wrong or unsupported resolution.

Return ONLY JSON.`;
  const user = `SUBJECT:
${ticket.subject}

LATEST CUSTOMER MESSAGE:
${ticket.customerBody}

CONVERSATION HISTORY:
${ticket.conversationHistory || "(none)"}

HUMAN REFERENCE REPLY:
${ticket.humanReply || "(none)"}

AI DRAFT:
${draft}

V2 VERIFIER CONFIDENCE: ${confidence ?? "null"}
V2 SOURCES COUNT: ${sourcesCount}
ANCHOR CLASS: ${ticket.anchorClass || "comparable"}
LIVE FACT UNRESOLVABLE IN EVAL: ${ticket.liveFactDependent === true}
EXCLUDED FROM HEADLINE: ${ticket.excludedFromAggregate === true}

Return this JSON:
{
  "correctness": 1-10,
  "completeness": 1-10,
  "tone": 1-10,
  "actionability": 1-10,
  "overall_10": 1-10,
  "send_ready": true|false,
  "primary_gap": "short label",
  "missing_for_10": ["concrete missing thing"],
  "likely_root_cause": "retrieval|facts|intent|conversation_state|policy|writer|language|action_decision|eval_harness|other",
  "reasoning": "one concise sentence"
}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `judge failed ${res.status}`);
  }
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

const shop = await resolveShop();
const tickets = SOURCE === "threads"
  ? await fetchThreadTickets(shop)
  : await fetchZendeskTickets(shop);
if (!tickets.length) throw new Error(`No tickets found for source=${SOURCE}`);
console.log(`Running V2 audit on ${tickets.length} ${SOURCE} tickets`);

// Resolve each evaluated ticket's own few-shot row up front. The pipeline also
// receives the external ticket id and must exclude these rows. Keeping the ids
// here lets the harness prove the exclusion and refuse to judge a leaked run.
const sourceExampleIdsByTicket = new Map<string, Set<number>>();
{
  const { data, error } = await supabase
    .from("ticket_examples")
    .select("id, external_ticket_id")
    .eq("shop_id", shop.id)
    .in("external_ticket_id", tickets.map((ticket) => ticket.id));
  if (error) {
    throw new Error(`Could not load source ticket examples: ${error.message}`);
  }
  for (const row of data ?? []) {
    const externalId = String(row.external_ticket_id ?? "");
    if (!externalId || typeof row.id !== "number") continue;
    const ids = sourceExampleIdsByTicket.get(externalId) ?? new Set<number>();
    ids.add(row.id);
    sourceExampleIdsByTicket.set(externalId, ids);
  }
}

type LeakageGuard = {
  source_example_count: number;
  retrieved_example_ids: number[];
  excluded_external_id_matches: number[];
  excluded_duplicate_question_matches: number[];
  self_example_retrieved: boolean;
  leaked_example_ids: number[];
};
type AuditResult = {
  ticket: Ticket;
  draft?: string;
  qa?: JudgeResult;
  error?: string;
  leakage_guard?: LeakageGuard;
  latency_ms: number;
  v2?: Record<string, unknown>;
};

const results: AuditResult[] = [];
const skippedB2B = [];
for (let i = 0; i < tickets.length; i++) {
  const ticket = tickets[i];
  // Skip B2B/internal tickets — they have different quality criteria and
  // "empty draft: review" is correct pipeline behavior for them, not a failure.
  if (isB2BSender(ticket)) {
    console.log(
      `\n[${i + 1}/${tickets.length}] SKIP (B2B/internal) ${
        ticket.subject.slice(0, 90)
      } (${ticket.id})`,
    );
    skippedB2B.push(ticket.id);
    continue;
  }
  console.log(
    `\n[${i + 1}/${tickets.length}] ${
      ticket.subject.slice(0, 90)
    } (${ticket.id})`,
  );
  const startedAt = Date.now();
  try {
    const pipeline = await runDraftV2Pipeline({
      shop_id: shop.id,
      supabase,
      eval_payload: {
        subject: ticket.subject,
        body: ticket.customerBody,
        from_email: "eval@eval.internal",
        conversation_history: ticket.conversationHistory || undefined,
        // Critical leakage guard: never let an imported historical ticket find
        // its own human answer in ticket_examples during evaluation.
        source_thread_id: ticket.id,
      },
      eval_options: {
        writer_model: WRITER_MODEL,
        strong_model: STRONG_MODEL,
      },
    });
    const draft = String(pipeline.draft_text || "").trim();
    if (!draft) {
      throw new Error(
        `empty draft: ${pipeline.skip_reason || pipeline.routing_hint}`,
      );
    }
    const retrievedTicketExamples = pipeline.retrieval_debug?.ticket_examples ??
      [];
    const retrievedTicketExampleIds = new Set(
      retrievedTicketExamples
        .map((example) => example?.id)
        .filter((id): id is number => typeof id === "number"),
    );
    const ownExampleIds = sourceExampleIdsByTicket.get(ticket.id) ??
      new Set<number>();
    const leakedOwnExampleIds = [...ownExampleIds].filter((id) =>
      retrievedTicketExampleIds.has(id)
    );
    const leakageGuard = {
      source_example_count: ownExampleIds.size,
      retrieved_example_ids: [...retrievedTicketExampleIds],
      excluded_external_id_matches:
        pipeline.retrieval_debug?.ticket_example_exclusions
          ?.external_id_matches ?? [],
      excluded_duplicate_question_matches:
        pipeline.retrieval_debug?.ticket_example_exclusions
          ?.duplicate_question_matches ?? [],
      self_example_retrieved: leakedOwnExampleIds.length > 0,
      leaked_example_ids: leakedOwnExampleIds,
    };
    if (leakageGuard.self_example_retrieved) {
      const message =
        `eval leakage: source ticket ${ticket.id} retrieved its own example(s) ${
          leakedOwnExampleIds.join(",")
        }`;
      console.log(`ERROR: ${message}`);
      results.push({
        ticket,
        draft,
        error: message,
        leakage_guard: leakageGuard,
        latency_ms: Date.now() - startedAt,
      });
      continue;
    }
    const qa = await judge(
      ticket,
      draft,
      pipeline.confidence ?? null,
      pipeline.sources?.length ?? 0,
    );
    console.log(
      `score=${qa.overall_10}/10 send_ready=${qa.send_ready} root=${qa.likely_root_cause} gap=${qa.primary_gap}`,
    );
    results.push({
      ticket,
      draft,
      qa,
      v2: {
        confidence: pipeline.confidence,
        routing_hint: pipeline.routing_hint,
        proposed_actions: pipeline.proposed_actions,
        sources: pipeline.sources,
      },
      leakage_guard: leakageGuard,
      latency_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`ERROR: ${message}`);
    results.push({
      ticket,
      error: message,
      latency_ms: Date.now() - startedAt,
    });
  }
}

const judged = results.filter(
  (result): result is AuditResult & { qa: JudgeResult } => Boolean(result.qa),
);
const headline = judged.filter((result) =>
  result.ticket.excludedFromAggregate !== true
);
const scores = headline.map((result) => Number(result.qa.overall_10));
const summary = {
  source: SOURCE,
  limit: LIMIT,
  judged: judged.length,
  headline_judged: headline.length,
  excluded_from_headline: judged.length - headline.length,
  errors: results.length - judged.length,
  skipped_b2b: skippedB2B.length,
  self_example_leaks:
    results.filter((r) => r.leakage_guard?.self_example_retrieved === true)
      .length,
  duplicate_question_examples_excluded: results.reduce(
    (count, result) =>
      count +
      (result.leakage_guard?.excluded_duplicate_question_matches?.length ?? 0),
    0,
  ),
  average_score_10: scores.length
    ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
    : 0,
  median_score_10: median(scores),
  ten_out_of_ten: headline.filter((r) => Number(r.qa.overall_10) === 10).length,
  send_ready: headline.filter((r) => r.qa.send_ready === true).length,
  root_causes: countBy(
    headline.map((r) => String(r.qa.likely_root_cause || "unknown")),
  ),
  primary_gaps: countBy(
    headline.map((r) => String(r.qa.primary_gap || "unknown")),
  ),
  exclusion_reasons: countBy(
    judged.flatMap((result) => result.ticket.exclusionReasons ?? []),
  ),
};

const report = { generated_at: new Date().toISOString(), summary, results };
await Deno.writeTextFile(REPORT_PATH, JSON.stringify(report, null, 2));

console.log("\nSUMMARY");
console.log(JSON.stringify(summary, null, 2));
console.log(`\nReport written to ${REPORT_PATH}`);
