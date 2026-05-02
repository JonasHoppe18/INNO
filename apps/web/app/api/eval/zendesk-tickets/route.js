import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function decodeCredentials(raw) {
  if (!raw) return "";
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return raw;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAutoReply(text) {
  const lower = String(text || "").toLowerCase();
  return (
    lower.includes("this is an automated reply") ||
    lower.includes("we have received your request") ||
    lower.includes("thank you for contacting us") ||
    lower.includes("auto-reply") ||
    lower.includes("out of office") ||
    lower.length < 30
  );
}

export async function GET(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Fetch Zendesk integration scoped to current workspace/user
  let integrationQuery = supabase
    .from("integrations")
    .select("id, config, credentials_enc")
    .eq("provider", "zendesk")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (scope?.workspaceId) integrationQuery = integrationQuery.eq("workspace_id", scope.workspaceId);
  else if (scope?.supabaseUserId) integrationQuery = integrationQuery.eq("user_id", scope.supabaseUserId);

  const { data: integration, error: intError } = await integrationQuery.maybeSingle();
  if (intError || !integration) {
    return NextResponse.json({ error: "Zendesk integration not found for this shop. Connect Zendesk in settings first." }, { status: 404 });
  }

  const config = integration.config || {};
  const email = String(config.email || "").trim();
  const baseUrl = String(config.domain || config.base_url || config.subdomain || "").replace(/\/$/, "");
  const token = decodeCredentials(integration.credentials_enc);

  if (!email || !token || !baseUrl) {
    return NextResponse.json({ error: "Zendesk credentials incomplete. Reconnect Zendesk in settings." }, { status: 400 });
  }

  const authorization = `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || "30"), 150);
  const zendeskPageSize = Math.min(limit, 100);

  // Fetch solved + closed tickets (Zendesk auto-closes solved tickets after a period)
  const [solvedRes, closedRes] = await Promise.all([
    fetch(`${baseUrl}/api/v2/tickets.json?status=solved&sort_by=created_at&sort_order=desc&per_page=${zendeskPageSize}`, {
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      cache: "no-store",
    }),
    fetch(`${baseUrl}/api/v2/tickets.json?status=closed&sort_by=created_at&sort_order=desc&per_page=${zendeskPageSize}`, {
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      cache: "no-store",
    }),
  ]);

  if (!solvedRes.ok && !closedRes.ok) {
    const err = await solvedRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: `Zendesk API error: ${err?.error || solvedRes.status}` },
      { status: solvedRes.status }
    );
  }

  const [solvedData, closedData] = await Promise.all([
    solvedRes.ok ? solvedRes.json().catch(() => ({ tickets: [] })) : { tickets: [] },
    closedRes.ok ? closedRes.json().catch(() => ({ tickets: [] })) : { tickets: [] },
  ]);

  // Merge, deduplicate by id, and sort by created_at descending
  const seenIds = new Set();
  const NON_SUPPORT_PATTERNS = /\b(faktura|invoice|payment reminder|påmindelse|bill|betaling|regning|bolls)\b/i;
  const tickets = [...(solvedData.tickets || []), ...(closedData.tickets || [])]
    .filter((t) => {
      if (seenIds.has(t.id)) return false;
      seenIds.add(t.id);
      // Filter out invoices and non-support tickets by subject
      if (NON_SUPPORT_PATTERNS.test(String(t.subject || ""))) return false;
      return true;
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);

  const results = [];

  for (const ticket of tickets) {
    const ticketId = ticket.id;
    const subject = String(ticket.subject || "").trim();

    // Fetch comments for this ticket
    const commentsUrl = `${baseUrl}/api/v2/tickets/${ticketId}/comments.json?sort_order=asc`;
    const commentsRes = await fetch(commentsUrl, {
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!commentsRes.ok) continue;

    const { comments = [] } = await commentsRes.json().catch(() => ({ comments: [] }));

    // Build full conversation from public comments
    const publicComments = comments.filter((c) => c.public);
    const conversation = publicComments
      .map((c) => ({
        role: c.author_id === ticket.requester_id ? "customer" : "agent",
        body: stripHtml(c.html_body || c.body || "").trim(),
      }))
      .filter((c) => c.body.length > 0 && !isAutoReply(c.body));

    if (conversation.length < 2) continue;

    // Last customer message = what we're replying to
    const lastCustomerIdx = conversation.map((c, i) => (c.role === "customer" ? i : -1)).filter((i) => i >= 0).pop();
    if (lastCustomerIdx === undefined) continue;
    const lastCustomerMessage = conversation[lastCustomerIdx];

    // First substantive agent reply
    const agentMessage = conversation.find((c) => c.role === "agent");
    if (!agentMessage) continue;

    // Everything before the last customer message = conversation history
    const priorMessages = conversation.slice(0, lastCustomerIdx);
    const conversationHistory = priorMessages.length > 0
      ? priorMessages.map((m) => `${m.role === "customer" ? "Customer" : "Agent"}: ${m.body}`).join("\n\n")
      : null;

    const customerBody = lastCustomerMessage.body;
    const agentBody = agentMessage.body;

    if (!customerBody || !agentBody) continue;

    results.push({
      id: String(ticketId),
      subject,
      customer_body: customerBody.slice(0, 3000),
      human_reply: agentBody.slice(0, 3000),
      conversation_history: conversationHistory ? conversationHistory.slice(0, 3000) : null,
      created_at: ticket.created_at,
    });

    if (results.length >= limit) break;
  }

  return NextResponse.json({ tickets: results, fetched: results.length, requested: limit });
}
