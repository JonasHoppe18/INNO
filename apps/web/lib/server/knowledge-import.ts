import { createClient } from "@supabase/supabase-js";

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

type ZendeskCursor = {
  status?: "solved" | "closed";
  next_page?: string | null;
  page?: number;
};

type GorgiasCursor = {
  page?: number;
};

type FreshdeskCursor = {
  page?: number;
};

export type KnowledgeImportJob = {
  id: string;
  provider: "zendesk" | "gorgias" | "freshdesk";
  shop_id: string;
  workspace_id: string | null;
  user_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  cursor: ZendeskCursor | Record<string, unknown> | null;
  max_tickets: number;
  batch_size: number;
  imported_count: number;
  skipped_count: number;
};

function normalizeBaseUrl(input: string) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function decodeCredentials(raw: string | null) {
  if (!raw) return "";
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
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

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now();
    if (diff > 0) return diff;
  }
  return null;
}

async function fetchZendeskWithRetry(
  input: string,
  init: RequestInit,
  context: string,
  maxRetries = 4
) {
  let attempt = 0;
  while (true) {
    const response = await fetch(input, init);
    if (response.status !== 429) return response;
    if (attempt >= maxRetries) return response;

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const backoffMs = Math.min(12000, 1000 * 2 ** attempt);
    const waitMs = Math.max(800, retryAfterMs ?? backoffMs);
    console.warn(`[knowledge-import] Zendesk rate limit in ${context}; retrying in ${waitMs}ms`);
    await sleep(waitMs);
    attempt += 1;
  }
}

function isLowQualityContent(content: string) {
  const lower = normalizeText(content).toLowerCase();
  if (!lower) return true;
  if (lower.length < 60) return true;
  const noisePatterns = [
    "this is an automated reply",
    "we have received your request",
    "thank you for contacting us",
    "auto-reply",
    "out of office",
  ];
  if (noisePatterns.some((pattern) => lower.includes(pattern))) return true;
  return false;
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
      input: input.slice(0, 4000),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Embedding request failed (${response.status}).`);
  }
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("Embedding vector was not returned.");
  return vector;
}

function buildZendeskAuthHeader(email: string, token: string) {
  const basic = Buffer.from(`${email}/token:${token}`).toString("base64");
  return `Basic ${basic}`;
}

function buildZendeskSearchUrl(baseUrl: string, status: "solved" | "closed", page: number, perPage: number) {
  const query = encodeURIComponent(`type:ticket status:${status}`);
  return `${baseUrl}/api/v2/search.json?query=${query}&sort_by=updated_at&sort_order=desc&page=${page}&per_page=${perPage}`;
}

function nextZendeskCursor(current: ZendeskCursor, payload: any): ZendeskCursor | null {
  const status: "solved" | "closed" = current.status === "closed" ? "closed" : "solved";
  if (payload?.next_page) {
    return {
      status,
      next_page: String(payload.next_page),
      page: undefined,
    };
  }
  if (status === "solved") {
    return { status: "closed", page: 1, next_page: null };
  }
  return null;
}

function initialZendeskCursor(): ZendeskCursor {
  return { status: "solved", page: 1, next_page: null };
}

async function fetchZendeskBatch(options: {
  baseUrl: string;
  authorization: string;
  cursor: ZendeskCursor | null;
  batchSize: number;
}) {
  const cursor = options.cursor || initialZendeskCursor();
  const status: "solved" | "closed" = cursor.status === "closed" ? "closed" : "solved";
  const page = Number(cursor.page || 1);
  const searchUrl = cursor.next_page
    ? String(cursor.next_page)
    : buildZendeskSearchUrl(options.baseUrl, status, page, options.batchSize);

  const response = await fetchZendeskWithRetry(
    searchUrl,
    {
      headers: {
        Authorization: options.authorization,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
    "ticket-search"
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error ||
        payload?.description ||
        payload?.message ||
        `Zendesk ticket fetch failed (${response.status}).`
    );
  }

  const tickets = Array.isArray(payload?.results) ? payload.results : [];
  const nextCursor = nextZendeskCursor({ ...cursor, status }, payload);
  return { tickets, nextCursor };
}

async function fetchIntegrationForJob(
  serviceClient: any,
  job: KnowledgeImportJob
): Promise<{
  id: string;
  config: Record<string, unknown> | null;
  credentials_enc: string | null;
}> {
  let query = serviceClient
    .from("integrations")
    .select("id, config, credentials_enc, is_active")
    .eq("provider", job.provider)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (job.workspace_id) {
    query = query.eq("workspace_id", job.workspace_id);
  } else {
    query = query.eq("user_id", job.user_id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read ${job.provider} integration: ${error.message}`);
  if (!data?.id) throw new Error(`${job.provider} integration not found for this scope.`);
  return data;
}

