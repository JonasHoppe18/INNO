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

const SOURCE_PROVIDER = "zendesk";
const SOURCE_TYPE = "ticket";
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

/** Format a ticket pair as a knowledge chunk */
function buildContent(subject: string, customerBody: string, agentReply: string) {
  const lines: string[] = [];
  if (subject) lines.push(`Subject: ${subject}`, "");
  lines.push("Customer question:", customerBody, "", "Correct answer:", agentReply);
  return lines.join("\n").trim();
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
    .from("agent_knowledge")
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

  // Check which ticket IDs are already in the knowledge base (dedup)
  const sourceIds = pairs.map((p) => ticketHash(p.ticketId));
  const { data: existing } = await supabase
    .from("agent_knowledge")
    .select("source_id")
    .eq("shop_id", shop.id)
    .eq("source_provider", SOURCE_PROVIDER)
    .in("source_id", sourceIds);

  const existingIds = new Set((existing || []).map((r: any) => r.source_id));
  const newPairs = pairs.filter((p) => !existingIds.has(ticketHash(p.ticketId)));

  if (!newPairs.length) {
    return NextResponse.json({ imported: 0, skipped: pairs.length, message: "All tickets already imported." });
  }

  // Embed in batches
  const contents = newPairs.map((p) => buildContent(p.subject, p.customerBody, p.agentReply));
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < contents.length; i += EMBED_BATCH_SIZE) {
    const batch = contents.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
  }

  // Insert into agent_knowledge
  const rows = newPairs.map((pair, idx) => ({
    shop_id: shop.id,
    workspace_id: scope?.workspaceId ?? null,
    source_type: SOURCE_TYPE,
    source_provider: SOURCE_PROVIDER,
    source_id: ticketHash(pair.ticketId),
    chunk_index: 0,
    content: contents[idx],
    embedding: allEmbeddings[idx],
    metadata: {
      ticket_id: pair.ticketId,
      subject: pair.subject,
    },
  }));

  const { error: insertError } = await supabase
    .from("agent_knowledge")
    .upsert(rows, { onConflict: "workspace_id,shop_id,source_provider,source_id,chunk_index", ignoreDuplicates: true });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    imported: newPairs.length,
    skipped: pairs.length - newPairs.length,
    total_fetched: pairs.length,
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
    .from("agent_knowledge")
    .delete()
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
