import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  composeEmailBodyWithSignature,
  loadEmailSignatureConfig,
  normalizePlainText,
} from "@/lib/server/email-signature";

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

const asString = (value) => (typeof value === "string" ? value.trim() : "");

function normalizeActionStatus(status) {
  const value = asString(status).toLowerCase();
  if (!value) return "";
  if (["approved", "applied", "completed", "success"].includes(value)) return "applied";
  if (["denied", "declined", "rejected"].includes(value)) return "declined";
  if (["awaiting_approval", "requires_approval"].includes(value)) return "pending";
  return value;
}

async function loadLegacyUserSignature(serviceClient, supabaseUserId) {
  if (!supabaseUserId) return "";
  const { data, error } = await serviceClient
    .from("profiles")
    .select("signature")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (error) return "";
  return normalizePlainText(data?.signature);
}

async function loadLatestPendingDraftMeta(serviceClient, scope, threadKey) {
  if (!threadKey) return null;
  let query = serviceClient
    .from("drafts")
    .select("id, kind, execution_state, source_action_id, status, created_at")
    .eq("thread_id", threadKey)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
  const { data } = await query.maybeSingle();
  return data || null;
}

function isProposalOnlyDraftMeta(meta) {
  const kind = String(meta?.kind || "").trim().toLowerCase();
  return Boolean(kind) && kind !== "final_customer_reply";
}

async function loadMessagesAndAttachments(serviceClient, threadId, mailboxId) {
  // Strict single-thread scope: we never query siblings here. Provider thread
  // IDs (Gmail in particular) can collide across unrelated customer
  // conversations when subjects look alike, which previously caused drafts
  // and messages from one customer's ticket to leak into another's. — 2026-05-26
  const buildMessagesQuery = (select) =>
    serviceClient
      .from("mail_messages")
      .select(select)
      .eq("mailbox_id", mailboxId)
      .eq("thread_id", threadId)
      .order("received_at", { ascending: true, nullsLast: true });

  let { data: rows, error } = await buildMessagesQuery(
    "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, body_html, clean_body_text, clean_body_html, quoted_body_text, quoted_body_html, from_name, from_email, extracted_customer_name, extracted_customer_email, extracted_customer_fields, sender_identity_source, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text",
  );
  if (
    error &&
    /ai_draft_text|provider_message_id|body_html|clean_body_text|clean_body_html|quoted_body_text|quoted_body_html|extracted_customer_email|extracted_customer_fields|sender_identity_source/i.test(
      error.message || "",
    )
  ) {
    const lean = await buildMessagesQuery(
      "id, user_id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at",
    );
    rows = lean.data;
    error = lean.error;
  }
  if (error) throw new Error(error.message);

  const messages = Array.isArray(rows) ? rows : [];
  const messageIds = messages.map((row) => String(row?.id || "").trim()).filter(Boolean);
  if (!messageIds.length) return { messages, attachments: [] };

  const { data: attachmentRows, error: attachmentError } = await serviceClient
    .from("mail_attachments")
    .select(
      "id, user_id, mailbox_id, message_id, provider, provider_attachment_id, filename, mime_type, size_bytes, storage_path, created_at",
    )
    .eq("mailbox_id", mailboxId)
    .in("message_id", messageIds);
  if (attachmentError) throw new Error(attachmentError.message);
  return {
    messages,
    attachments: Array.isArray(attachmentRows) ? attachmentRows : [],
  };
}

async function loadLatestAiDraft(serviceClient, scope, thread) {
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("ai_draft_text, updated_at")
      .eq("thread_id", thread.id)
      .eq("from_me", false)
      .not("ai_draft_text", "is", null)
      .order("updated_at", { ascending: false, nullsLast: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope,
  );
  if (error) throw new Error(error.message);

  const bodyText = String(data?.ai_draft_text || "").trim();
  if (!bodyText) return null;
  return {
    id: null,
    body_text: bodyText,
    body_html: null,
    subject: thread.subject || "",
    updated_at: data?.updated_at || null,
  };
}

async function loadDraft(serviceClient, scope, thread) {
  const legacySignature = await loadLegacyUserSignature(serviceClient, scope.supabaseUserId);
  const { data: mailbox } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select("id, shop_id, workspace_id")
      .eq("id", thread.mailbox_id)
      .maybeSingle(),
    scope,
  );
  const signatureConfig = await loadEmailSignatureConfig(serviceClient, {
    workspaceId: scope?.workspaceId || mailbox?.workspace_id || null,
    shopId: mailbox?.shop_id || null,
    userId: scope?.supabaseUserId || null,
    legacySignature,
  });
  const latestPendingDraftMeta = await loadLatestPendingDraftMeta(
    serviceClient,
    scope,
    thread.provider_thread_id || thread.id,
  );
  const { data: savedDraft, error } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id, body_text, body_html, subject, updated_at")
      .eq("thread_id", thread.id)
      .eq("from_me", true)
      .eq("is_draft", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope,
  );
  if (error) throw new Error(error.message);
  // A generated reply is persisted on the latest inbound message. Treat it as
  // a draft when there is no agent-edited `is_draft` row, so the detail payload
  // alone can restore the composer after a ticket switch.
  const proposalOnly = isProposalOnlyDraftMeta(latestPendingDraftMeta);
  const draft =
    savedDraft ||
    (!proposalOnly ? await loadLatestAiDraft(serviceClient, scope, thread) : null);
  const rendered = draft
    ? composeEmailBodyWithSignature({
        bodyText: draft.body_text || "",
        bodyHtml: draft.body_html || "",
        config: signatureConfig,
      })
    : null;
  return {
    signature: signatureConfig.closingText || "",
    proposal_only: proposalOnly,
    draft_kind: latestPendingDraftMeta?.kind || null,
    draft: draft
      ? {
          id: draft.id,
          body_text: draft.body_text || "",
          rendered_body_text: rendered.finalBodyText,
          rendered_body_html: rendered.finalBodyHtml,
          body_html: draft.body_html || "",
          subject: draft.subject || "",
          updated_at: draft.updated_at,
        }
      : null,
  };
}

