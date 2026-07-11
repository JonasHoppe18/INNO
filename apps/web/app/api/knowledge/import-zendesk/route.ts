import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";
import {
  importRetryDelayMs,
  isRetryableImportStatus,
  nextExportCursor,
  parseRetryAfterMs,
} from "@/lib/server/zendesk-import-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_REDACT_MODEL = process.env.OPENAI_REDACT_MODEL || "gpt-4o-mini";

const SOURCE_PROVIDER = "zendesk";
const EMBED_BATCH_SIZE = 50;
const CHUNK_TICKETS = 10;
const MAX_EXTERNAL_RETRIES = 3;
const IMPORT_STATUSES = ["solved", "closed"];

class RetryableImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableImportError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchExternalWithRetry(
  input: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt <= MAX_EXTERNAL_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      lastNetworkError = error;
      if (attempt === MAX_EXTERNAL_RETRIES) break;
      await sleep(importRetryDelayMs({ attempt }));
      continue;
    }

    if (!isRetryableImportStatus(response.status)) return response;
    if (attempt === MAX_EXTERNAL_RETRIES) {
      throw new RetryableImportError(`${context} is temporarily unavailable (${response.status}).`);
    }
    await sleep(importRetryDelayMs({
      attempt,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    }));
  }

  const detail = lastNetworkError instanceof Error ? `: ${lastNetworkError.message}` : "";
  throw new RetryableImportError(`${context} could not be reached${detail}`);
}

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function decodeCredentials(raw: string) {
  if (!raw) return "";
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return raw;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function stripHtml(html: string) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAutoReply(text: string) {
  const lower = String(text || "").toLowerCase();
  return (
    lower.includes("this is an automated reply") ||
    lower.includes("we have received your request") ||
    lower.includes("auto-reply") ||
    lower.includes("out of office") ||
    lower.length < 60
  );
}

function normalizeText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The customer message (embedding source + few-shot display) */
function buildCustomerMsg(subject: string, customerBody: string) {
  return subject ? `${subject}\n${customerBody}`.trim() : customerBody.trim();
}

function ticketHash(ticketId: string) {
  return createHash("sha256").update(ticketId).digest("hex").slice(0, 16);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetchExternalWithRetry("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  }, "OpenAI embeddings");
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `Embedding failed (${response.status})`
    );
  }
  return (payload?.data ?? [])
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding);
}

// --- PII redaction -------------------------------------------------------
// ticket_examples rows are injected into the writer prompt as few-shot tone
// anchors. They MUST NOT carry real customer PII, or the model can copy another
// customer's name/address/phone into a live reply (observed in production).
// Every imported pair is run through an LLM redactor before embedding/insert.
// If redaction fails for a ticket, that ticket is DROPPED — we never store raw PII.
const REDACT_SYSTEM = `You are a strict GDPR redaction engine for customer-support transcripts.
You receive JSON with fields: subject, customer_msg, agent_reply.
Return JSON with the SAME fields, rewritten so that ALL personal data is replaced by neutral placeholders, while preserving meaning, tone, structure and any product/issue details.

Replace:
- Person names (customer AND agent/support names) -> neutral greeting/sign-off. Customer greeting becomes a neutral "Hi there" (or same-language equivalent). Agent signature name becomes "[Agent]". Never invent a name.
- Email addresses -> [email]
- Phone numbers -> [phone]
- Postal/street addresses, postal codes, cities tied to a person -> [address]
- Order numbers / order IDs -> [order number]
- Tracking numbers / shipment IDs -> [tracking number]
- Any other directly identifying info -> [redacted]

KEEP intact: product names (A-Spire, A-Rise, A-Blaze, dongle, etc.), the nature of the issue, policy/procedure wording, tone, and language (do not translate).
Output ONLY the JSON object.`;

