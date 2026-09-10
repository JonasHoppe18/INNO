import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { listScopedShops, resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { resolveShopifyCredentialsWithDiagnostics } from "@/lib/server/shopify-credentials";
import {
  runGreenfieldAgentWithAgentsSdk,
  PlaygroundDryRunExecutor,
  Ship24ReadOnlyProvider,
  ShopifyReadOnlyProvider,
  SupabaseKnowledgeStore,
} from "@/lib/greenfield-support";
import {
  GREENFIELD_PLAYGROUND_HISTORY_LIMIT,
  historyFromPlaygroundRows,
  isGreenfieldPlaygroundEnabled,
  isGreenfieldPlaygroundTicketRequired,
  isGreenfieldPlaygroundProduction,
  isInternalGreenfieldPlaygroundUser,
  isOwnedPlaygroundSession,
  normalizePlaygroundContext,
  normalizePlaygroundCustomerEmail,
  normalizePlaygroundCustomerName,
  normalizePlaygroundMessage,
  publicPlaygroundMessage,
  publicPlaygroundSession,
  sanitizeGreenfieldTrace,
  greenfieldPlaygroundEnvironment,
} from "@/lib/server/greenfield-playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSIONS_TABLE = "greenfield_playground_sessions";
const MESSAGES_TABLE = "greenfield_playground_messages";

const SUPABASE_URL = String(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
).replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function createServiceClient() {
  return SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
}

function createGreenfieldTrackingProvider() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return new Ship24ReadOnlyProvider();
  return new Ship24ReadOnlyProvider({
    requestImpl: async (trackingNumber: string, carrierHint?: string | null) => {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/fetch-tracking`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trackingNumber, company: carrierHint || "" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`Tracking function returned ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return body;
    },
  });
}

function safeFailureResponse() {
  return NextResponse.json(
    { error: "The playground could not complete this read-only request. Try again." },
    { status: 500 },
  );
}

