import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  composeEmailBodyWithSignature,
  loadEmailSignatureConfig,
  normalizePlainText,
  stripTrailingComposedFooter,
} from "@/lib/server/email-signature";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
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

async function loadRelatedThreadIdsForDraftClear(serviceClient, scope, thread) {
  const fallbackId = String(thread?.id || "").trim();
  const mailboxId = String(thread?.mailbox_id || "").trim();
  const providerThreadId = String(thread?.provider_thread_id || "").trim();
  const subjectNorm = normalizeSubject(thread?.subject || "");
  if (!fallbackId || !mailboxId) return fallbackId ? [fallbackId] : [];

  let siblingRows = [];
  if (providerThreadId) {
    const { data, error } = await applyScope(
      serviceClient
        .from("mail_threads")
        .select("id")
        .eq("mailbox_id", mailboxId)
        .eq("provider_thread_id", providerThreadId),
      scope
    );
    if (!error && Array.isArray(data)) siblingRows = data;
  }

  if ((!Array.isArray(siblingRows) || siblingRows.length <= 1) && subjectNorm) {
    const { data: subjectRows, error: subjectError } = await applyScope(
      serviceClient
        .from("mail_threads")
        .select("id, subject")
        .eq("mailbox_id", mailboxId)
        .order("created_at", { ascending: false })
        .limit(2000),
      scope
    );
    if (!subjectError && Array.isArray(subjectRows)) {
      const matches = subjectRows.filter(
        (row) => normalizeSubject(row?.subject) === subjectNorm
      );
      siblingRows = [
        ...(Array.isArray(siblingRows) ? siblingRows : []),
        ...matches.map((row) => ({ id: row.id })),
      ];
    }
  }

  const ids = Array.from(
    new Set(
      (siblingRows || [])
        .map((row) => String(row?.id || "").trim())
        .filter(Boolean)
    )
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
  query = scope?.workspaceId ? query.eq("workspace_id", scope.workspaceId) : query;
  const { data } = await query.maybeSingle();
  return data || null;
}

function isProposalOnlyDraftMeta(meta) {
  if (!meta) return false;
  const kind = String(meta?.kind || "").trim().toLowerCase();
  if (!kind) return false;
  return kind !== "final_customer_reply";
}

function buildSnippet(text, maxLength = 240) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}...` : cleaned;
}

function countWords(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function summarizeDraftDiff(aiText, finalText) {
  const ai = String(aiText || "");
  const final = String(finalText || "");
  const aiWords = countWords(ai);
  const finalWords = countWords(final);
  const delta = finalWords - aiWords;
  const deltaPct = aiWords ? delta / aiWords : 0;
  const normalizedAi = ai.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedFinal = final.replace(/\s+/g, " ").trim().toLowerCase();
  return {
    ai_length: ai.length,
    final_length: final.length,
    ai_words: aiWords,
    final_words: finalWords,
    delta_words: delta,
    delta_pct: Number.isFinite(deltaPct) ? Number(deltaPct.toFixed(2)) : 0,
    identical_normalized: Boolean(normalizedAi) && normalizedAi === normalizedFinal,
    changed_materially:
      Boolean(normalizedAi) &&
      normalizedAi !== normalizedFinal &&
      (Math.abs(delta) >= 5 || Math.abs(deltaPct) >= 0.15 || Math.abs(final.length - ai.length) >= 40),
  };
}

async function captureDraftEditFeedback({
  serviceClient,
  threadId,
  messageDraftId,
  sourceWasAiGenerated,
  originalAiText,
  finalText,
  createdAt,
}) {
  if (!serviceClient || !threadId || !sourceWasAiGenerated) return;
  const diffSummary = summarizeDraftDiff(originalAiText, finalText);
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: "draft_edit_feedback_captured",
    step_detail: JSON.stringify({
      thread_id: threadId,
      message_draft_id: messageDraftId || null,
      event_type: "manual_save",
      source_was_ai_generated: true,
      original_ai_draft_length: diffSummary.ai_length,
      final_draft_length: diffSummary.final_length,
      changed_materially: diffSummary.changed_materially,
      diff_summary: diffSummary,
    }),
    status: "info",
    created_at: createdAt || new Date().toISOString(),
  });
}

async function loadLegacyUserSignature(serviceClient, supabaseUserId) {
  if (!supabaseUserId) return "";
  const { data: profile, error } = await serviceClient
    .from("profiles")
    .select("signature")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (error) {
    console.warn("[threads/draft] profile signature lookup failed", error.message);
    return "";
  }
  return normalizePlainText(profile?.signature);
}

export async function GET(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 404 });
  }
  const legacySignature = await loadLegacyUserSignature(serviceClient, scope.supabaseUserId);
  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, provider_thread_id, mailbox_id")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }
  const latestPendingDraftMeta = await loadLatestPendingDraftMeta(
    serviceClient,
    scope,
    thread.provider_thread_id || threadId
  );
  const proposalOnly = isProposalOnlyDraftMeta(latestPendingDraftMeta);
  const relatedThreadIds = await loadRelatedThreadIdsForDraftClear(serviceClient, scope, thread);
  const { data: mailbox } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select("id, shop_id, workspace_id")
      .eq("id", thread.mailbox_id)
      .maybeSingle(),
    scope
  );
  const signatureConfig = await loadEmailSignatureConfig(serviceClient, {
    workspaceId: scope?.workspaceId || mailbox?.workspace_id || null,
    shopId: mailbox?.shop_id || null,
    userId: scope?.supabaseUserId || null,
    legacySignature,
  });

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
    scope
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      signature: signatureConfig.closingText || "",
      proposal_only: proposalOnly,
      draft_kind: latestPendingDraftMeta?.kind || null,
      // Keep persisted drafts visible even when a proposal action is pending.
      draft: draft
        ? (() => {
            const rendered = composeEmailBodyWithSignature({
              bodyText: draft.body_text || "",
              bodyHtml: draft.body_html || "",
              config: signatureConfig,
            });
            return {
              id: draft.id,
              body_text: draft.body_text || "",
              rendered_body_text: rendered.finalBodyText,
              rendered_body_html: rendered.finalBodyHtml,
              body_html: draft.body_html || "",
              subject: draft.subject || "",
              updated_at: draft.updated_at,
            };
          })()
        : null,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    }
  );
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const bodyText = String(body?.body_text || "").trim();
  const bodyHtml = String(body?.body_html || "").trim();
  const subject = String(body?.subject || "").trim();
  if (!bodyText && !bodyHtml) {
    return NextResponse.json({ error: "Draft body is required." }, { status: 400 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 404 });
  }

  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, subject")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const nextSubject = subject || thread.subject || "Re:";
  const legacySignature = await loadLegacyUserSignature(serviceClient, scope.supabaseUserId);
  const { data: mailbox } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select("id, shop_id, workspace_id")
      .eq("id", thread.mailbox_id)
      .maybeSingle(),
    scope
  );
  const signatureConfig = await loadEmailSignatureConfig(serviceClient, {
    workspaceId: scope?.workspaceId || mailbox?.workspace_id || null,
    shopId: mailbox?.shop_id || null,
    userId: scope?.supabaseUserId || null,
    legacySignature,
  });
  const nextBodyText = stripTrailingComposedFooter(bodyText || bodyHtml, signatureConfig);
  const snippet = buildSnippet(nextBodyText);
  const relatedThreadIds = await loadRelatedThreadIdsForDraftClear(serviceClient, scope, thread);

  const { data: existingDraft } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id, ai_draft_text, body_text")
      .in("thread_id", relatedThreadIds)
      .eq("from_me", true)
      .eq("is_draft", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope
  );

  let draftId = null;
  const originalAiDraftText =
    String(existingDraft?.ai_draft_text || "").trim() || String(existingDraft?.body_text || "").trim();
  if (existingDraft?.id) {
    const { data, error } = await applyScope(
      serviceClient
        .from("mail_messages")
        .update({
          subject: nextSubject,
          snippet,
          body_text: nextBodyText,
          body_html: bodyHtml || null,
          ai_draft_text: nextBodyText,
          updated_at: nowIso,
        })
        .eq("id", existingDraft.id)
        .select("id")
        .maybeSingle(),
      scope
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    draftId = data?.id || existingDraft.id;
  } else {
    const { data, error } = await serviceClient
      .from("mail_messages")
      .insert({
        user_id: scope.supabaseUserId,
        workspace_id: scope.workspaceId || null,
        mailbox_id: thread.mailbox_id,
        thread_id: threadId,
        provider: thread.provider || "smtp",
        provider_message_id: `draft-${threadId}-${Date.now()}`,
        subject: nextSubject,
        snippet,
        body_text: nextBodyText,
        body_html: bodyHtml || null,
        from_email: null,
        from_name: null,
        from_me: true,
        is_draft: true,
        is_read: true,
        sent_at: null,
        received_at: null,
        ai_draft_text: nextBodyText,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    draftId = data?.id || null;
  }

  await applyScope(
    serviceClient
      .from("mail_messages")
      .update({ ai_draft_text: nextBodyText, updated_at: nowIso })
      .in("thread_id", relatedThreadIds)
      .is("from_me", false),
    scope
  );

  // Best-effort tracking in drafts table (legacy analytics).
  {
    let supersedeQuery = serviceClient
      .from("drafts")
      .update({ status: "superseded" })
      .eq("thread_id", thread.provider_thread_id || threadId)
      .eq("platform", thread.provider || "smtp")
      .eq("status", "pending");
    supersedeQuery = scope.workspaceId
      ? supersedeQuery.eq("workspace_id", scope.workspaceId)
      : supersedeQuery;
    await supersedeQuery;
  }

  await serviceClient.from("drafts").insert({
    shop_id: null,
    customer_email: null,
    subject: nextSubject,
    status: "pending",
    kind: "final_customer_reply",
    execution_state: "no_action",
    source_action_id: null,
    final_reply_generated_at: nowIso,
    platform: thread.provider || "smtp",
    draft_id: draftId ? String(draftId) : null,
    message_id: draftId ? String(draftId) : null,
    thread_id: thread.provider_thread_id || threadId,
    workspace_id: scope.workspaceId || null,
    created_at: nowIso,
  });

  if (originalAiDraftText && originalAiDraftText.trim() && originalAiDraftText.trim() !== nextBodyText.trim()) {
    await captureDraftEditFeedback({
      serviceClient,
      threadId: thread.provider_thread_id || threadId,
      messageDraftId: draftId,
      sourceWasAiGenerated: true,
      originalAiText: originalAiDraftText,
      finalText: nextBodyText,
      createdAt: nowIso,
    }).catch((error) => {
      console.warn("[threads/draft] draft edit feedback capture failed", error?.message || error);
    });
  }

  return NextResponse.json({ ok: true, draft_id: draftId }, { status: 200 });
}

export async function DELETE(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 404 });
  }

  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, subject")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const relatedThreadIds = await loadRelatedThreadIdsForDraftClear(serviceClient, scope, thread);
  await applyScope(
    serviceClient
      .from("mail_messages")
      .delete()
      .in("thread_id", relatedThreadIds)
      .eq("from_me", true)
      .eq("is_draft", true),
    scope
  );

  await applyScope(
    serviceClient
      .from("mail_messages")
      .update({ ai_draft_text: null, updated_at: nowIso })
      .in("thread_id", relatedThreadIds)
      .is("from_me", false),
    scope
  );

  {
    let supersedeQuery = serviceClient
      .from("drafts")
      .update({ status: "superseded" })
      .eq("thread_id", thread.provider_thread_id || threadId)
      .eq("platform", thread.provider || "smtp")
      .eq("status", "pending");
    supersedeQuery = scope.workspaceId
      ? supersedeQuery.eq("workspace_id", scope.workspaceId)
      : supersedeQuery;
    await supersedeQuery;
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