async function fetchTicketConversation(
  baseUrl: string,
  authorization: string,
  ticket: any
) {
  const ticketId = ticket?.id;
  if (!ticketId) return null;
  const commentsUrl = `${baseUrl}/api/v2/tickets/${ticketId}/comments.json?sort_order=asc`;
  const commentsResponse = await fetchZendeskWithRetry(
    commentsUrl,
    {
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
    "ticket-comments"
  );
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
  // content = agent reply only (brugt til few-shot i writer)
  // customer_msg gemmes i metadata og bruges som embedding-kilde så
  // lignende kundespørgsmål matches semantisk
  const customerMsg = `${subject}\n${firstComment || ""}`.trim();

  return {
    content: lastAgentReply || "",
    embedOn: customerMsg,
    metadata: {
      external_ticket_id: String(ticketId),
      subject,
      customer_msg: customerMsg,
      status: ticket?.status || null,
      url: ticket?.url || (ticket?.id ? `${baseUrl}/agent/tickets/${ticket.id}` : null),
      requester_id: requesterId,
      source: "zendesk",
      updated_at: ticket?.updated_at || null,
    },
  };
}

async function isAlreadyImported(
  serviceClient: any,
  shopId: string,
  provider: string,
  externalTicketId: string
) {
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("id")
    .eq("shop_id", shopId)
    .eq("source_provider", provider)
    .eq("metadata->>external_ticket_id", externalTicketId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

async function updateIntegrationConfig(
  serviceClient: any,
  integrationId: string,
  baseConfig: Record<string, unknown> | null,
  patch: Record<string, unknown>
) {
  await serviceClient
    .from("integrations")
    .update({
      config: {
        ...(baseConfig || {}),
        ...patch,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId);
}

export function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function buildGorgiasAuthHeader(email: string, apiKey: string) {
  return `Basic ${Buffer.from(`${email}:${apiKey}`).toString("base64")}`;
}

function buildFreshdeskAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:X`).toString("base64")}`;
}

async function fetchGorgiasBatch(options: {
  baseUrl: string;
  authorization: string;
  cursor: GorgiasCursor | null;
  batchSize: number;
}) {
  const page = Number(options.cursor?.page || 1);
  const url = `${options.baseUrl}/api/tickets?status=closed&limit=${options.batchSize}&page=${page}`;
  const response = await fetch(url, {
    headers: {
      Authorization: options.authorization,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        payload?.message ||
        `Gorgias ticket fetch failed (${response.status}).`
    );
  }
  const tickets = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.tickets)
      ? payload.tickets
      : [];
  const hasNext = tickets.length >= options.batchSize;
  return {
    tickets,
    nextCursor: hasNext ? { page: page + 1 } : null,
  };
}

async function fetchFreshdeskBatch(options: {
  baseUrl: string;
  authorization: string;
  cursor: FreshdeskCursor | null;
  batchSize: number;
}) {
  const page = Number(options.cursor?.page || 1);
  const url = `${options.baseUrl}/api/v2/tickets?filter=resolved&per_page=${options.batchSize}&page=${page}`;
  const response = await fetch(url, {
    headers: {
      Authorization: options.authorization,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.description ||
        payload?.message ||
        payload?.error ||
        `Freshdesk ticket fetch failed (${response.status}).`
    );
  }
  const tickets = Array.isArray(payload) ? payload : [];
  const hasNext = tickets.length >= options.batchSize;
  return {
    tickets,
    nextCursor: hasNext ? { page: page + 1 } : null,
  };
}

async function fetchGorgiasConversation(
  baseUrl: string,
  authorization: string,
  ticket: any
) {
  const ticketId = ticket?.id;
  if (!ticketId) return null;
  const messagesUrl = `${baseUrl}/api/tickets/${ticketId}/messages?limit=50`;
  const response = await fetch(messagesUrl, {
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return null;
  const messages = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.messages)
      ? payload.messages
      : [];
  const cleaned = messages
    .map((message: any) => ({
      ...message,
      body: stripHtml(message?.body_text || message?.body_html || message?.body || ""),
    }))
    .filter((message: any) => message.body);
  const firstCustomer =
    cleaned.find((msg: any) => msg?.from_agent === false || msg?.sender?.role === "customer")?.body ||
    cleaned[0]?.body ||
    stripHtml(ticket?.messages?.[0]?.body || ticket?.customer_message || "");
  const lastAgent =
    cleaned
      .slice()
      .reverse()
      .find((msg: any) => msg?.from_agent === true || msg?.sender?.role === "agent")?.body ||
    "";
  if (!firstCustomer && !lastAgent) return null;
  const subject = String(ticket?.subject || `Ticket #${ticketId}`).trim();
  const customerMsg = `${subject}\n${firstCustomer || ""}`.trim();
  return {
    content: lastAgent || "",
    embedOn: customerMsg,
    metadata: {
      external_ticket_id: String(ticketId),
      subject,
      customer_msg: customerMsg,
      status: ticket?.status || null,
      url: ticket?.url || null,
      source: "gorgias",
      updated_at: ticket?.updated_datetime || null,
    },
  };
}

async function fetchFreshdeskConversation(
  baseUrl: string,
  authorization: string,
  ticket: any
) {
  const ticketId = ticket?.id;
  if (!ticketId) return null;
  const convUrl = `${baseUrl}/api/v2/tickets/${ticketId}/conversations`;
  const response = await fetch(convUrl, {
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  const conversations = response.ok && Array.isArray(payload) ? payload : [];

  const firstCustomer = stripHtml(ticket?.description_text || ticket?.description || "");
  const lastAgent =
    conversations
      .slice()
      .reverse()
      .map((item: any) => ({
        ...item,
        body: stripHtml(item?.body_text || item?.body || ""),
      }))
      .find((item: any) => item?.incoming === false && item?.body)?.body || "";
  if (!firstCustomer && !lastAgent) return null;
  const subject = String(ticket?.subject || `Ticket #${ticketId}`).trim();
  const customerMsg = `${subject}\n${firstCustomer || ""}`.trim();
  return {
    content: lastAgent || "",
    embedOn: customerMsg,
    metadata: {
      external_ticket_id: String(ticketId),
      subject,
      customer_msg: customerMsg,
      status: ticket?.status || null,
      url: ticket?.url || null,
      source: "freshdesk",
      updated_at: ticket?.updated_at || null,
    },
  };
}

export async function processImportJobBatch(serviceClient: any, job: KnowledgeImportJob) {
  const integration = await fetchIntegrationForJob(serviceClient, job);
  const config = (integration?.config || {}) as Record<string, unknown>;
  const baseUrl = normalizeBaseUrl(String(config?.domain || config?.url || ""));
  const email = String(config?.email || "").trim();
  const token = decodeCredentials(integration?.credentials_enc || null);
  if (!baseUrl || !token) {
    throw new Error(`${job.provider} integration is missing domain/token.`);
  }

  let batchSize = Math.max(1, Math.min(job.batch_size || 50, 100));
  // Zendesk rate limits aggressively on search + comments endpoints.
  if (job.provider === "zendesk") {
    batchSize = Math.min(batchSize, 20);
  }
  let tickets: any[] = [];
  let nextCursor: Record<string, unknown> | null = null;
  let authorization = "";
  const cursor = (job.cursor || null) as any;
  if (job.provider === "zendesk") {
    if (!email) throw new Error("Zendesk integration is missing email.");
    authorization = buildZendeskAuthHeader(email, token);
    const batch = await fetchZendeskBatch({
      baseUrl,
      authorization,
      cursor: cursor as ZendeskCursor | null,
      batchSize,
    });
    tickets = batch.tickets;
    nextCursor = batch.nextCursor as Record<string, unknown> | null;
  } else if (job.provider === "gorgias") {
    if (!email) throw new Error("Gorgias integration is missing email.");
    authorization = buildGorgiasAuthHeader(email, token);
    const batch = await fetchGorgiasBatch({
      baseUrl,
      authorization,
      cursor: cursor as GorgiasCursor | null,
      batchSize,
    });
    tickets = batch.tickets;
    nextCursor = batch.nextCursor as Record<string, unknown> | null;
  } else if (job.provider === "freshdesk") {
    authorization = buildFreshdeskAuthHeader(token);
    const batch = await fetchFreshdeskBatch({
      baseUrl,
      authorization,
      cursor: cursor as FreshdeskCursor | null,
      batchSize,
    });
    tickets = batch.tickets;
    nextCursor = batch.nextCursor as Record<string, unknown> | null;
  }

  let imported = 0;
  let skipped = 0;
  const remaining = Math.max(0, (job.max_tickets || 1000) - (job.imported_count || 0));
  const scopedTickets = tickets.slice(0, remaining);

  for (const ticket of scopedTickets) {
    const externalTicketId = String(ticket?.id || "");
    if (!externalTicketId) {
      skipped += 1;
      continue;
    }
    if (await isAlreadyImported(serviceClient, job.shop_id, job.provider, externalTicketId)) {
      skipped += 1;
      continue;
    }

    let record: { content: string; metadata: Record<string, unknown> } | null = null;
    if (job.provider === "zendesk") {
      record = await fetchTicketConversation(baseUrl, authorization, ticket);
    } else if (job.provider === "gorgias") {
      record = await fetchGorgiasConversation(baseUrl, authorization, ticket);
    } else if (job.provider === "freshdesk") {
      record = await fetchFreshdeskConversation(baseUrl, authorization, ticket);
    }
    if (!record?.content) {
      skipped += 1;
      continue;
    }
    if (isLowQualityContent(record.content)) {
      skipped += 1;
      continue;
    }

    try {
      // Embed på kunde-beskeden (embedOn) så semantisk søgning matcher
      // lignende kundespørgsmål — ikke på agent-svaret
      const textToEmbed = (record as any).embedOn || record.content;
      const embedding = await embedText(textToEmbed);
      const { error } = await serviceClient.from("agent_knowledge").insert({
        shop_id: job.shop_id,
        content: record.content,
        source_type: "ticket",
        source_provider: job.provider,
        metadata: record.metadata,
        embedding,
      });
      if (error) {
        skipped += 1;
      } else {
        imported += 1;
      }
    } catch (_error) {
      skipped += 1;
    }
  }

  const totalImported = (job.imported_count || 0) + imported;
  const totalSkipped = (job.skipped_count || 0) + skipped;
  const capped = totalImported >= (job.max_tickets || 1000);
  const completed = capped || !nextCursor || !tickets.length;
  const status: KnowledgeImportJob["status"] = completed ? "completed" : "running";

  const { data: updatedJob, error: updateJobError } = await serviceClient
    .from("knowledge_import_jobs")
    .update({
      status,
      cursor: completed ? {} : nextCursor,
      imported_count: totalImported,
      skipped_count: totalSkipped,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id)
    .select("*")
    .maybeSingle();
  if (updateJobError) {
    throw new Error(`Could not update import job: ${updateJobError.message}`);
  }

  await updateIntegrationConfig(serviceClient, integration.id, integration.config, {
    import_status: completed ? "completed" : "running",
    import_completed: completed,
    last_import_count: totalImported,
    last_import_skipped: totalSkipped,
    last_import_at: completed ? new Date().toISOString() : null,
    import_error: null,
  });

  return {
    job: updatedJob as KnowledgeImportJob,
    imported,
    skipped,
    completed,
  };
}
