import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";

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
const MAX_TICKETS = 200;
const EMBED_BATCH_SIZE = 50;

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
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  });
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
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
  });
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
  async function worker() {
    while (cursor < pairs.length) {
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
      } catch {
        out[idx] = null; // drop on failure — never store raw PII
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
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

  if (!shopIds.length) return NextResponse.json({ count: 0 });

  const { count } = await supabase
    .from("ticket_examples")
    .select("id", { count: "exact", head: true })
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);

  return NextResponse.json({ count: count ?? 0 });
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

  // Fetch solved + closed tickets (both statuses)
  const ticketsPerPage = 100;
  const allTickets: any[] = [];
  const seenIds = new Set<string>();

  for (const status of ["solved", "closed"]) {
    let page = 1;
    while (allTickets.length < MAX_TICKETS) {
      const res = await fetch(
        `${baseUrl}/api/v2/tickets.json?status=${status}&sort_by=created_at&sort_order=desc&per_page=${ticketsPerPage}&page=${page}`,
        { headers: { Authorization: authorization, "Content-Type": "application/json" }, cache: "no-store" }
      );
      if (!res.ok) break;
      const data = await res.json().catch(() => ({ tickets: [] }));
      const batch = Array.isArray(data.tickets) ? data.tickets : [];
      if (!batch.length) break;

      for (const t of batch) {
        if (!seenIds.has(String(t.id))) {
          seenIds.add(String(t.id));
          allTickets.push(t);
        }
      }
      if (!data.next_page || batch.length < ticketsPerPage) break;
      page++;
    }
    if (allTickets.length >= MAX_TICKETS) break;
  }

  // For each ticket, fetch comments to get customer Q + agent reply
  const NON_SUPPORT = /\b(faktura|invoice|payment reminder|påmindelse|bill|betaling)\b/i;
  const pairs: Array<{ ticketId: string; subject: string; customerBody: string; agentReply: string }> = [];

  for (const ticket of allTickets.slice(0, MAX_TICKETS)) {
    if (NON_SUPPORT.test(String(ticket.subject || ""))) continue;

    const commentsRes = await fetch(
      `${baseUrl}/api/v2/tickets/${ticket.id}/comments.json?sort_order=asc`,
      { headers: { Authorization: authorization }, cache: "no-store" }
    );
    if (!commentsRes.ok) continue;

    const { comments = [] } = await commentsRes.json().catch(() => ({ comments: [] }));
    const publicComments = comments.filter((c: any) => c.public);
    const customerComment = publicComments.find((c: any) => c.author_id === ticket.requester_id) || publicComments[0];
    const agentComment = publicComments.find((c: any) => c.author_id !== ticket.requester_id);

    if (!customerComment || !agentComment) continue;

    const customerBody = normalizeText(stripHtml(customerComment.html_body || customerComment.body || ""));
    const agentReply = normalizeText(stripHtml(agentComment.html_body || agentComment.body || ""));

    if (!customerBody || !agentReply || isAutoReply(agentReply)) continue;

    pairs.push({
      ticketId: String(ticket.id),
      subject: String(ticket.subject || "").trim(),
      customerBody: customerBody.slice(0, 2000),
      agentReply: agentReply.slice(0, 2000),
    });
  }

  if (!pairs.length) {
    return NextResponse.json({ imported: 0, skipped: 0, message: "No usable tickets found." });
  }

  // GDPR: redact PII out of every pair BEFORE embedding/storing. Tickets that
  // fail redaction are dropped so raw customer data is never persisted as a
  // few-shot example.
  const redacted = await redactPairs(pairs);
  const droppedForPii = redacted.filter((r) => r === null).length;
  const safePairs = redacted.filter((p): p is NonNullable<typeof p> => p !== null);

  if (!safePairs.length) {
    return NextResponse.json({
      imported: 0,
      skipped: pairs.length,
      message: "No tickets could be safely redacted.",
    });
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
    shop_id: shop.id,
    workspace_id: scope?.workspaceId ?? null,
    source_provider: SOURCE_PROVIDER,
    external_ticket_id: pair.ticketId,
    customer_msg: customerMsgs[idx],
    agent_reply: pair.agentReply,
    subject: pair.subject,
    embedding: allEmbeddings[idx],
    tags: ["pii_scrubbed"],
  }));

  // Dedup enforced by DB constraint (shop_id, source_provider, external_ticket_id)
  const { error: insertError } = await supabase
    .from("ticket_examples")
    .upsert(rows, { onConflict: "shop_id,source_provider,external_ticket_id", ignoreDuplicates: true });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Count how many were actually new (upsert with ignoreDuplicates skips existing)
  const { count: totalCount } = await supabase
    .from("ticket_examples")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shop.id)
    .eq("source_provider", SOURCE_PROVIDER);

  return NextResponse.json({
    imported: rows.length,
    total_in_db: totalCount ?? 0,
    total_fetched: pairs.length,
    dropped_for_pii: droppedForPii,
  });
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
