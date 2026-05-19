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

const normalizeSubject = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();

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

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadRelatedThreadIds(serviceClient, scope, thread, mailboxIds) {
  const fallbackId = String(thread?.id || "").trim();
  const mailboxId = String(thread?.mailbox_id || "").trim();
  const providerThreadId = String(thread?.provider_thread_id || "").trim();
  const subjectNorm = normalizeSubject(thread?.subject || "");
  if (!fallbackId || !mailboxId) return fallbackId ? [fallbackId] : [];

  let siblingRows = [];
  if (providerThreadId) {
    const { data, error } = await serviceClient
      .from("mail_threads")
      .select("id")
      .eq("mailbox_id", mailboxId)
      .eq("provider_thread_id", providerThreadId)
      .in("mailbox_id", mailboxIds)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) siblingRows = data;
  }

  if ((!Array.isArray(siblingRows) || siblingRows.length <= 1) && subjectNorm) {
    const { data, error } = await applyScope(
      serviceClient
        .from("mail_threads")
        .select("id, subject")
        .eq("mailbox_id", mailboxId)
        .order("created_at", { ascending: false })
        .limit(2000),
      scope,
    );
    if (!error && Array.isArray(data)) {
      siblingRows = [
        ...(Array.isArray(siblingRows) ? siblingRows : []),
        ...data
          .filter((row) => normalizeSubject(row?.subject) === subjectNorm)
          .map((row) => ({ id: row.id })),
      ];
    }
  }

  const ids = Array.from(
    new Set(
      (siblingRows || [])
        .map((row) => String(row?.id || "").trim())
        .filter(Boolean),
    ),
  );
  if (!ids.length) return [fallbackId];
  return ids.includes(fallbackId) ? ids : [fallbackId, ...ids];
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

async function loadMessagesAndAttachments(serviceClient, threadId, relatedThreadIds, mailboxIds) {
  const buildMessagesQuery = (select) => {
    let q = serviceClient
      .from("mail_messages")
      .select(select)
      .in("mailbox_id", mailboxIds)
      .order("received_at", { ascending: true, nullsLast: true });
    return relatedThreadIds.length > 1
      ? q.in("thread_id", relatedThreadIds)
      : q.eq("thread_id", threadId);
  };

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
    .in("mailbox_id", mailboxIds)
    .in("message_id", messageIds);
  if (attachmentError) throw new Error(attachmentError.message);
  return {
    messages,
    attachments: Array.isArray(attachmentRows) ? attachmentRows : [],
  };
}

async function loadDraft(serviceClient, scope, thread, relatedThreadIds) {
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
  const { data: draft, error } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id, body_text, body_html, subject, updated_at")
      .in("thread_id", relatedThreadIds)
      .eq("from_me", true)
      .eq("is_draft", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope,
  );
  if (error) throw new Error(error.message);
  const rendered = draft
    ? composeEmailBodyWithSignature({
        bodyText: draft.body_text || "",
        bodyHtml: draft.body_html || "",
        config: signatureConfig,
      })
    : null;
  return {
    signature: signatureConfig.closingText || "",
    proposal_only: isProposalOnlyDraftMeta(latestPendingDraftMeta),
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
  const keys = [thread?.provider_thread_id, thread?.id].filter(Boolean);
  if (!keys.length) return { edit_classification: null, edit_delta_pct: null };
  let query = serviceClient
    .from("drafts")
    .select("edit_classification, edit_delta_pct")
    .in("thread_id", keys)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1);
  if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
  const { data } = await query.maybeSingle();
  return {
    edit_classification: data?.edit_classification ?? null,
    edit_delta_pct: data?.edit_delta_pct ?? null,
  };
}

async function loadOrderUpdate(serviceClient, scope, thread) {
  let actionQuery = serviceClient
    .from("thread_actions")
    .select("id, action_type, status, detail, payload, error, created_at, updated_at")
    .eq("thread_id", thread.id)
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

    const mailboxIds = await loadMailboxIds(serviceClient, scope);
    if (!mailboxIds.length) {
      return NextResponse.json({ messages: [], attachments: [] }, { status: 200 });
    }

    const { data: thread, error: threadError } = await applyScope(
      serviceClient
        .from("mail_threads")
        .select("id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, subject")
        .eq("id", threadId)
        .in("mailbox_id", mailboxIds)
        .maybeSingle(),
      scope,
    );
    if (threadError || !thread?.id) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const relatedThreadIds = await loadRelatedThreadIds(
      serviceClient,
      scope,
      thread,
      mailboxIds,
    );
    const [messagePayload, draftPayload, draftStats, orderUpdate] = await Promise.all([
      loadMessagesAndAttachments(serviceClient, threadId, relatedThreadIds, mailboxIds),
      loadDraft(serviceClient, scope, thread, relatedThreadIds).catch((error) => ({
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
          "Cache-Control": "private, max-age=15, stale-while-revalidate=45",
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