async function requirePlaygroundRequest() {
  if (!isGreenfieldPlaygroundEnabled()) {
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  const authState = await auth();
  if (!authState?.userId) {
    return { response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return { response: NextResponse.json({ error: "The playground service is not configured." }, { status: 503 }) };
  }
  const scope = await resolveAuthScope(serviceClient, {
    clerkUserId: authState.userId,
    orgId: authState.orgId,
    sessionClaims: authState.sessionClaims,
  });
  if (!scope?.workspaceId) {
    return { response: NextResponse.json({ error: "A single active workspace is required." }, { status: 404 }) };
  }
  if (isGreenfieldPlaygroundProduction() && !(await isInternalGreenfieldPlaygroundUser(serviceClient, { workspaceId: scope.workspaceId, clerkUserId: authState.userId }))) {
    return { response: NextResponse.json({ error: "The playground is limited to internal workspace administrators." }, { status: 403 }) };
  }
  return { authState, serviceClient, scope };
}

async function loadSession(serviceClient: any, scope: any, clerkUserId: string, sessionId: string) {
  const { data, error } = await serviceClient
    .from(SESSIONS_TABLE)
    .select("id, workspace_id, owner_clerk_user_id, customer_email, title, conversation_context_json, created_at, updated_at")
    .eq("id", sessionId)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data && isOwnedPlaygroundSession(data, { workspaceId: scope.workspaceId, clerkUserId }) ? data : null;
}

async function loadMessages(serviceClient: any, scope: any, clerkUserId: string, sessionId: string) {
  const { data, error } = await serviceClient
    .from(MESSAGES_TABLE)
    .select("id, role, content, trace_json, created_at")
    .eq("session_id", sessionId)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(GREENFIELD_PLAYGROUND_HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? [...data].reverse() : [];
}

async function resolveVisibleShop(serviceClient: any, scope: any) {
  try {
    return await resolveScopedShop(serviceClient, scope, undefined, {
      fields: "id, workspace_id, shop_domain",
      platform: "shopify",
      allowSingleScopedFallback: true,
      missingShopMessage: "No active Shopify store is available in this workspace.",
    });
  } catch {
    return null;
  }
}

async function requireShopAndCredentials(serviceClient: any, scope: any) {
  const shop = await resolveScopedShop(serviceClient, scope, undefined, {
    fields: "id, workspace_id, shop_domain",
    platform: "shopify",
    allowSingleScopedFallback: true,
    missingShopMessage: "Exactly one active Shopify store is required for this read-only test.",
  });
  const credentials = await resolveShopifyCredentialsWithDiagnostics(serviceClient, scope, {
    requestedShopId: shop.id,
    reason: "greenfield_playground_read_only",
  });
  return { shop, credentials };
}

async function listSessions(serviceClient: any, scope: any, clerkUserId: string) {
  const { data, error } = await serviceClient
    .from(SESSIONS_TABLE)
    .select("id, workspace_id, owner_clerk_user_id, customer_email, title, created_at, updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_clerk_user_id", clerkUserId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadScopedTicket(serviceClient: any, scope: any, threadId: string) {
  const shops = await listScopedShops(serviceClient, scope, { fields: "id" });
  const shopIds = new Set((shops || []).map((shop: any) => String(shop.id)));

  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .select("id, subject, mailbox_id, customer_email, customer_name")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError) throw new Error(threadError.message);
  if (!thread) return null;

  const { data: mailbox, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select("shop_id")
    .eq("id", thread.mailbox_id)
    .maybeSingle();
  if (mailboxError) throw new Error(mailboxError.message);
  const shopId = String(mailbox?.shop_id || "");
  if (!shopId || !shopIds.has(shopId)) return null;

  const { data: rows, error: messagesError } = await serviceClient
    .from("mail_messages")
    .select("from_me, is_draft, provider_message_id, clean_body_text, body_text, snippet, from_name, extracted_customer_name, from_email, extracted_customer_email, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (messagesError) throw new Error(messagesError.message);

  const messages = (rows || [])
    .filter((row: any) => row?.is_draft !== true && !String(row?.provider_message_id || "").startsWith("internal-note:"))
    .map((row: any) => ({
      role: row.from_me ? "assistant" : "user",
      comparison_only: row.from_me === true,
      content: String(row.clean_body_text || row.body_text || row.snippet || "")
        .replace(/\s+/g, " ")
        .trim(),
      created_at: row.created_at || null,
    }))
    .filter((message: any) => message.content.length > 0);

  let customerEmail = String(thread.customer_email || "").trim().toLowerCase() || null;
  let customerFirstName = normalizePlaygroundCustomerName(thread.customer_name);
  if (!customerFirstName) {
    const latestInboundRow = [...(rows || [])].reverse().find((row: any) => (
      row.from_me === false &&
      row.is_draft !== true &&
      !String(row?.provider_message_id || "").startsWith("internal-note:")
    ));
    customerFirstName = normalizePlaygroundCustomerName(latestInboundRow?.extracted_customer_name || latestInboundRow?.from_name);
  }
  if (!customerEmail) {
    const { data: latestInbound, error: inboundError } = await serviceClient
      .from("mail_messages")
      .select("from_email, extracted_customer_email, from_name, extracted_customer_name")
      .eq("thread_id", threadId)
      .eq("from_me", false)
      .eq("is_draft", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inboundError) throw new Error(inboundError.message);
    customerEmail = String(latestInbound?.extracted_customer_email || latestInbound?.from_email || "").trim().toLowerCase() || null;
    if (!customerFirstName) customerFirstName = normalizePlaygroundCustomerName(latestInbound?.extracted_customer_name || latestInbound?.from_name);
  }

  return {
    threadId,
    subject: String(thread.subject || "").trim() || "Imported ticket",
    customerEmail,
    customerFirstName,
    messages,
  };
}

async function listScopedTicketSummaries(serviceClient: any, scope: any, { search = "", limit = 50 } = {}) {
  const shops = await listScopedShops(serviceClient, scope, { fields: "id" });
  const shopIds = (shops || []).map((shop: any) => String(shop.id || "")).filter(Boolean);
  if (!shopIds.length) return [];

  const { data: mailboxes, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select("id, shop_id")
    .in("shop_id", shopIds);
  if (mailboxError) throw new Error(mailboxError.message);
  const mailboxIds = (mailboxes || []).map((mailbox: any) => String(mailbox.id || "")).filter(Boolean);
  if (!mailboxIds.length) return [];

  const normalizedSearch = String(search || "")
    .trim()
    .replace(/^#/, "")
    .replace(/[,()%*\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 5), 100);
  let query = serviceClient
    .from("mail_threads")
    .select("id, subject, snippet, last_message_at, customer_email, mailbox_id, ticket_number")
    .in("mailbox_id", mailboxIds);

  if (normalizedSearch) {
    if (/^\d+$/.test(normalizedSearch)) {
      query = query.eq("ticket_number", Number(normalizedSearch));
    } else if (/^[0-9a-f-]{36}$/i.test(normalizedSearch)) {
      query = query.eq("id", normalizedSearch);
    } else {
      query = query.or(`subject.ilike.%${normalizedSearch}%,snippet.ilike.%${normalizedSearch}%,customer_email.ilike.%${normalizedSearch}%`);
    }
  }

  const { data: threads, error: threadError } = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(safeLimit);
  if (threadError) throw new Error(threadError.message);

  const shopIdByMailbox = new Map((mailboxes || []).map((mailbox: any) => [String(mailbox.id), String(mailbox.shop_id)]));
  return (threads || []).map((thread: any) => ({
    thread_id: thread.id,
    ticket_number: thread.ticket_number ?? null,
    subject: String(thread.subject || "").trim() || "(no subject)",
    preview: String(thread.snippet || "").replace(/\s+/g, " ").trim().slice(0, 140),
    customer_email: String(thread.customer_email || "").trim().toLowerCase() || null,
    last_message_at: thread.last_message_at || null,
    shop_id: shopIdByMailbox.get(String(thread.mailbox_id)) || null,
  }));
}

export async function GET(request: Request) {
  try {
    const access = await requirePlaygroundRequest();
    if (access.response) return access.response;
    const { authState, serviceClient, scope } = access;
    const url = new URL(request.url);
    const view = String(url.searchParams.get("view") || "").trim().toLowerCase();
    if (view === "tickets") {
      const tickets = await listScopedTicketSummaries(serviceClient, scope, {
        search: url.searchParams.get("search") || "",
        limit: Number(url.searchParams.get("limit") || 50),
      });
      return NextResponse.json({
        environment: greenfieldPlaygroundEnvironment(),
        ticket_required: isGreenfieldPlaygroundTicketRequired(),
        tickets,
      });
    }
    const sessionId = String(url.searchParams.get("session_id") || "").trim();
    const rows = await listSessions(serviceClient, scope, authState.userId);
    const selected = sessionId ? await loadSession(serviceClient, scope, authState.userId, sessionId) : null;
    if (sessionId && !selected) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const messages = selected ? await loadMessages(serviceClient, scope, authState.userId, selected.id) : [];
    const shop = await resolveVisibleShop(serviceClient, scope);
    return NextResponse.json({
      environment: greenfieldPlaygroundEnvironment(),
      ticket_required: isGreenfieldPlaygroundTicketRequired(),
      workspace_id: scope.workspaceId,
      active_store: shop ? { id: shop.id, domain: shop.shop_domain } : null,
      sessions: rows.map(publicPlaygroundSession),
      selected_session: selected ? publicPlaygroundSession(selected) : null,
      messages: messages.map(publicPlaygroundMessage),
      context: selected ? normalizePlaygroundContext(selected.conversation_context_json) : null,
    });
  } catch {
    return safeFailureResponse();
  }
}

export async function POST(request: Request) {
  try {
    const access = await requirePlaygroundRequest();
    if (access.response) return access.response;
    const { authState, serviceClient, scope } = access;
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "send").trim().toLowerCase();

    if (action === "create") {
      if (isGreenfieldPlaygroundTicketRequired()) {
        return NextResponse.json({ error: "Select a real production ticket before running the playground." }, { status: 400 });
      }
      const customer = normalizePlaygroundCustomerEmail(body?.customer_email);
      if (customer.error) return NextResponse.json({ error: customer.error }, { status: 400 });
      const { data, error } = await serviceClient
        .from(SESSIONS_TABLE)
        .insert({
          workspace_id: scope.workspaceId,
          owner_clerk_user_id: authState.userId,
          customer_email: customer.value,
          title: "New conversation",
        })
        .select("id, workspace_id, owner_clerk_user_id, customer_email, title, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ environment: greenfieldPlaygroundEnvironment(), ticket_required: isGreenfieldPlaygroundTicketRequired(), session: publicPlaygroundSession(data), messages: [], context: null });
    }

    if (action === "import_ticket") {
      const threadId = String(body?.thread_id || "").trim();
      if (!threadId) return NextResponse.json({ error: "thread_id is required." }, { status: 400 });
      const ticket = await loadScopedTicket(serviceClient, scope, threadId);
      if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
      const customer = normalizePlaygroundCustomerEmail(ticket.customerEmail);
      if (customer.error) return NextResponse.json({ error: "The ticket has no usable customer email." }, { status: 400 });

      const { data: session, error: sessionError } = await serviceClient
        .from(SESSIONS_TABLE)
        .insert({
          workspace_id: scope.workspaceId,
          owner_clerk_user_id: authState.userId,
          customer_email: customer.value,
          title: ticket.subject.slice(0, 72),
          conversation_context_json: {
            turn: 0,
            activeOrder: null,
            customerSignal: null,
            customerFirstName: ticket.customerFirstName,
            sourceThreadId: ticket.threadId,
          },
        })
        .select("id, workspace_id, owner_clerk_user_id, customer_email, title, conversation_context_json, created_at, updated_at")
        .single();
      if (sessionError) throw new Error(sessionError.message);

      const importedRows = ticket.messages.map((message: any) => ({
        session_id: session.id,
        workspace_id: scope.workspaceId,
        owner_clerk_user_id: authState.userId,
        role: message.role,
        content: message.content,
        trace_json: message.comparison_only
          ? { comparison_only: true, source: "historical_support_response" }
          : null,
        created_at: message.created_at || undefined,
      }));
      let importedMessages: any[] = [];
      if (importedRows.length) {
        const { data, error: messagesError } = await serviceClient
          .from(MESSAGES_TABLE)
          .insert(importedRows)
          .select("id, role, content, trace_json, created_at")
          .order("created_at", { ascending: true });
        if (messagesError) throw new Error(messagesError.message);
        importedMessages = Array.isArray(data) ? data : [];
      }

      return NextResponse.json({
        environment: greenfieldPlaygroundEnvironment(),
        ticket_required: isGreenfieldPlaygroundTicketRequired(),
        session: publicPlaygroundSession(session),
        messages: importedMessages.map(publicPlaygroundMessage),
        context: null,
        imported_ticket: { thread_id: ticket.threadId, message_count: importedMessages.length },
      });
    }

    const runImportedTicket = action === "run_ticket";
    if (action !== "send" && !runImportedTicket) return NextResponse.json({ error: "Unsupported playground action." }, { status: 400 });
    const messageInput = runImportedTicket
      ? { value: "", error: null }
      : normalizePlaygroundMessage(body?.message);
    if (messageInput.error) return NextResponse.json({ error: messageInput.error }, { status: 400 });
    const sessionId = String(body?.session_id || "").trim();
    if (!sessionId) return NextResponse.json({ error: "session_id is required." }, { status: 400 });
    const session = await loadSession(serviceClient, scope, authState.userId, sessionId);
    if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    if (isGreenfieldPlaygroundTicketRequired() && !String(session.conversation_context_json?.sourceThreadId || "").trim()) {
      return NextResponse.json({ error: "Only a server-imported production ticket can be evaluated." }, { status: 400 });
    }
    const messages = await loadMessages(serviceClient, scope, authState.userId, session.id);
    let messageForAgent = messageInput.value;
    let historyRows = messages;
    if (runImportedTicket) {
      const sourceThreadId = String(session.conversation_context_json?.sourceThreadId || "").trim();
      if (!sourceThreadId) {
        return NextResponse.json({ error: "Only a server-imported production ticket can be run here." }, { status: 400 });
      }
      const latestInboundIndex = [...messages]
        .map((message: any, index: number) => ({ message, index }))
        .reverse()
        .find(({ message }) => message.role === "user" && message.trace_json?.comparison_only !== true)?.index;
      if (latestInboundIndex == null) {
        return NextResponse.json({ error: "The selected ticket has no customer message to evaluate." }, { status: 400 });
      }
      messageForAgent = messages[latestInboundIndex].content;
      historyRows = messages.slice(0, latestInboundIndex);
    }
    if (!messageForAgent) return NextResponse.json({ error: "message is required." }, { status: 400 });
    const { shop, credentials } = await requireShopAndCredentials(serviceClient, scope);
    const customerFirstName = normalizePlaygroundCustomerName(session.conversation_context_json?.customerFirstName);
    const contextBefore = normalizePlaygroundContext(session.conversation_context_json);
    const tenant = {
      workspaceId: scope.workspaceId,
      shopId: shop.id,
      customerEmail: session.customer_email,
      customerName: customerFirstName,
    };
    const result = await runGreenfieldAgentWithAgentsSdk({
      tenant,
      message: messageForAgent,
      history: historyFromPlaygroundRows(historyRows),
      conversationContext: (contextBefore || undefined) as any,
      capabilities: {
        tenant,
        knowledge: new SupabaseKnowledgeStore(serviceClient),
        commerce: new ShopifyReadOnlyProvider({
          shopDomain: credentials.shop_domain,
          accessToken: credentials.access_token,
          customer: { email: session.customer_email, name: customerFirstName },
        }),
        tracking: createGreenfieldTrackingProvider(),
      },
      actionExecutor: new PlaygroundDryRunExecutor(),
    });
    const contextAfter = normalizePlaygroundContext(result.conversationContext);
    const contextToPersist = contextAfter
      ? { ...contextAfter, customerFirstName }
      : contextAfter;
    const trace = sanitizeGreenfieldTrace(result.trace, { contextBefore, contextAfter });
    const nextTitle = session.title === "New conversation" ? messageForAgent.slice(0, 72) : session.title;
    const assistantMessage = {
      session_id: session.id,
      workspace_id: scope.workspaceId,
      owner_clerk_user_id: authState.userId,
      role: "assistant",
      content: result.response,
      trace_json: trace,
    };
    const messagesToInsert = runImportedTicket
      ? [assistantMessage]
      : [{
          session_id: session.id,
          workspace_id: scope.workspaceId,
          owner_clerk_user_id: authState.userId,
          role: "user",
          content: messageForAgent,
          trace_json: null,
        }, assistantMessage];
    const { data: insertedMessages, error: messageError } = await serviceClient
      .from(MESSAGES_TABLE)
      .insert(messagesToInsert)
      .select("id, role, content, trace_json, created_at")
      .order("created_at", { ascending: true });
    if (messageError) throw new Error(messageError.message);
    const { data: updatedSession, error: updateError } = await serviceClient
      .from(SESSIONS_TABLE)
      .update({
        conversation_context_json: {
          ...(session.conversation_context_json?.sourceThreadId
            ? { sourceThreadId: session.conversation_context_json.sourceThreadId }
            : {}),
          ...contextToPersist,
        },
        title: nextTitle,
      })
      .eq("id", session.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_clerk_user_id", authState.userId)
      .select("id, workspace_id, owner_clerk_user_id, customer_email, title, conversation_context_json, created_at, updated_at")
      .single();
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({
      environment: greenfieldPlaygroundEnvironment(),
      ticket_required: isGreenfieldPlaygroundTicketRequired(),
      session: publicPlaygroundSession(updatedSession),
      messages: Array.isArray(insertedMessages) ? insertedMessages.map(publicPlaygroundMessage) : [],
      context: contextAfter,
      active_store: { id: shop.id, domain: shop.shop_domain },
    });
  } catch {
    return safeFailureResponse();
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await requirePlaygroundRequest();
    if (access.response) return access.response;
    const { authState, serviceClient, scope } = access;
    const url = new URL(request.url);
    const sessionId = String(url.searchParams.get("session_id") || "").trim();
    if (!sessionId) return NextResponse.json({ error: "session_id is required." }, { status: 400 });
    const session = await loadSession(serviceClient, scope, authState.userId, sessionId);
    if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const { error } = await serviceClient
      .from(SESSIONS_TABLE)
      .delete()
      .eq("id", session.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_clerk_user_id", authState.userId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true, session_id: session.id });
  } catch {
    return safeFailureResponse();
  }
}
