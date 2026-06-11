// POST /api/knowledge/snippets/preview
//
// Runs the AI draft pipeline against a specific ticket TWICE in parallel:
//   1. With everything as-is (baseline)
//   2. With the candidate snippet's chunks excluded from retrieval
//
// The frontend renders both drafts side-by-side so the admin can see exactly
// what value the snippet adds — and which retrieved chunks it displaces.
//
// Nothing is persisted; this is preview-only.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";
import { loadPreviewDocumentContext } from "@/lib/server/knowledge-doc-preview";
import {
  buildKnowledgeDocumentPreviewRunBodies,
  wasLegacySnippetRetrieved,
  wasPreviewDocumentInjected,
} from "@/lib/server/knowledge-doc-preview-comparison";

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

const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

type DraftRun = {
  draft_text: string | null;
  proposed_actions: unknown[];
  routing_hint: string | null;
  confidence: number | null;
  sources: Array<{ content?: string; kind?: string; source_label?: string }>;
  latency_ms: number | null;
  preview_document_context?: {
    requested: true;
    document_id: string;
    preview_chunk_ids: string[];
    section_headings: string[];
    active_only_for_test: true;
    injected: boolean;
    reason: string;
  } | null;
  error?: string;
};

async function callEdgeFunction(
  body: Record<string, unknown>,
): Promise<DraftRun> {
  try {
    const start = Date.now();
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-draft-v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return {
        draft_text: null,
        proposed_actions: [],
        routing_hint: null,
        confidence: null,
        sources: [],
        latency_ms: Date.now() - start,
        error: text.slice(0, 500) || `HTTP ${resp.status}`,
      };
    }
    const data = JSON.parse(text);
    return {
      draft_text: data.draft_text ?? data.reply_draft ?? null,
      proposed_actions: Array.isArray(data.proposed_actions) ? data.proposed_actions : [],
      routing_hint: data.routing_hint ?? null,
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      sources: Array.isArray(data.sources) ? data.sources : [],
      latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : Date.now() - start,
      preview_document_context: data.preview_document_context ?? null,
    };
  } catch (err: any) {
    return {
      draft_text: null,
      proposed_actions: [],
      routing_hint: null,
      confidence: null,
      sources: [],
      latency_ms: null,
      error: err?.message || "Edge function call failed",
    };
  }
}

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const payload = await request.json().catch(() => null);
  const snippetId = String((payload as any)?.snippet_id || "").trim();
  const previewDocumentId = String((payload as any)?.preview_document_id || "").trim();
  const threadId = String((payload as any)?.thread_id || "").trim();
  const customMessage = (payload as any)?.custom_message;
  const customBody = String(customMessage?.body || "").trim();
  const customSubject = String(customMessage?.subject || "").trim() || "(test ticket)";
  const customEmail = String(customMessage?.customer_email || "").trim() || null;
  const customName = String(customMessage?.customer_name || "").trim() || null;

  if (!snippetId && !previewDocumentId) {
    return NextResponse.json({ error: "snippet_id or preview_document_id is required." }, { status: 400 });
  }
  if (!threadId && !customBody) {
    return NextResponse.json(
      { error: "Either thread_id or custom_message.body is required." },
      { status: 400 },
    );
  }

  // Resolve which shops the user is allowed to query.
  let shops: Array<{ id: string }>;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  const shopIds = new Set(shops.map((s) => s.id));
  if (!shopIds.size) {
    return NextResponse.json({ error: "No shop in scope." }, { status: 403 });
  }

  // Resolve shop_id — either from the picked thread, or fall back to the
  // first scoped shop when running against a custom message. Custom messages
  // are detached from any real inbox so we don't need a mailbox.
  let shopId: string | undefined;
  let threadSubject: string | null = null;
  if (threadId) {
    const { data: thread, error: threadErr } = await supabase
      .from("mail_threads")
      .select("id, mailbox_id, subject")
      .eq("id", threadId)
      .maybeSingle();
    if (threadErr || !thread) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }
    threadSubject = thread.subject || null;
    const { data: mailbox } = await supabase
      .from("mail_accounts")
      .select("shop_id")
      .eq("id", thread.mailbox_id)
      .maybeSingle();
    shopId = mailbox?.shop_id as string | undefined;
    if (!shopId || !shopIds.has(shopId)) {
      return NextResponse.json({ error: "Thread is outside your scope." }, { status: 403 });
    }
  } else {
    shopId = Array.from(shopIds)[0];
  }

  let excludeChunkIds: string[] = [];
  let previewDocumentContext = null;
  if (previewDocumentId) {
    try {
      previewDocumentContext = await loadPreviewDocumentContext({
        serviceClient: supabase,
        shopId: shopId!,
        documentId: previewDocumentId,
      });
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Preview document context is unavailable." },
        { status: 400 },
      );
    }
  } else {
    // Find all agent_knowledge chunk ids that belong to this snippet — the
    // edge function will exclude them from the "without snippet" run.
    const { data: snippetChunks, error: chunkErr } = await supabase
      .from("agent_knowledge")
      .select("id")
      .eq("shop_id", shopId!)
      .eq("source_provider", "manual_text")
      .eq("metadata->>snippet_id", snippetId);
    if (chunkErr) {
      return NextResponse.json({ error: chunkErr.message }, { status: 500 });
    }
    excludeChunkIds = (snippetChunks || []).map((c: any) => String(c.id));
    if (!excludeChunkIds.length) {
      return NextResponse.json(
        { error: "Snippet has no indexed chunks — save the snippet first." },
        { status: 400 },
      );
    }
  }

  // Build the email_data payload — either from the real thread's latest
  // customer message + history, or from the admin's custom input.
  let emailData: {
    subject: string;
    body: string;
    source_thread_id: string | null;
    conversation_history: Array<{ role: string; text: string }>;
  };
  let displayCustomerEmail: string | null = null;
  let displayCustomerName: string | null = null;

  if (threadId) {
    const { data: latestCustomer, error: msgErr } = await supabase
      .from("mail_messages")
      .select("id, subject, clean_body_text, body_text, snippet, from_email, from_name")
      .eq("thread_id", threadId)
      .eq("from_me", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (msgErr || !latestCustomer) {
      return NextResponse.json(
        { error: "No customer message found in this thread." },
        { status: 404 },
      );
    }
    const { data: historyRows } = await supabase
      .from("mail_messages")
      .select("from_me, clean_body_text, body_text, snippet, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(20);

    const customerBody = String(
      latestCustomer.clean_body_text ||
        latestCustomer.body_text ||
        latestCustomer.snippet ||
        "",
    ).trim();
    if (!customerBody) {
      return NextResponse.json(
        { error: "Latest customer message has no body." },
        { status: 422 },
      );
    }

    emailData = {
      subject: latestCustomer.subject || threadSubject || "(no subject)",
      body: customerBody,
      source_thread_id: threadId,
      conversation_history: (historyRows || [])
        .map((m: any) => ({
          role: m.from_me ? "agent" : "customer",
          text: String(m.clean_body_text || m.body_text || m.snippet || "").trim(),
        }))
        .filter((m: any) => m.text),
    };
    displayCustomerEmail = latestCustomer.from_email || null;
    displayCustomerName = latestCustomer.from_name || null;
  } else {
    emailData = {
      subject: customSubject,
      body: customBody,
      source_thread_id: null,
      conversation_history: [],
    };
    displayCustomerEmail = customEmail;
    displayCustomerName = customName;
  }

  const runBodies = buildKnowledgeDocumentPreviewRunBodies({
    shopId: shopId!,
    emailData,
    previewDocumentContext,
    snippetExcludeChunkIds: excludeChunkIds,
  });

  // Run both pipelines in parallel.
  const [withSnippet, withoutSnippet] = await Promise.all([
    callEdgeFunction(runBodies.withPreview),
    callEdgeFunction(runBodies.withoutPreview),
  ]);

  // Detect whether this snippet's chunks actually surfaced in the baseline run.
  // We check by looking at source_label (which usually includes the snippet
  // title) since the chunk ids aren't returned in the sources array.
  const { data: snippetMeta } = excludeChunkIds[0]
    ? await supabase
      .from("agent_knowledge")
      .select("metadata")
      .eq("id", excludeChunkIds[0])
      .maybeSingle()
    : { data: null };
  const snippetTitle = previewDocumentContext
    ? "Knowledge document preview"
    : String((snippetMeta?.metadata as any)?.title || "").trim();
  const snippetWasRetrieved = previewDocumentContext
    ? wasPreviewDocumentInjected(withSnippet)
    : wasLegacySnippetRetrieved({ run: withSnippet, snippetTitle });

  return NextResponse.json({
    customer_message: emailData.body,
    customer_email: displayCustomerEmail,
    customer_name: displayCustomerName,
    subject: emailData.subject,
    snippet_title: snippetTitle || null,
    snippet_was_retrieved: snippetWasRetrieved,
    excluded_chunk_count: runBodies.excludedChunkIds.length,
    preview_document_context: previewDocumentContext
      ? {
        requested: true,
        document_id: previewDocumentContext.document_id,
        preview_chunk_ids: previewDocumentContext.chunk_ids,
        section_headings: previewDocumentContext.section_headings,
        active_only_for_test: true,
        injected: withSnippet.preview_document_context?.injected === true,
        reason: withSnippet.preview_document_context?.reason ?? null,
      }
      : null,
    with_snippet: withSnippet,
    without_snippet: withoutSnippet,
  });
}
