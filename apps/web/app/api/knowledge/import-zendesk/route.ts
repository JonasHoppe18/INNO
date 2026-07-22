import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { listScopedShops, resolveAuthScope } from "@/lib/server/workspace-auth";
import { normalizeZendeskBaseUrl } from "@/lib/server/zendesk-url";
import {
  analyzeResidualZendeskPii,
  analyzeZendeskReplyAnchor,
  hasUnclassifiedZendeskPublicComment,
  importRetryDelayMs,
  isRetryableImportStatus,
  nextExportCursor,
  nextZendeskPageCursor,
  parseRetryAfterMs,
  planZendeskRefreshCuration,
  scrubResidualZendeskPii,
  zendeskCommentsToTurns,
} from "@/lib/server/zendesk-import-helpers";
import { assessHistoricalExampleQuality } from "../../../../../../supabase/functions/_shared/historical-example-quality.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ||
  "text-embedding-3-small";
const OPENAI_REDACT_MODEL = process.env.OPENAI_REDACT_MODEL || "gpt-4o-mini";
const ZENDESK_ALLOWED_HOSTS = process.env.ZENDESK_ALLOWED_HOSTS || "";
const IMPORT_WORKER_SECRET = process.env.IMPORT_HISTORY_WORKER_SECRET ||
  process.env.CRON_SECRET || "";

const SOURCE_PROVIDER = "zendesk";
// Keep this resumable, PII-scrubbed ticket-example pipeline isolated from the
// legacy generic history worker, which intentionally fails closed (HIST-0).
const IMPORT_JOB_PROVIDER = "zendesk_ticket_examples_v2";
const EMBED_BATCH_SIZE = 50;
const CHUNK_TICKETS = 10;
const MAX_EXTERNAL_RETRIES = 3;
const MAX_COMMENT_PAGES_PER_TICKET = 3;
const IMPORT_STATUSES = ["solved", "closed"];