async function redactOne(input: {
  subject: string;
  customer_msg: string;
  agent_reply: string;
}): Promise<{ subject: string; customer_msg: string; agent_reply: string }> {
  const res = await fetchExternalWithRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_REDACT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: REDACT_SYSTEM },
        { role: "user", content: JSON.stringify(input) },
      ],
    }),
  }, "OpenAI redaction");
  if (!res.ok) throw new Error(`Redaction failed (${res.status})`);
  const payload = await res.json();
  const parsed = JSON.parse(payload.choices[0].message.content);
  return {
    subject: String(parsed.subject ?? ""),
    customer_msg: String(parsed.customer_msg ?? ""),
    agent_reply: String(parsed.agent_reply ?? ""),
  };
}

/**
 * Redact a batch of {subject, customerBody, agentReply} pairs with bounded
 * concurrency. Tickets whose redaction fails are dropped (null) so raw PII is
 * never persisted.
 */
async function redactPairs<
  T extends { subject: string; customerBody: string; agentReply: string },
>(pairs: T[]): Promise<(T | null)[]> {
  const CONCURRENCY = 5;
  const out: (T | null)[] = new Array(pairs.length).fill(null);
  let cursor = 0;
  let retryableError: RetryableImportError | null = null;
  async function worker() {
    while (cursor < pairs.length && !retryableError) {
      const idx = cursor++;
      const p = pairs[idx];
      try {
        const r = await redactOne({
          subject: p.subject,
          customer_msg: p.customerBody,
          agent_reply: p.agentReply,
        });
        if (!r.customer_msg || !r.agent_reply) {
          out[idx] = null;
          continue;
        }
        out[idx] = {
          ...p,
          subject: r.subject,
          customerBody: r.customer_msg,
          agentReply: r.agent_reply,
        };
      } catch (error) {
        if (error instanceof RetryableImportError) {
          retryableError = error;
          continue;
        }
        out[idx] = null; // malformed/unsafe model output is never stored raw
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (retryableError) throw retryableError;
  return out;
}

/**
 * Fetch one chunk of tickets for job-mode import. One Zendesk page IS one
 * chunk (ticketsPerPage == CHUNK_TICKETS), so no further slicing is needed —
 * the cursor advances exactly one page per call.
 */
async function fetchTicketChunk(opts: {
  baseUrl: string;
  authorization: string;
  cursor: { status: string; after: string | null };
  batchSize: number;
}): Promise<{ tickets: any[]; hasMore: boolean; afterCursor: string | null }> {
  const ticketsPerPage = Math.max(1, Math.min(opts.batchSize, CHUNK_TICKETS));
  const params = new URLSearchParams({
    query: `status:${opts.cursor.status}`,
    "filter[type]": "ticket",
    "page[size]": String(ticketsPerPage),
  });
  if (opts.cursor.after) params.set("page[after]", opts.cursor.after);
  const res = await fetchExternalWithRetry(
    `${opts.baseUrl}/api/v2/search/export?${params.toString()}`,
    { headers: { Authorization: opts.authorization, "Content-Type": "application/json" }, cache: "no-store" },
    "Zendesk ticket export",
  );
  if (!res.ok) throw new Error(`Zendesk ticket export failed: ${res.status}`);
  const data = await res.json().catch(() => ({ results: [], meta: {} }));
  const tickets = Array.isArray(data.results) ? data.results : [];
  return {
    tickets,
    hasMore: Boolean(data?.meta?.has_more),
    afterCursor: typeof data?.meta?.after_cursor === "string" ? data.meta.after_cursor : null,
  };
}

/** Sum Zendesk's search count across both import statuses (solved + closed). */
async function countZendeskTickets(opts: {
  baseUrl: string;
  authorization: string;
}): Promise<number> {
  let total = 0;
  for (const status of IMPORT_STATUSES) {
    const res = await fetchExternalWithRetry(
      `${opts.baseUrl}/api/v2/search/count.json?query=${encodeURIComponent(`type:ticket status:${status}`)}`,
      { headers: { Authorization: opts.authorization }, cache: "no-store" },
      "Zendesk ticket count",
    );
    if (!res.ok) throw new Error(`Zendesk count failed: ${res.status}`);
    const data = await res.json().catch(() => ({ count: 0 }));
    total += Number(data?.count ?? 0);
  }
  return total;
}

/**
 * Build ticket_examples rows from a raw ticket batch: fetch comments per
 * ticket, apply the non-support/auto-reply/empty-body filters, redact PII,
 * embed, and upsert (ignoreDuplicates). This is the exact pipeline the
 * legacy POST body ran inline — extracted verbatim so both legacy and
 * job-chunk mode share the same redaction/quality/dedupe core.
 *
 * Returns:
 * - imported: rows newly inserted by the upsert (new-row count is measured
 *   as pre-upsert DB count -> post-upsert DB count for this shop, since
 *   supabase-js's ignoreDuplicates upsert does not report affected rows).
 * - skipped: tickets that never became a safe pair (no comments, filtered as
 *   non-support/auto-reply, or missing customer/agent body) PLUS pairs whose
 *   redaction succeeded but were duplicates already in ticket_examples.
 * - dropped: pairs whose PII redaction failed (never stored raw).
 */
async function importTicketBatch(opts: {
  supabase: ReturnType<typeof createServiceClient>;
  tickets: any[];
  baseUrl: string;
  authorization: string;
  shopId: string;
  workspaceId: string | null;
}): Promise<{ imported: number; skipped: number; dropped: number }> {
  const { supabase, tickets, baseUrl, authorization, shopId, workspaceId } = opts;
  if (!supabase) throw new Error("Supabase not configured");

  const NON_SUPPORT = /\b(faktura|invoice|payment reminder|påmindelse|bill|betaling)\b/i;
  const pairs: Array<{ ticketId: string; subject: string; customerBody: string; agentReply: string }> = [];
  let skippedPreRedaction = 0;

  for (const ticket of tickets) {
    if (NON_SUPPORT.test(String(ticket.subject || ""))) {
      skippedPreRedaction++;
      continue;
    }

    const commentsRes = await fetchExternalWithRetry(
      `${baseUrl}/api/v2/tickets/${ticket.id}/comments.json?sort_order=asc`,
      { headers: { Authorization: authorization }, cache: "no-store" },
      `Zendesk comments for ticket ${ticket.id}`,
    );
    if (!commentsRes.ok) {
      if (commentsRes.status !== 404) {
        throw new Error(`Zendesk comments fetch failed (${commentsRes.status}).`);
      }
      skippedPreRedaction++;
      continue;
    }

    const { comments = [] } = await commentsRes.json().catch(() => ({ comments: [] }));
    const publicComments = comments.filter((c: any) => c.public);
    const customerComment = publicComments.find((c: any) => c.author_id === ticket.requester_id) || publicComments[0];
    const agentComment = publicComments.find((c: any) => c.author_id !== ticket.requester_id);

    if (!customerComment || !agentComment) {
      skippedPreRedaction++;
      continue;
    }

    const customerBody = normalizeText(stripHtml(customerComment.html_body || customerComment.body || ""));
    const agentReply = normalizeText(stripHtml(agentComment.html_body || agentComment.body || ""));

    if (!customerBody || !agentReply || isAutoReply(agentReply)) {
      skippedPreRedaction++;
      continue;
    }

    pairs.push({
      ticketId: String(ticket.id),
      subject: String(ticket.subject || "").trim(),
      customerBody: customerBody.slice(0, 2000),
      agentReply: agentReply.slice(0, 2000),
    });
  }

  if (!pairs.length) {
    return { imported: 0, skipped: skippedPreRedaction, dropped: 0 };
  }

  // GDPR: redact PII out of every pair BEFORE embedding/storing. Tickets that
  // fail redaction are dropped so raw customer data is never persisted as a
  // few-shot example.
  const redacted = await redactPairs(pairs);
  const droppedForPii = redacted.filter((r) => r === null).length;
  const safePairs = redacted.filter((p): p is NonNullable<typeof p> => p !== null);

  if (!safePairs.length) {
    return { imported: 0, skipped: skippedPreRedaction, dropped: droppedForPii };
  }

  // Embed on customer message — semantic search must match similar customer questions, not agent replies
  const customerMsgs = safePairs.map((p) => buildCustomerMsg(p.subject, p.customerBody));
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < customerMsgs.length; i += EMBED_BATCH_SIZE) {
    const batch = customerMsgs.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
  }

  const rows = safePairs.map((pair, idx) => ({
    shop_id: shopId,
    workspace_id: workspaceId,
    source_provider: SOURCE_PROVIDER,
    external_ticket_id: pair.ticketId,
    customer_msg: customerMsgs[idx],
    agent_reply: pair.agentReply,
    subject: pair.subject,
    embedding: allEmbeddings[idx],
    tags: ["pii_scrubbed"],
  }));

  // Count how many rows for this shop exist BEFORE the upsert, so we can
  // measure exactly how many were newly inserted (ignoreDuplicates upsert
  // does not tell us which rows were skipped as dupes).
  const { count: countBefore, error: countBeforeError } = await supabase
    .from("ticket_examples")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("source_provider", SOURCE_PROVIDER);
  if (countBeforeError) {
    console.warn("[import-zendesk] count failed:", countBeforeError.message);
  }

  // Dedup enforced by DB constraint (shop_id, source_provider, external_ticket_id)
  const { error: insertError } = await supabase
    .from("ticket_examples")
    .upsert(rows, { onConflict: "shop_id,source_provider,external_ticket_id", ignoreDuplicates: true });

  if (insertError) throw new Error(insertError.message);

  const { count: countAfter, error: countAfterError } = await supabase
    .from("ticket_examples")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("source_provider", SOURCE_PROVIDER);
  if (countAfterError) {
    console.warn("[import-zendesk] count failed:", countAfterError.message);
  }

  const newRows = Math.max(0, (countAfter ?? 0) - (countBefore ?? 0));
  const duplicates = rows.length - newRows;

  return {
    imported: newRows,
    skipped: skippedPreRedaction + duplicates,
    dropped: droppedForPii,
  };
}

export async function GET() {
  // Return count of already-imported zendesk tickets for this shop
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const scope = await resolveAuthScope(supabase, { clerkUserId, orgId }).catch(() => null);
  const shops = await listScopedShops(supabase, scope, { fields: "id" }).catch(() => []);
  const shopIds = shops.map((s: any) => s.id).filter(Boolean);

  if (!shopIds.length) return NextResponse.json({ count: 0, imported_examples: 0, last_job: null });

  const { count } = await supabase
    .from("ticket_examples")
    .select("id", { count: "exact", head: true })
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);

  const { data: lastJob } = await supabase
    .from("knowledge_import_jobs")
    .select("*")
    .in("shop_id", shopIds)
    .eq("provider", "zendesk")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    // `count` kept for backwards compatibility with any existing callers.
    count: count ?? 0,
    imported_examples: count ?? 0,
    last_job: lastJob ?? null,
  });
}

