import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

type SupportedProvider = "zendesk" | "gorgias";

type ImportCredentials = {
  url?: string;
  token?: string;
  email?: string;
  username?: string;
  auth_header?: string;
  domain?: string;
  api_key?: string;
};

type TicketKnowledgeItem = {
  content: string;
  metadata: Record<string, unknown>;
};

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function normalizeBaseUrl(input: string) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function stripHtml(value: unknown) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function truncate(value: string, max = 4000) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function buildZendeskAuthHeader(credentials: ImportCredentials) {
  if (credentials.auth_header?.trim()) return credentials.auth_header.trim();
  const token = credentials.token?.trim();
  const identity = credentials.email?.trim() || credentials.username?.trim();
  if (identity && token) {
    const basic = Buffer.from(`${identity}/token:${token}`).toString("base64");
    return `Basic ${basic}`;
  }
  if (token) return `Bearer ${token}`;
  return "";
}

async function embedText(input: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing.");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: truncate(input, 4000),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = payload?.error?.message || `Embedding request failed (${response.status}).`;
    throw new Error(reason);
  }
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("Embedding vector was not returned.");
  return vector;
}

async function fetchZendeskClosedTickets(
  credentials: ImportCredentials,
  limit = 20
): Promise<TicketKnowledgeItem[]> {
  const baseUrl = normalizeBaseUrl(credentials.url || "");
  const authorization = buildZendeskAuthHeader(credentials);

  if (!baseUrl || !authorization) {
    throw new Error("Zendesk credentials require url and token (and usually email).");
  }

  const perPage = Math.max(1, Math.min(limit, 100));
  const statuses = ["solved", "closed"];
  const allTickets: any[] = [];
  const seenTicketIds = new Set<string>();

  for (const status of statuses) {
    const searchQuery = encodeURIComponent(`type:ticket status:${status}`);
    const searchUrl = `${baseUrl}/api/v2/search.json?query=${searchQuery}&sort_by=updated_at&sort_order=desc&per_page=${perPage}`;
    const ticketsResponse = await fetch(searchUrl, {
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const ticketsPayload = await ticketsResponse.json().catch(() => null);
    if (!ticketsResponse.ok) {
      const reason =
        ticketsPayload?.error ||
        ticketsPayload?.description ||
        `Zendesk ticket fetch failed (${ticketsResponse.status}).`;
      throw new Error(reason);
    }

    const tickets = Array.isArray(ticketsPayload?.results) ? ticketsPayload.results : [];
    for (const ticket of tickets) {
      const ticketId = String(ticket?.id || "");
      if (!ticketId || seenTicketIds.has(ticketId)) continue;
      seenTicketIds.add(ticketId);
      allTickets.push(ticket);
    }
  }

  const scopedTickets = allTickets.slice(0, perPage);

  const items = await Promise.all(
    scopedTickets.map(async (ticket: any): Promise<TicketKnowledgeItem | null> => {
      const ticketId = ticket?.id;
      if (!ticketId) return null;

      const commentsUrl = `${baseUrl}/api/v2/tickets/${ticketId}/comments.json?sort_order=asc`;
      const commentsResponse = await fetch(commentsUrl, {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });
      const commentsPayload = await commentsResponse.json().catch(() => null);
      if (!commentsResponse.ok) return null;

      const comments = Array.isArray(commentsPayload?.comments) ? commentsPayload.comments : [];
      const cleanedComments = comments
        .map((comment: any) => ({
          ...comment,
          body: stripHtml(comment?.plain_body || comment?.body || comment?.html_body || ""),
        }))
        .filter((comment: any) => comment.body);

      const firstComment = cleanedComments[0]?.body || stripHtml(ticket?.description || "");
      const requesterId = ticket?.requester_id ?? null;
      const lastAgentReply =
        cleanedComments
          .slice()
          .reverse()
          .find((comment: any) => comment?.author_id && comment.author_id !== requesterId)?.body ||
        cleanedComments[cleanedComments.length - 1]?.body ||
        "";

      if (!firstComment && !lastAgentReply) return null;

      const subject = String(ticket?.subject || `Ticket #${ticketId}`).trim();
      const content = `Q: ${subject}\n${firstComment || "(No customer message)"}\n\nA: ${
        lastAgentReply || "(No agent reply)"
      }`;

      return {
        content,
        metadata: {
          external_ticket_id: String(ticketId),
          subject,
          status: ticket?.status || null,
          url:
            ticket?.url ||
            (ticket?.id ? `${baseUrl}/agent/tickets/${ticket.id}` : null),
          requester_id: requesterId,
          source: "zendesk",
        },
      };
    })
  );

  return items.filter((item): item is TicketKnowledgeItem => Boolean(item));
}

async function fetchGorgiasClosedTicketsStub(
  _credentials: ImportCredentials,
  _limit = 20
): Promise<TicketKnowledgeItem[]> {
  return [];
}

async function resolveShopId(
  serviceClient: any,
  scope: { workspaceId: string | null; supabaseUserId: string | null },
  requestedShopId?: string
) {
  if (requestedShopId?.trim()) {
    let scopedQuery = serviceClient
      .from("shops")
      .select("id")
      .eq("id", requestedShopId.trim())
      .limit(1);
    scopedQuery = applyScope(scopedQuery, scope, {
      workspaceColumn: "workspace_id",
      userColumn: "owner_user_id",
    });
    const { data, error } = await scopedQuery.maybeSingle();
    const row = (data || null) as { id?: string } | null;
    if (error) throw new Error(`Could not verify shop scope: ${error.message}`);
    if (!row?.id) throw new Error("Shop not found in your workspace scope.");
    return row.id;
  }

  let latestQuery = serviceClient
    .from("shops")
    .select("id")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  latestQuery = applyScope(latestQuery, scope, {
    workspaceColumn: "workspace_id",
    userColumn: "owner_user_id",
  });

  const { data, error } = await latestQuery.maybeSingle();
  const row = (data || null) as { id?: string } | null;
  if (error) throw new Error(`Could not resolve active shop: ${error.message}`);
  if (!row?.id) throw new Error("No active shop found for this workspace/user.");
  return row.id;
}

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const provider = String(body?.provider || "")
    .trim()
    .toLowerCase() as SupportedProvider;
  const credentials = (body?.credentials || {}) as ImportCredentials;
  const requestedShopId = typeof body?.shop_id === "string" ? body.shop_id : undefined;
  const limit = Number.isFinite(Number(body?.limit)) ? Number(body.limit) : 20;

  if (!["zendesk", "gorgias"].includes(provider)) {
    return NextResponse.json(
      { error: "provider must be one of: zendesk, gorgias." },
      { status: 400 }
    );
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId: orgId || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve workspace scope." },
      { status: 500 }
    );
  }

  if (!scope.workspaceId && !scope.supabaseUserId) {
    return NextResponse.json({ error: "No workspace/user scope found." }, { status: 400 });
  }

  let shopId: string;
  try {
    shopId = await resolveShopId(serviceClient, scope, requestedShopId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve shop." },
      { status: 404 }
    );
  }

  let importedItems: TicketKnowledgeItem[] = [];
  try {
    switch (provider) {
      case "zendesk":
        importedItems = await fetchZendeskClosedTickets(credentials, limit);
        break;
      case "gorgias":
        importedItems = await fetchGorgiasClosedTicketsStub(credentials, limit);
        break;
      default:
        importedItems = [];
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Provider import failed." },
      { status: 400 }
    );
  }

  if (!importedItems.length) {
    return NextResponse.json({
      success: true,
      provider,
      shop_id: shopId,
      imported: 0,
      skipped: 0,
    });
  }

  let inserted = 0;
  let skipped = 0;

  for (const item of importedItems) {
    const content = String(item.content || "").trim();
    if (!content) {
      skipped += 1;
      continue;
    }

    try {
      const embedding = await embedText(content);
      const { error } = await serviceClient.from("agent_knowledge").insert({
        shop_id: shopId,
        content,
        source_type: "ticket",
        source_provider: provider,
        metadata: item.metadata || {},
        embedding,
      });

      if (error) {
        skipped += 1;
      } else {
        inserted += 1;
      }
    } catch (_error) {
      skipped += 1;
    }
  }

  return NextResponse.json({
    success: true,
    provider,
    shop_id: shopId,
    imported: inserted,
    skipped,
  });
}