function resolveAppBaseUrl(request: Request) {
  const host = request.headers.get("x-forwarded-host") ||
    request.headers.get("host") || "";
  if (!host) return "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

/** Continue an import inside the deployed app so progress does not depend on
 * a browser tab. The durable cursor + lease still make every call resumable. */
function kickZendeskImportWorker(
  request: Request,
  jobId: string,
  retryCount = 0,
) {
  if (!IMPORT_WORKER_SECRET || !jobId) return;
  const baseUrl = resolveAppBaseUrl(request);
  if (!baseUrl) return;
  void fetch(`${baseUrl}/api/knowledge/import-zendesk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-import-history-worker-secret": IMPORT_WORKER_SECRET,
    },
    body: JSON.stringify({
      mode: "continue",
      jobId,
      chain: true,
      worker_retry_count: retryCount,
    }),
  }).catch(() => null);
}

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
      throw new RetryableImportError(
        `${context} is temporarily unavailable (${response.status}).`,
      );
    }
    await sleep(importRetryDelayMs({
      attempt,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    }));
  }

  const detail = lastNetworkError instanceof Error
    ? `: ${lastNetworkError.message}`
    : "";
  throw new RetryableImportError(`${context} could not be reached${detail}`);
}

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

async function resolveRequiredTenantScope(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  authIds: { clerkUserId: string; orgId: string | null | undefined },
) {
  const scope = await resolveAuthScope(supabase, authIds, {
    // A user without an active Clerk org must not silently fall through to an
    // arbitrary membership when more than one workspace is available.
    requireExplicitWorkspace: true,
  });
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    throw new Error("No tenant scope is available for this account.");
  }
  return scope;
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

/** The customer message (embedding source + few-shot display) */
function buildCustomerMsg(subject: string, customerBody: string) {
  return subject ? `${subject}\n${customerBody}`.trim() : customerBody.trim();
}

function ticketHash(ticketId: string) {
  return createHash("sha256").update(ticketId).digest("hex").slice(0, 16);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetchExternalWithRetry(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
    },
    "OpenAI embeddings",
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `Embedding failed (${response.status})`,
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
const REDACT_SYSTEM =
  `You are a strict GDPR redaction engine for customer-support transcripts.
You receive JSON with fields: subject, customer_msg, agent_reply, conversation_context.
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
  conversation_context: string;
}): Promise<{
  subject: string;
  customer_msg: string;
  agent_reply: string;
  conversation_context: string;
}> {
  const res = await fetchExternalWithRetry(
    "https://api.openai.com/v1/chat/completions",
    {
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
    },
    "OpenAI redaction",
  );
  if (!res.ok) throw new Error(`Redaction failed (${res.status})`);
  const payload = await res.json();
  const parsed = JSON.parse(payload.choices[0].message.content);
  return {
    subject: String(parsed.subject ?? ""),
    customer_msg: String(parsed.customer_msg ?? ""),
    agent_reply: String(parsed.agent_reply ?? ""),
    conversation_context: String(parsed.conversation_context ?? ""),
  };
}

type ZendeskRedactionFailureReason =
  | "pii_redaction_missing_required_fields"
  | `pii_residual_detected:${string}`
  | "pii_redaction_model_output_invalid";

type ZendeskRedactionResult<T> =
  | { pair: T; failureReason: null }
  | { pair: null; failureReason: ZendeskRedactionFailureReason };

/**
 * Redact a batch of {subject, customerBody, agentReply, conversationContext}
 * pairs with bounded concurrency. Tickets whose redaction fails are dropped
 * with a durable reason so raw PII is never persisted and the next import can
 * distinguish residual PII from malformed model output.
 */
async function redactPairs<
  T extends {
    subject: string;
    customerBody: string;
    agentReply: string;
    conversationContext: string;
  },
>(pairs: T[]): Promise<ZendeskRedactionResult<T>[]> {
  const CONCURRENCY = 5;
  const out: ZendeskRedactionResult<T>[] = new Array(pairs.length);
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
          conversation_context: p.conversationContext,
        });
        if (
          !r.customer_msg ||
          !r.agent_reply ||
          (p.conversationContext && !r.conversation_context)
        ) {
          out[idx] = {
            pair: null,
            failureReason: "pii_redaction_missing_required_fields",
          };
          continue;
        }
        const raw = {
          subject: p.subject,
          customer_msg: p.customerBody,
          agent_reply: p.agentReply,
          conversation_context: p.conversationContext,
        };
        const scrubbed = scrubResidualZendeskPii(raw, r);
        const residual = analyzeResidualZendeskPii(raw, scrubbed);
        if (residual.hasResidual) {
          out[idx] = {
            pair: null,
            failureReason: `pii_residual_detected:${
              residual.categories.join("+")
            }`,
          };
          continue;
        }
        out[idx] = {
          pair: {
            ...p,
            subject: scrubbed.subject,
            customerBody: scrubbed.customer_msg,
            agentReply: scrubbed.agent_reply,
            conversationContext: scrubbed.conversation_context,
          },
          failureReason: null,
        };
      } catch (error) {
        if (error instanceof RetryableImportError) {
          retryableError = error;
          continue;
        }
        out[idx] = {
          pair: null,
          failureReason: "pii_redaction_model_output_invalid",
        }; // malformed/unsafe model output is never stored raw
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
    {
      headers: {
        Authorization: opts.authorization,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      redirect: "error",
    },
    "Zendesk ticket export",
  );
  if (!res.ok) throw new Error(`Zendesk ticket export failed: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (
    !data || !Array.isArray(data.results) ||
    !data.meta || typeof data.meta.has_more !== "boolean"
  ) {
    throw new Error("Zendesk ticket export response was malformed.");
  }
  const tickets = data.results;
  const hasMore = data.meta.has_more === true;
  const afterCursor = typeof data.meta.after_cursor === "string"
    ? data.meta.after_cursor.trim() || null
    : null;
  if (hasMore && !afterCursor) {
    throw new Error(
      "Zendesk ticket export pagination was missing its next cursor.",
    );
  }
  return {
    tickets,
    hasMore,
    afterCursor,
  };
}

type ZendeskAuthorRole = "agent" | "admin" | "end-user";
type ZendeskImportOutcome = "inserted" | "refreshed" | "skipped" | "dropped";
type ZendeskImportItem = {
  externalTicketId: string;
  outcome: ZendeskImportOutcome;
  reason: string;
};

async function fetchAllTicketComments(opts: {
  baseUrl: string;
  authorization: string;
  ticketId: string;
}): Promise<{ comments: any[] | null; skipReason: string | null }> {
  const comments: any[] = [];
  let after: string | null = null;

  // Bound per-ticket work so a single unusually long thread cannot consume the
  // entire serverless lease. We never anchor against partial history: tickets
  // beyond the safe limit receive a durable skip reason instead.
  for (let page = 0; page < MAX_COMMENT_PAGES_PER_TICKET; page += 1) {
    const params = new URLSearchParams({
      "page[size]": "100",
      sort: "created_at",
    });
    if (after) params.set("page[after]", after);

    const response = await fetchExternalWithRetry(
      `${opts.baseUrl}/api/v2/tickets/${opts.ticketId}/comments.json?${params.toString()}`,
      {
        headers: { Authorization: opts.authorization },
        cache: "no-store",
        redirect: "error",
      },
      `Zendesk comments for ticket ${opts.ticketId}`,
    );
    if (response.status === 404) {
      return { comments: null, skipReason: "comments_not_found" };
    }
    if (!response.ok) {
      throw new Error(`Zendesk comments fetch failed (${response.status}).`);
    }

    const payload = await response.json().catch(() => null);
    if (!payload || !Array.isArray(payload.comments)) {
      throw new Error("Zendesk comments response was malformed.");
    }
    comments.push(...payload.comments);

    if (payload?.meta?.has_more !== true) {
      return { comments, skipReason: null };
    }
    const nextAfter = nextZendeskPageCursor(payload);
    if (!nextAfter || nextAfter === after) {
      return { comments: null, skipReason: "comments_pagination_invalid" };
    }
    after = nextAfter;
  }

  return { comments: null, skipReason: "comments_over_safe_limit" };
}

async function resolveZendeskAuthorRoles(opts: {
  baseUrl: string;
  authorization: string;
  comments: any[];
  cache: Map<string, ZendeskAuthorRole | null>;
}): Promise<Map<string, ZendeskAuthorRole | null>> {
  const authorIds = Array.from(
    new Set(
      opts.comments
        .map((comment) => String(comment?.author_id ?? "").trim())
        .filter(Boolean),
    ),
  );
  const missingIds = authorIds.filter((id) => !opts.cache.has(id));

  for (let offset = 0; offset < missingIds.length; offset += 100) {
    const ids = missingIds.slice(offset, offset + 100);
    const params = new URLSearchParams({
      ids: ids.join(","),
      include_deleted: "true",
    });
    const response = await fetchExternalWithRetry(
      `${opts.baseUrl}/api/v2/users/show_many.json?${params.toString()}`,
      {
        headers: { Authorization: opts.authorization },
        cache: "no-store",
        redirect: "error",
      },
      "Zendesk comment authors",
    );
    if (!response.ok) {
      throw new Error(`Zendesk author lookup failed (${response.status}).`);
    }
    const payload = await response.json().catch(() => null);
    if (!payload || !Array.isArray(payload.users)) {
      throw new Error("Zendesk author lookup response was malformed.");
    }

    const returned = new Set<string>();
    for (const user of payload.users) {
      const id = String(user?.id ?? "").trim();
      if (!id) continue;
      returned.add(id);
      const role = String(user?.role || "").toLowerCase();
      opts.cache.set(
        id,
        role === "agent" || role === "admin" || role === "end-user"
          ? role
          : null,
      );
    }
    // Unknown/deleted authors fail closed and are never treated as agents.
    for (const id of ids) {
      if (!returned.has(id)) opts.cache.set(id, null);
    }
  }

  return opts.cache;
}

/** Sum Zendesk's search count across both import statuses (solved + closed). */
async function countZendeskTickets(opts: {
  baseUrl: string;
  authorization: string;
}): Promise<number> {
  let total = 0;
  for (const status of IMPORT_STATUSES) {
    const res = await fetchExternalWithRetry(
      `${opts.baseUrl}/api/v2/search/count.json?query=${
        encodeURIComponent(`type:ticket status:${status}`)
      }`,
      {
        headers: { Authorization: opts.authorization },
        cache: "no-store",
        redirect: "error",
      },
      "Zendesk ticket count",
    );
    if (!res.ok) throw new Error(`Zendesk count failed: ${res.status}`);
    const data = await res.json().catch(() => ({ count: 0 }));
    total += Number(data?.count ?? 0);
  }
  return total;
}

async function excludeLedgeredZendeskTickets(opts: {
  supabase: NonNullable<ReturnType<typeof createServiceClient>>;
  jobId: string;
  tickets: any[];
}): Promise<any[]> {
  if (opts.tickets.length === 0) return [];
  const externalTicketIds = opts.tickets.map((ticket) =>
    String(ticket?.id ?? "").trim()
  );
  if (externalTicketIds.some((id) => !id)) {
    throw new Error("Zendesk ticket response was missing a stable id.");
  }
  const { data, error } = await opts.supabase
    .from("knowledge_import_job_items")
    .select("external_ticket_id")
    .eq("job_id", opts.jobId)
    .in("external_ticket_id", externalTicketIds);
  if (error) {
    throw new Error(`Could not read import ledger: ${error.message}`);
  }
  const processed = new Set(
    (data ?? []).map((row: any) => String(row.external_ticket_id)),
  );
  return opts.tickets.filter((ticket) => !processed.has(String(ticket.id)));
}

/**
 * Build ticket_examples rows from a raw ticket batch: fetch comments per
 * ticket, apply the non-support/auto-reply/empty-body filters, redact PII,
 * embed, and refresh by stable external ticket id. This is the exact pipeline the
 * legacy POST body ran inline — extracted verbatim so both legacy and
 * job-chunk mode share the same redaction/quality/dedupe core.
 *
 * Returns:
 * - imported: rows newly inserted by the upsert.
 * - updated: existing Zendesk rows refreshed with the corrected final-agent
 *   anchor, preceding context, preserved paragraphs and a new embedding.
 * - skipped: tickets that never became a safe pair (no comments, filtered as
 *   non-support/auto-reply, or missing customer/agent body).
 * - dropped: pairs whose PII redaction failed (never stored raw).
 */
async function importTicketBatch(opts: {
  supabase: ReturnType<typeof createServiceClient>;
  tickets: any[];
  baseUrl: string;
  authorization: string;
  shopId: string;
  workspaceId: string | null;
  jobId: string;
}): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  dropped: number;
  items: ZendeskImportItem[];
}> {
  const {
    supabase,
    tickets,
    baseUrl,
    authorization,
    shopId,
    workspaceId,
    jobId,
  } = opts;
  if (!supabase) throw new Error("Supabase not configured");

  const NON_SUPPORT =
    /\b(faktura|invoice|payment reminder|påmindelse|bill|betaling)\b/i;
  const pairs: Array<{
    ticketId: string;
    subject: string;
    customerBody: string;
    agentReply: string;
    conversationContext: string;
    anchorTag: string;
  }> = [];
  const authorRoleCache = new Map<string, ZendeskAuthorRole | null>();
  const itemByTicketId = new Map<string, ZendeskImportItem>();
  const recordItem = (
    externalTicketId: string,
    outcome: ZendeskImportOutcome,
    reason: string,
  ) => {
    itemByTicketId.set(externalTicketId, {
      externalTicketId,
      outcome,
      reason,
    });
  };
  let skippedPreRedaction = 0;

  for (const ticket of tickets) {
    const ticketId = String(ticket?.id ?? "").trim();
    if (!ticketId) {
      throw new Error("Zendesk ticket response was missing a stable id.");
    }
    if (NON_SUPPORT.test(String(ticket.subject || ""))) {
      skippedPreRedaction++;
      recordItem(ticketId, "skipped", "non_support_subject");
      continue;
    }

    const commentResult = await fetchAllTicketComments({
      baseUrl,
      authorization,
      ticketId,
    });
    if (!commentResult.comments) {
      skippedPreRedaction++;
      recordItem(
        ticketId,
        "skipped",
        commentResult.skipReason || "comments_not_found",
      );
      continue;
    }
    const comments = commentResult.comments;
    const authorRoles = await resolveZendeskAuthorRoles({
      baseUrl,
      authorization,
      comments,
      cache: authorRoleCache,
    });
    if (hasUnclassifiedZendeskPublicComment(comments, authorRoles)) {
      skippedPreRedaction++;
      recordItem(ticketId, "skipped", "unclassified_public_author");
      continue;
    }
    const anchorAnalysis = analyzeZendeskReplyAnchor(
      zendeskCommentsToTurns(comments, authorRoles),
    );
    const anchored = anchorAnalysis.anchored;

    if (!anchored) {
      skippedPreRedaction++;
      recordItem(ticketId, "skipped", anchorAnalysis.reason);
      continue;
    }
    if (
      !/^\d+$/.test(anchored.customerTurnId || "") ||
      !/^\d+$/.test(anchored.agentTurnId || "")
    ) {
      skippedPreRedaction++;
      recordItem(ticketId, "skipped", "missing_versioned_comment_ids");
      continue;
    }

    const exampleQuality = assessHistoricalExampleQuality({
      agentReply: anchored.agentReply,
    });
    if (!exampleQuality.usable) {
      skippedPreRedaction++;
      recordItem(
        ticketId,
        "skipped",
        `low_quality_agent_reply:${exampleQuality.reason}`,
      );
      continue;
    }

    pairs.push({
      ticketId,
      subject: String(ticket.subject || "").trim(),
      customerBody: anchored.customerBody.slice(0, 2000),
      agentReply: anchored.agentReply.slice(0, 2000),
      // Keep the recent end when a very long thread must be bounded; it is the
      // context closest to the customer turn under test and therefore the most
      // relevant for retrieval and writer continuity.
      conversationContext: (anchored.conversationContext || "").slice(-6000),
      anchorTag:
        `zendesk_anchor_v1:${anchored.customerTurnId}:${anchored.agentTurnId}`,
    });
  }

  if (!pairs.length) {
    return {
      imported: 0,
      updated: 0,
      skipped: skippedPreRedaction,
      dropped: 0,
      items: Array.from(itemByTicketId.values()),
    };
  }

  // GDPR: redact PII out of every pair BEFORE embedding/storing. Tickets that
  // fail redaction are dropped so raw customer data is never persisted as a
  // few-shot example.
  const redactionResults = await redactPairs(pairs);
  const droppedForPii =
    redactionResults.filter((result) => result.pair === null).length;
  redactionResults.forEach((result, index) => {
    if (result.pair === null) {
      recordItem(
        pairs[index].ticketId,
        "dropped",
        result.failureReason,
      );
    }
  });
  const safePairs = redactionResults.flatMap((result) =>
    result.pair ? [result.pair] : []
  );

  if (!safePairs.length) {
    return {
      imported: 0,
      updated: 0,
      skipped: skippedPreRedaction,
      dropped: droppedForPii,
      items: Array.from(itemByTicketId.values()),
    };
  }

  // Embed on customer message — semantic search must match similar customer questions, not agent replies
  const customerMsgs = safePairs.map((p) =>
    buildCustomerMsg(p.subject, p.customerBody)
  );
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < customerMsgs.length; i += EMBED_BATCH_SIZE) {
    const batch = customerMsgs.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
  }

  const baseRows = safePairs.map((pair, idx) => ({
    shop_id: shopId,
    workspace_id: workspaceId,
    source_provider: SOURCE_PROVIDER,
    external_ticket_id: pair.ticketId,
    customer_msg: customerMsgs[idx],
    agent_reply: pair.agentReply,
    conversation_context: pair.conversationContext || null,
    subject: pair.subject,
    embedding: allEmbeddings[idx],
    anchorTag: pair.anchorTag,
  }));

  // The stable provider ticket id tells us which rows are new. Pair-specific
  // curation is preserved only when the exact Zendesk comment anchor is still
  // the same; legacy/changed anchors must be reclassified.
  const externalTicketIds = baseRows.map((row) => row.external_ticket_id);
  const { data: existingRows, error: existingRowsError } = await supabase
    .from("ticket_examples")
    .select("external_ticket_id, tags, intent, language, csat_score")
    .eq("shop_id", shopId)
    .eq("source_provider", SOURCE_PROVIDER)
    .in("external_ticket_id", externalTicketIds);
  if (existingRowsError) {
    throw new Error(
      `Could not prepare Zendesk refresh: ${existingRowsError.message}`,
    );
  }
  const existingByExternalId = new Map(
    (existingRows ?? []).map((row: any) => [
      String(row.external_ticket_id),
      row,
    ]),
  );
  const rows = baseRows.map(({ anchorTag, ...row }) => {
    const externalTicketId = String(row.external_ticket_id);
    const existing = existingByExternalId.get(externalTicketId);
    const curation = planZendeskRefreshCuration({
      existing,
      anchorTag,
      jobId,
    });

    recordItem(
      externalTicketId,
      curation.outcome,
      curation.outcome === "inserted"
        ? "new_ticket_example"
        : "corrected_or_refreshed",
    );
    return {
      ...row,
      tags: curation.tags,
      intent: curation.intent,
      language: curation.language,
      csat_score: curation.csat_score,
    };
  });

  // The unique constraint makes this idempotent. Unlike the legacy
  // ignoreDuplicates path, conflict rows are intentionally updated so a
  // controlled reimport repairs their old first-reply anchors.
  const { error: insertError } = await supabase
    .from("ticket_examples")
    .upsert(rows, {
      onConflict: "shop_id,source_provider,external_ticket_id",
      ignoreDuplicates: false,
    });

  if (insertError) throw new Error(insertError.message);

  return {
    imported:
      Array.from(itemByTicketId.values()).filter((item) =>
        item.outcome === "inserted"
      ).length,
    updated:
      Array.from(itemByTicketId.values()).filter((item) =>
        item.outcome === "refreshed"
      ).length,
    skipped: skippedPreRedaction,
    dropped: droppedForPii,
    items: Array.from(itemByTicketId.values()),
  };
}

async function recordZendeskImportItems(opts: {
  supabase: NonNullable<ReturnType<typeof createServiceClient>>;
  jobId: string;
  items: ZendeskImportItem[];
}): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  dropped: number;
}> {
  if (opts.items.length > 0) {
    const ledgerRows = opts.items.map((item) => ({
      job_id: opts.jobId,
      external_ticket_id: item.externalTicketId,
      outcome: item.outcome,
      reason: item.reason,
    }));
    const { error } = await opts.supabase
      .from("knowledge_import_job_items")
      .upsert(ledgerRows, {
        onConflict: "job_id,external_ticket_id",
        // The first durable outcome wins. Retrying a successful example upsert
        // must not turn an original insert into a refresh or double-count it.
        ignoreDuplicates: true,
      });
    if (error) {
      throw new Error(`Could not record import ledger: ${error.message}`);
    }
  }

  const countOutcome = async (outcome: ZendeskImportOutcome) => {
    const { count, error } = await opts.supabase
      .from("knowledge_import_job_items")
      .select("external_ticket_id", { count: "exact", head: true })
      .eq("job_id", opts.jobId)
      .eq("outcome", outcome);
    if (error) {
      throw new Error(`Could not recount import ledger: ${error.message}`);
    }
    return count ?? 0;
  };
  const [imported, updated, skipped, dropped] = await Promise.all([
    countOutcome("inserted"),
    countOutcome("refreshed"),
    countOutcome("skipped"),
    countOutcome("dropped"),
  ]);
  return { imported, updated, skipped, dropped };
}

export async function GET() {
  // Return count of already-imported zendesk tickets for this shop
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, {
      status: 500,
    });
  }

  let shops: any[];
  try {
    const scope = await resolveRequiredTenantScope(supabase, {
      clerkUserId,
      orgId,
    });
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, {
      status: 500,
    });
  }
  const shopIds = shops.map((s: any) => s.id).filter(Boolean);

  if (!shopIds.length) {
    return NextResponse.json({
      count: 0,
      imported_examples: 0,
      last_job: null,
    });
  }

  const { count } = await supabase
    .from("ticket_examples")
    .select("id", { count: "exact", head: true })
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);

  const { data: lastJob } = await supabase
    .from("knowledge_import_jobs")
    .select("*")
    .in("shop_id", shopIds)
    .eq("provider", IMPORT_JOB_PROVIDER)
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
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, {
      status: 500,
    });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, {
      status: 500,
    });
  }

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "").trim();
  const jobId = String(body?.jobId || "").trim();
  const internalToken = String(
    req.headers.get("x-import-history-worker-secret") || "",
  ).trim();
  const internalAuthorized = Boolean(
    IMPORT_WORKER_SECRET && internalToken &&
      internalToken === IMPORT_WORKER_SECRET,
  );

  if (internalToken && !internalAuthorized) {
    return NextResponse.json({ error: "Unauthorized worker request." }, {
      status: 401,
    });
  }
  if (internalAuthorized && (mode !== "continue" || !jobId)) {
    return NextResponse.json({
      error: "Internal worker calls require mode:continue and jobId.",
    }, { status: 400 });
  }

  let scope: any;
  let shops: any[];
  if (internalAuthorized) {
    const { data: workerJob, error: workerJobError } = await supabase
      .from("knowledge_import_jobs")
      .select("id, shop_id, workspace_id, user_id")
      .eq("id", jobId)
      .eq("provider", IMPORT_JOB_PROVIDER)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (workerJobError) {
      return NextResponse.json({ error: workerJobError.message }, {
        status: 500,
      });
    }
    if (!workerJob?.shop_id) {
      return NextResponse.json({ error: "Active import job not found." }, {
        status: 404,
      });
    }
    if (!workerJob.workspace_id && !workerJob.user_id) {
      return NextResponse.json({ error: "Import job has no tenant scope." }, {
        status: 400,
      });
    }
    scope = {
      workspaceId: workerJob.workspace_id ?? null,
      supabaseUserId: workerJob.user_id ?? null,
    };
    shops = [{ id: workerJob.shop_id }];
  } else {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      scope = await resolveRequiredTenantScope(supabase, {
        clerkUserId,
        orgId,
      });
      shops = await listScopedShops(supabase, scope, { fields: "id" });
    } catch (err: any) {
      return NextResponse.json({ error: String(err?.message ?? err) }, {
        status: 500,
      });
    }
  }
  const shopIds = shops.map((candidate) => String(candidate?.id || ""))
    .filter(Boolean);
  if (!shopIds.length) {
    return NextResponse.json({ error: "No shop found" }, { status: 400 });
  }

  let targetShopId = String(body?.shopId || body?.shop_id || "").trim();
  if (!targetShopId && mode === "continue") {
    const jobId = String(body?.jobId || "").trim();
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, {
        status: 400,
      });
    }
    const { data: scopedJob, error: scopedJobError } = await supabase
      .from("knowledge_import_jobs")
      .select("shop_id")
      .eq("id", jobId)
      .eq("provider", IMPORT_JOB_PROVIDER)
      .in("shop_id", shopIds)
      .maybeSingle();
    if (scopedJobError) {
      return NextResponse.json({ error: scopedJobError.message }, {
        status: 500,
      });
    }
    if (!scopedJob?.shop_id) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    targetShopId = String(scopedJob.shop_id);
  }
  if (!targetShopId) {
    if (shops.length !== 1) {
      return NextResponse.json({
        error: "shopId is required when multiple shops are available.",
      }, { status: 400 });
    }
    targetShopId = String(shops[0].id);
  }
  const shop = shops.find((candidate) =>
    String(candidate?.id || "") === targetShopId
  );
  if (!shop?.id) {
    return NextResponse.json(
      { error: "Shop not found in your current scope." },
      {
        status: 404,
      },
    );
  }

  // Fetch Zendesk integration scoped to workspace
  let integrationQuery = supabase
    .from("integrations")
    .select("id, config, credentials_enc")
    .eq("provider", "zendesk")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (scope?.workspaceId) {
    integrationQuery = integrationQuery.eq("workspace_id", scope.workspaceId);
  } else if (scope?.supabaseUserId) {
    integrationQuery = integrationQuery.eq("user_id", scope.supabaseUserId);
  }

  const { data: integration } = await integrationQuery.maybeSingle();
  if (!integration) {
    return NextResponse.json(
      {
        error:
          "Zendesk integration not found. Connect Zendesk in settings first.",
      },
      { status: 404 },
    );
  }

  const config = integration.config || {};
  const email = String(config.email || "").trim();
  const configuredBaseUrl = String(
    config.domain || config.base_url || config.subdomain || "",
  ).trim();
  const token = decodeCredentials(integration.credentials_enc);

  if (!email || !token || !configuredBaseUrl) {
    return NextResponse.json({ error: "Zendesk credentials incomplete." }, {
      status: 400,
    });
  }
  let baseUrl: string;
  try {
    baseUrl = normalizeZendeskBaseUrl(configuredBaseUrl, {
      allowedCustomHosts: ZENDESK_ALLOWED_HOSTS,
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, {
      status: 400,
    });
  }

  const authorization = `Basic ${
    Buffer.from(`${email}/token:${token}`).toString("base64")
  }`;

  if (mode === "estimate") {
    let total: number;
    try {
      total = await countZendeskTickets({ baseUrl, authorization });
    } catch (err: any) {
      return NextResponse.json({ error: String(err?.message ?? err) }, {
        status: 502,
      });
    }
    return NextResponse.json({ estimate: { ticketCount: total } });
  }

  if (mode === "start") {
    if (body?.confirm !== true) {
      return NextResponse.json({
        error: "confirm:true required to start import",
      }, { status: 400 });
    }

    const activeJobQuery = () =>
      supabase
        .from("knowledge_import_jobs")
        .select("*")
        .eq("provider", IMPORT_JOB_PROVIDER)
        .eq("shop_id", shop.id)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: existingJob, error: existingErr } = await activeJobQuery();
    if (existingErr) {
      return NextResponse.json({ error: existingErr.message }, { status: 500 });
    }
    if (existingJob) {
      kickZendeskImportWorker(req, existingJob.id);
      return NextResponse.json({ job: existingJob, resumed: true });
    }

    let totalCount: number;
    try {
      totalCount = await countZendeskTickets({ baseUrl, authorization });
    } catch (err: any) {
      return NextResponse.json({ error: String(err?.message ?? err) }, {
        status: 502,
      });
    }

    const { data: insertedJob, error: insertError } = await supabase
      .from("knowledge_import_jobs")
      .insert({
        provider: IMPORT_JOB_PROVIDER,
        shop_id: shop.id,
        workspace_id: scope?.workspaceId ?? null,
        user_id: scope?.supabaseUserId ?? null,
        status: "running",
        batch_size: CHUNK_TICKETS,
        imported_count: 0,
        updated_count: 0,
        skipped_count: 0,
        dropped_count: 0,
        total_count: totalCount,
      })
      .select("*")
      .single();

    if (insertError?.code === "23505") {
      const { data: raceJob, error: raceError } = await activeJobQuery();
      if (raceError || !raceJob) {
        return NextResponse.json({
          error: raceError?.message || "Import job could not be resumed.",
        }, { status: 500 });
      }
      return NextResponse.json({ job: raceJob, resumed: true });
    }
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Starting is intentionally cheap. The client invokes `continue` only
    // after this response, so job creation can never time out while importing.
    kickZendeskImportWorker(req, insertedJob.id);
    return NextResponse.json({ job: insertedJob, resumed: false }, {
      status: 201,
    });
  }

  if (mode === "continue") {
    const { data, error } = await supabase
      .from("knowledge_import_jobs")
      .select("*")
      .eq("id", String(body?.jobId || ""))
      .eq("shop_id", shop.id)
      .eq("provider", IMPORT_JOB_PROVIDER)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    let job = data;
    if (job.status !== "running") return NextResponse.json({ job });

    // A short lease lives inside the JSON cursor. Unlike an updated_at-only
    // claim, a later request can see that the current cursor is actively being
    // processed and must wait. If a serverless invocation is killed, the lease
    // expires and the exact same page can be reclaimed safely.
    const rawCursor = job.cursor && typeof job.cursor === "object"
      ? job.cursor
      : {};
    const rawAfterCreatedAt = Date.parse(
      String(rawCursor.after_created_at || ""),
    );
    const exportCursorIsFresh = typeof rawCursor.after === "string" &&
      Number.isFinite(rawAfterCreatedAt) &&
      Date.now() - rawAfterCreatedAt < 50 * 60 * 1000;
    const effectiveCursor = typeof rawCursor.status === "string" &&
        IMPORT_STATUSES.includes(rawCursor.status)
      ? {
        status: rawCursor.status,
        after: exportCursorIsFresh ? rawCursor.after : null,
        ...(exportCursorIsFresh
          ? { after_created_at: rawCursor.after_created_at }
          : {}),
      }
      : { status: IMPORT_STATUSES[0], after: null };
    const leaseExpiresAt = Date.parse(String(rawCursor.lease_expires_at || ""));
    if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
      const retryAfterMs = Math.min(
        5000,
        Math.max(1000, leaseExpiresAt - Date.now()),
      );
      if (internalAuthorized && body?.chain === true) {
        await sleep(retryAfterMs);
        kickZendeskImportWorker(
          req,
          job.id,
          Number(body?.worker_retry_count) || 0,
        );
      }
      return NextResponse.json(
        {
          error: "job busy",
          job,
          retry_after_ms: retryAfterMs,
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
      .eq("shop_id", shop.id)
      .eq("provider", IMPORT_JOB_PROVIDER)
      .eq("status", "running");
    // NB: .eq() on a jsonb column needs the filter VALUE as JSON text — passing
    // the raw object serializes as "[object Object]" and Postgres rejects it
    // with `invalid input syntax for type json` (22P02). jsonb equality is
    // structural, so a stringified round-trip compares correctly.
    claimQuery = job.cursor == null
      ? claimQuery.is("cursor", null)
      : claimQuery.eq("cursor", JSON.stringify(job.cursor));
    const { data: claimed, error: claimErr } = await claimQuery.select("*")
      .maybeSingle();
    if (claimErr) {
      return NextResponse.json({ error: claimErr.message }, { status: 500 });
    }
    if (!claimed) {
      const { data: freshJob } = await supabase
        .from("knowledge_import_jobs")
        .select("*")
        .eq("id", job.id)
        .eq("shop_id", shop.id)
        .eq("provider", IMPORT_JOB_PROVIDER)
        .maybeSingle();
      if (internalAuthorized && body?.chain === true) {
        await sleep(1500);
        kickZendeskImportWorker(
          req,
          job.id,
          Number(body?.worker_retry_count) || 0,
        );
      }
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
      const unprocessedTickets = await excludeLedgeredZendeskTickets({
        supabase,
        jobId: job.id,
        tickets,
      });

      const batchResult = await importTicketBatch({
        supabase,
        tickets: unprocessedTickets,
        baseUrl,
        authorization,
        shopId: shop.id,
        workspaceId: scope?.workspaceId ?? null,
        jobId: job.id,
      });
      const durableCounts = await recordZendeskImportItems({
        supabase,
        jobId: job.id,
        items: batchResult.items,
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
          // Absolute ledger counts stay correct across retries, lease expiry
          // and cursor resets; never increment counters from volatile state.
          imported_count: durableCounts.imported,
          updated_count: durableCounts.updated,
          skipped_count: durableCounts.skipped,
          dropped_count: durableCounts.dropped,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("shop_id", shop.id)
        .eq("provider", IMPORT_JOB_PROVIDER)
        .eq("cursor", JSON.stringify(leaseCursor))
        .select("*")
        .single();
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
      if (
        internalAuthorized && body?.chain === true &&
        updated.status === "running"
      ) {
        kickZendeskImportWorker(req, updated.id);
      }
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
        .eq("provider", IMPORT_JOB_PROVIDER)
        .eq("cursor", JSON.stringify(leaseCursor))
        .select("*")
        .maybeSingle();
      if (internalAuthorized && body?.chain === true) {
        const retryCount = Math.max(
          0,
          Number(body?.worker_retry_count) || 0,
        );
        if (retryCount < 5) {
          await sleep(2000);
          kickZendeskImportWorker(req, job.id, retryCount + 1);
        }
      }
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
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, {
      status: 500,
    });
  }

  let shops: any[];
  try {
    const scope = await resolveRequiredTenantScope(supabase, {
      clerkUserId,
      orgId,
    });
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, {
      status: 500,
    });
  }
  const shopIds = shops.map((s: any) => s.id).filter(Boolean);

  if (!shopIds.length) {
    return NextResponse.json({ error: "No shop found" }, { status: 400 });
  }

  const { error } = await supabase
    .from("ticket_examples")
    .delete()
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