export async function POST(req: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let scope: any;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Resolve shop
  const shops = await listScopedShops(supabase, scope, { fields: "id" }).catch(() => []);
  const shop = shops[0];
  if (!shop?.id) return NextResponse.json({ error: "No shop found" }, { status: 400 });

  // Fetch Zendesk integration scoped to workspace
  let integrationQuery = supabase
    .from("integrations")
    .select("id, config, credentials_enc")
    .eq("provider", "zendesk")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (scope?.workspaceId) integrationQuery = integrationQuery.eq("workspace_id", scope.workspaceId);
  else if (scope?.supabaseUserId) integrationQuery = integrationQuery.eq("user_id", scope.supabaseUserId);

  const { data: integration } = await integrationQuery.maybeSingle();
  if (!integration) {
    return NextResponse.json(
      { error: "Zendesk integration not found. Connect Zendesk in settings first." },
      { status: 404 }
    );
  }

  const config = integration.config || {};
  const email = String(config.email || "").trim();
  const baseUrl = String(config.domain || config.base_url || config.subdomain || "").replace(/\/$/, "");
  const token = decodeCredentials(integration.credentials_enc);

  if (!email || !token || !baseUrl) {
    return NextResponse.json({ error: "Zendesk credentials incomplete." }, { status: 400 });
  }

  const authorization = `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`;

  // Body is read exactly once and every import must use the resumable
  // estimate -> start -> continue protocol below.
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "").trim();

  if (mode === "estimate") {
    let total: number;
    try {
      total = await countZendeskTickets({ baseUrl, authorization });
    } catch (err: any) {
      return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
    }
    return NextResponse.json({ estimate: { ticketCount: total } });
  }

  if (mode === "start") {
    if (body?.confirm !== true) {
      return NextResponse.json({ error: "confirm:true required to start import" }, { status: 400 });
    }

    const activeJobQuery = () => supabase
      .from("knowledge_import_jobs")
      .select("*")
      .eq("provider", "zendesk")
      .eq("shop_id", shop.id)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: existingJob, error: existingErr } = await activeJobQuery();
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    if (existingJob) {
      return NextResponse.json({ job: existingJob, resumed: true });
    }

    let totalCount: number;
    try {
      totalCount = await countZendeskTickets({ baseUrl, authorization });
    } catch (err: any) {
      return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
    }

    const { data: insertedJob, error: insertError } = await supabase
      .from("knowledge_import_jobs")
      .insert({
        provider: "zendesk",
        shop_id: shop.id,
        workspace_id: scope?.workspaceId ?? null,
        user_id: scope?.supabaseUserId ?? null,
        status: "running",
        batch_size: CHUNK_TICKETS,
        imported_count: 0,
        skipped_count: 0,
        dropped_count: 0,
        total_count: totalCount,
      })
      .select("*")
      .single();

    if (insertError?.code === "23505") {
      const { data: raceJob, error: raceError } = await activeJobQuery();
      if (raceError || !raceJob) {
        return NextResponse.json({ error: raceError?.message || "Import job could not be resumed." }, { status: 500 });
      }
      return NextResponse.json({ job: raceJob, resumed: true });
    }
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Starting is intentionally cheap. The client invokes `continue` only
    // after this response, so job creation can never time out while importing.
    return NextResponse.json({ job: insertedJob, resumed: false }, { status: 201 });
  }

  if (mode === "continue") {
    const { data, error } = await supabase
      .from("knowledge_import_jobs")
      .select("*")
      .eq("id", String(body?.jobId || ""))
      .eq("shop_id", shop.id)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "job not found" }, { status: 404 });
    let job = data;
    if (job.status !== "running") return NextResponse.json({ job });

    // A short lease lives inside the JSON cursor. Unlike an updated_at-only
    // claim, a later request can see that the current cursor is actively being
    // processed and must wait. If a serverless invocation is killed, the lease
    // expires and the exact same page can be reclaimed safely.
    const rawCursor = job.cursor && typeof job.cursor === "object" ? job.cursor : {};
    const rawAfterCreatedAt = Date.parse(String(rawCursor.after_created_at || ""));
    const exportCursorIsFresh =
      typeof rawCursor.after === "string" &&
      Number.isFinite(rawAfterCreatedAt) &&
      Date.now() - rawAfterCreatedAt < 50 * 60 * 1000;
    const effectiveCursor =
      typeof rawCursor.status === "string" && IMPORT_STATUSES.includes(rawCursor.status)
        ? {
            status: rawCursor.status,
            after: exportCursorIsFresh ? rawCursor.after : null,
            ...(exportCursorIsFresh ? { after_created_at: rawCursor.after_created_at } : {}),
          }
        : { status: IMPORT_STATUSES[0], after: null };
    const leaseExpiresAt = Date.parse(String(rawCursor.lease_expires_at || ""));
    if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
      return NextResponse.json(
        {
          error: "job busy",
          job,
          retry_after_ms: Math.min(5000, Math.max(1000, leaseExpiresAt - Date.now())),
        },
        { status: 409 },
      );
    }

    const leaseCursor = {
      ...effectiveCursor,
      lease_token: crypto.randomUUID(),
      lease_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    };
    let claimQuery = supabase
      .from("knowledge_import_jobs")
      .update({ cursor: leaseCursor, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running");
    // NB: .eq() on a jsonb column needs the filter VALUE as JSON text — passing
    // the raw object serializes as "[object Object]" and Postgres rejects it
    // with `invalid input syntax for type json` (22P02). jsonb equality is
    // structural, so a stringified round-trip compares correctly.
    claimQuery = job.cursor == null
      ? claimQuery.is("cursor", null)
      : claimQuery.eq("cursor", JSON.stringify(job.cursor));
    const { data: claimed, error: claimErr } = await claimQuery.select("*").maybeSingle();
    if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
    if (!claimed) {
      const { data: freshJob } = await supabase
        .from("knowledge_import_jobs")
        .select("*")
        .eq("id", job.id)
        .eq("shop_id", shop.id)
        .maybeSingle();
      return NextResponse.json(
        { error: "job busy", job: freshJob ?? job, retry_after_ms: 1500 },
        { status: 409 },
      );
    }
    job = claimed;

    try {
      const { tickets, hasMore, afterCursor } = await fetchTicketChunk({
        baseUrl,
        authorization,
        cursor: effectiveCursor,
        batchSize: Number(job.batch_size) || CHUNK_TICKETS,
      });

      const { imported: importedThisChunk, skipped: skippedThisChunk, dropped: droppedThisChunk } =
        await importTicketBatch({
          supabase,
          tickets,
          baseUrl,
          authorization,
          shopId: shop.id,
          workspaceId: scope?.workspaceId ?? null,
        });

      const newCursor = nextExportCursor({
        statuses: IMPORT_STATUSES,
        cursor: effectiveCursor,
        hasMore,
        afterCursor,
      });
      const done = newCursor === null;

      const { data: updated, error: updErr } = await supabase
        .from("knowledge_import_jobs")
        .update({
          // Always replace the leased cursor so the lease is released. On the
          // last page the completed status is authoritative; retaining the
          // last plain cursor keeps the NOT NULL constraint intact.
          cursor: done ? effectiveCursor : newCursor,
          status: done ? "completed" : "running",
          imported_count: job.imported_count + importedThisChunk,
          skipped_count: job.skipped_count + skippedThisChunk,
          dropped_count: (job.dropped_count ?? 0) + droppedThisChunk,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("shop_id", shop.id)
        .eq("cursor", JSON.stringify(leaseCursor))
        .select("*")
        .single();
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      return NextResponse.json({ job: updated });
    } catch (err: any) {
      // Job stays "running" — cursor is untouched, so the next continue call
      // retries the same chunk. Only last_error is recorded.
      const message = String(err?.message ?? err);
      const { data: pausedJob } = await supabase
        .from("knowledge_import_jobs")
        .update({
          cursor: effectiveCursor,
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("shop_id", shop.id)
        .eq("cursor", JSON.stringify(leaseCursor))
        .select("*")
        .maybeSingle();
      return NextResponse.json(
        {
          error: message,
          job: pausedJob ?? job,
          retryable: true,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: "Unsupported import mode. Use estimate, start, or continue." },
    { status: 400 },
  );
}

export async function DELETE(req: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const scope = await resolveAuthScope(supabase, { clerkUserId, orgId }).catch(() => null);
  const shops = await listScopedShops(supabase, scope, { fields: "id" }).catch(() => []);
  const shopIds = shops.map((s: any) => s.id).filter(Boolean);

  if (!shopIds.length) return NextResponse.json({ error: "No shop found" }, { status: 400 });

  const { error } = await supabase
    .from("ticket_examples")
    .delete()
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
