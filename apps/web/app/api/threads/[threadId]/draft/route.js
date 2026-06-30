import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { applySavedEditToGeneration } from "@/lib/server/draft-generation-coupling";
import { emitDraftEvent } from "@/lib/server/draft-feedback-events";
import { buildDraftEditedEvent } from "@/lib/server/draft-feedback-builders";
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

// NOTE: this route used to group mail_thread rows by provider_thread_id (and
// before that, by normalized subject). Both proved unsafe: email providers
// like Gmail reuse the same thread id across unrelated customer conversations
// when subjects look similar (e.g. auto-generated "New customer message on
// May 21"), so any IN(thread_id, ...) query would read/write drafts across
// different customers' tickets. We now strictly scope every read, update, and
// delete to a single mail_threads.id. A genuinely split conversation will lose
// the sibling row's history — that's an accepted trade-off vs. corrupting
// drafts on a live support inbox. — 2026-05-26

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

function classifyDraftEdit(originalAiText, finalText) {
  const diffSummary = summarizeDraftDiff(originalAiText, finalText);
  return diffSummary.identical_normalized
    ? "no_edit"
    : diffSummary.changed_materially
      ? "major_edit"
      : "minor_edit";
}

// Resolve the pipeline draft_id (the per-run UUID also stored on draft_generations)
// from the newest pending drafts row for this thread, captured BEFORE this save
// supersedes/inserts its own drafts row. Used as the explicit coupling key for the
// saved-edit outcome. Returns null when none is found (helper falls back to text).
async function loadPipelineDraftId(serviceClient, { threadKeys, workspaceId }) {
  const keys = Array.from(new Set((threadKeys || []).filter(Boolean)));
  if (!keys.length) return null;
  let query = serviceClient
    .from("drafts")
    .select("draft_id, created_at")
    .in("thread_id", keys)
    .eq("status", "pending")
    .not("draft_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data } = await query.maybeSingle();
  return data?.draft_id || null;
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
      .eq("thread_id", threadId)
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

  // Capture the pipeline draft_id BEFORE we supersede/insert drafts rows below,
  // so the saved-edit outcome couples to the right draft_generations row by its
  // explicit per-run id rather than by matching draft text.
  const pipelineDraftId = await loadPipelineDraftId(serviceClient, {
    threadKeys: [thread.provider_thread_id, threadId],
    workspaceId: scope.workspaceId || null,
  });

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

  const { data: existingDraft } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id, ai_draft_text, body_text")
      .eq("thread_id", threadId)
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
      .eq("thread_id", threadId)
      .is("from_me", false),
    scope
  );

  // Best-effort tracking in drafts table (legacy analytics).
  // Strict thread_id only — provider_thread_id fallback removed because Gmail
  // reuses it across unrelated conversations. — 2026-05-26
  if (scope.workspaceId) {
    await serviceClient
      .from("drafts")
      .update({ status: "superseded" })
      .eq("thread_id", threadId)
      .eq("platform", thread.provider || "smtp")
      .eq("status", "pending")
      .eq("workspace_id", scope.workspaceId);
  }

  // Skip analytics insert if we cannot scope to a workspace — a NULL workspace_id
  // row is a tenant-leakage vector (any workspace's analytics query could read it).
  // — 2026-05-26
  if (scope.workspaceId) {
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
      thread_id: threadId,
      workspace_id: scope.workspaceId,
      created_at: nowIso,
    });
  }

  if (originalAiDraftText && originalAiDraftText.trim() && originalAiDraftText.trim() !== nextBodyText.trim()) {
    await captureDraftEditFeedback({
      serviceClient,
      threadId,
      messageDraftId: draftId,
      sourceWasAiGenerated: true,
      originalAiText: originalAiDraftText,
      finalText: nextBodyText,
      createdAt: nowIso,
    }).catch((error) => {
      console.warn("[threads/draft] draft edit feedback capture failed", error?.message || error);
    });
    const editClassification = classifyDraftEdit(originalAiDraftText, nextBodyText);
    await applySavedEditToGeneration({
      serviceClient,
      draftId: pipelineDraftId,
      threadId,
      workspaceId: scope.workspaceId || null,
      editClassification,
      editDistance: null,
      fallback: { originalAiText: originalAiDraftText },
      logger: console,
    });
    // Feedback-1b: best-effort draft_edited event (never throws, never blocks the
    // save). Once-per-composer dedup — repeated autosaves collapse to one row.
    await emitDraftEvent({
      serviceClient,
      logger: console,
      ...buildDraftEditedEvent({
        threadId,
        shopId: mailbox?.shop_id || null,
        workspaceId: scope.workspaceId || null,
        agentUserId: clerkUserId,
        draftId: pipelineDraftId,
        composerMessageId: draftId,
        editClassification,
        provider: thread.provider,
      }),
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
  await applyScope(
    serviceClient
      .from("mail_messages")
      .delete()
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true),
    scope
  );

  await applyScope(
    serviceClient
      .from("mail_messages")
      .update({ ai_draft_text: null, updated_at: nowIso })
      .eq("thread_id", threadId)
      .is("from_me", false),
    scope
  );

  // Strict thread_id only — provider_thread_id fallback removed. — 2026-05-26
  if (scope.workspaceId) {
    await serviceClient
      .from("drafts")
      .update({ status: "superseded" })
      .eq("thread_id", threadId)
      .eq("platform", thread.provider || "smtp")
      .eq("status", "pending")
      .eq("workspace_id", scope.workspaceId);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