async function loadDraftStats(serviceClient, scope, thread) {
  // Strict thread_id only — provider_thread_id grouping previously leaked
  // edit metrics across sibling threads (Gmail reuses provider_thread_id).
  // — 2026-05-26
  if (!thread?.id || !scope?.workspaceId) {
    return { edit_classification: null, edit_delta_pct: null };
  }
  const { data } = await serviceClient
    .from("drafts")
    .select("edit_classification, edit_delta_pct")
    .eq("thread_id", thread.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    edit_classification: data?.edit_classification ?? null,
    edit_delta_pct: data?.edit_delta_pct ?? null,
  };
}

async function loadOrderUpdate(serviceClient, scope, thread) {
  // Exclude superseded actions — they're stale (replaced by a newer turn's
  // action or auto-superseded when the customer pivoted intent). Showing them
  // as "Awaiting approval" tricks the admin into approving an action that no
  // longer matches the conversation.
  let actionQuery = serviceClient
    .from("thread_actions")
    .select("id, action_type, status, detail, payload, error, created_at, updated_at")
    .eq("thread_id", thread.id)
    .neq("status", "superseded")
    .order("updated_at", { ascending: false })
    .limit(1);
  actionQuery = applyScope(actionQuery, scope);
  const { data: latestAction, error } = await actionQuery.maybeSingle();
  if (error) throw new Error(error.message);

  let latestReturnCase = null;
  if (scope?.workspaceId) {
    const { data } = await serviceClient
      .from("return_cases")
      .select(
        "id, status, is_eligible, eligibility_reason, return_shipping_mode, reason, shopify_order_id, customer_email, created_at, updated_at",
      )
      .eq("thread_id", thread.id)
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestReturnCase = data || null;
  }
  if (!latestAction) return { action: null, returnCase: latestReturnCase };

  const normalizedStatus = normalizeActionStatus(latestAction.status);
  const rawStatus = asString(latestAction.status) || normalizedStatus;
  const actionPayload =
    latestAction?.payload && typeof latestAction.payload === "object"
      ? latestAction.payload
      : {};
  const testModeAction =
    rawStatus.toLowerCase() === "approved_test_mode" ||
    normalizedStatus === "approved_test_mode" ||
    actionPayload?.test_mode === true ||
    actionPayload?.simulated === true;

  return {
    action: {
      id: String(latestAction.id || ""),
      detail:
        asString(latestAction.detail) ||
        "Sona wants to apply an order update for this customer.",
      actionType: asString(latestAction.action_type) || null,
      payload: actionPayload,
      createdAt: latestAction.created_at || null,
      updatedAt: latestAction.updated_at || latestAction.created_at || null,
      status: rawStatus,
      normalizedStatus,
      testMode: testModeAction,
      error:
        asString(latestAction.error) ||
        (testModeAction
          ? "Action approved, but no changes were made because Test Mode is enabled."
          : null),
    },
    returnCase: latestReturnCase,
  };
}

export async function GET(_request, context) {
  try {
    const threadId = String(context?.params?.threadId || "").trim();
    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
    }

    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId && !scope.supabaseUserId) {
      return NextResponse.json({ error: "Auth scope not found." }, { status: 401 });
    }

    const { data: thread, error: threadError } = await applyScope(
      serviceClient
        .from("mail_threads")
        .select("id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, subject")
        .eq("id", threadId)
        .maybeSingle(),
      scope,
    );
    if (threadError || !thread?.id) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const [messagePayload, draftPayload, draftStats, orderUpdate] = await Promise.all([
      loadMessagesAndAttachments(serviceClient, threadId, thread.mailbox_id),
      loadDraft(serviceClient, scope, thread).catch((error) => ({
        error: error.message,
        signature: "",
        proposal_only: false,
        draft_kind: null,
        draft: null,
      })),
      loadDraftStats(serviceClient, scope, thread).catch(() => ({
        edit_classification: null,
        edit_delta_pct: null,
      })),
      loadOrderUpdate(serviceClient, scope, thread).catch(() => ({
        action: null,
        returnCase: null,
      })),
    ]);

    return NextResponse.json(
      {
        ...messagePayload,
        draft: draftPayload,
        draftStats,
        orderUpdate,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load thread detail.",
      },
      { status: 500 },
    );
  }
}
