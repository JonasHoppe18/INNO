import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  SUPPORTED_SUPPORT_LANGUAGE_CODES,
  SUPPORT_LANGUAGE_LABELS,
  normalizeSupportLanguage,
} from "@/lib/translation/languages";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TRANSLATION_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtml(value = "") {
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

function getConversationRole(message) {
  const providerMessageId = String(message?.provider_message_id || "").trim();
  if (providerMessageId.startsWith("internal-note:")) return "internal";
  if (message?.from_me) return "support";
  return "customer";
}

function getMessageTimestamp(message) {
  return (
    asString(message?.received_at) ||
    asString(message?.sent_at) ||
    asString(message?.created_at) ||
    asString(message?.updated_at) ||
    new Date(0).toISOString()
  );
}

function createSourceHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickLanguageCode(value, fallback = "unknown") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  return fallback;
}

function normalizeForTranslationCompare(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isUntranslatedItem(item, source, targetLanguage = "en") {
  const translatedText = asString(item?.translatedText);
  const sourceText = asString(source?.text);
  if (!translatedText || !sourceText) return false;
  const originalLanguage = pickLanguageCode(item?.originalLanguage);
  if (originalLanguage === "unknown" || originalLanguage === targetLanguage) return false;
  return normalizeForTranslationCompare(translatedText) === normalizeForTranslationCompare(sourceText);
}

function fallbackConversationPayload(items = []) {
  return {
    isFallback: true,
    sourceLanguageSummary: [],
    items: items.map((item) => ({
      id: item.id,
      role: item.role,
      originalLanguage: "unknown",
      translatedText: item.text,
    })),
  };
}

function fallbackDraftPayload(sourceText = "") {
  const text = asString(sourceText);
  if (!text) return null;
  return {
    isFallback: true,
    originalLanguage: "unknown",
    translatedText: text,
  };
}

function isLikelyFallbackConversationCache(cached, sourceItems = [], targetLanguage = "en") {
  if (!cached || !Array.isArray(cached.items) || targetLanguage === "en") return false;
  if (cached.isFallback) return true;

  const sourceById = new Map((sourceItems || []).map((item) => [String(item?.id || ""), item]));
  const cachedItems = cached.items || [];
  if (!cachedItems.length) return false;

  return cachedItems.every((item) => {
    const id = String(item?.id || "");
    const source = sourceById.get(id);
    if (!source) return false;
    const originalLanguage = pickLanguageCode(item?.originalLanguage);
    const translatedText = asString(item?.translatedText);
    return originalLanguage === "unknown" && translatedText === asString(source.text);
  }) || cachedItems.some((item) => {
    const id = String(item?.id || "");
    const source = sourceById.get(id);
    return source ? isUntranslatedItem(item, source, targetLanguage) : false;
  });
}

function isLikelyFallbackDraftCache(cached, sourceText = "", targetLanguage = "en") {
  if (!cached || targetLanguage === "en") return false;
  if (cached.isFallback) return true;
  return (
    pickLanguageCode(cached?.originalLanguage) === "unknown" &&
    asString(cached?.translatedText) === asString(sourceText)
  );
}

async function callOpenAITranslation({ targetLanguage, targetLanguageLabel, payloadType, items }) {
  if (!OPENAI_API_KEY || !Array.isArray(items) || !items.length) return null;

  const systemPrompt = [
    "You are an internal customer support translation engine.",
    `Translate all provided text into ${targetLanguageLabel} (${targetLanguage}).`,
    "If source text is already in the target language, keep it unchanged.",
    "Preserve meaning and tone.",
    "Respond ONLY valid JSON with no markdown.",
    "For each item include: id, originalLanguage (ISO-639-1 when possible), translatedText.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    type: payloadType,
    targetLanguage,
    items,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_TRANSLATION_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error?.message || `Translation request failed with ${response.status}.`;
    throw new Error(detail);
  }

  const content = asString(payload?.choices?.[0]?.message?.content);
  const parsed = safeJsonParse(content);
  if (!parsed || !Array.isArray(parsed?.items)) return null;
  return parsed.items;
}

async function callOpenAITranslationRepair({
  targetLanguage,
  targetLanguageLabel,
  sourceLanguage,
  item,
}) {
  if (!OPENAI_API_KEY || !item?.text) return null;

  const systemPrompt = [
    "You are an internal customer support translation engine.",
    `Translate the provided support message into ${targetLanguageLabel} (${targetLanguage}).`,
    `The detected source language is ${sourceLanguage || "unknown"}.`,
    "Do not translate instructions. Translate only the sourceText field.",
    "Do not return sourceText unchanged unless it is already in the target language.",
    "Preserve names, emails, order numbers, dates, and formatting.",
    "Respond ONLY valid JSON with no markdown: {\"id\":\"...\",\"originalLanguage\":\"...\",\"translatedText\":\"...\"}.",
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_TRANSLATION_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            id: item.id,
            role: item.role,
            sourceText: item.text,
            targetLanguage,
          }),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error?.message || `Translation repair failed with ${response.status}.`;
    throw new Error(detail);
  }

  const content = asString(payload?.choices?.[0]?.message?.content);
  return safeJsonParse(content);
}

async function repairUntranslatedItems({
  targetLanguage,
  targetLanguageLabel,
  sourceItems,
  normalizedItems,
}) {
  if (!OPENAI_API_KEY || !Array.isArray(sourceItems) || !Array.isArray(normalizedItems)) {
    return normalizedItems;
  }
  const sourceById = new Map(sourceItems.map((item) => [String(item?.id || ""), item]));
  const repaired = [...normalizedItems];

  for (let index = 0; index < repaired.length; index += 1) {
    const current = repaired[index];
    const source = sourceById.get(String(current?.id || ""));
    if (!source || !isUntranslatedItem(current, source, targetLanguage)) continue;

    try {
      const translated = await callOpenAITranslationRepair({
        targetLanguage,
        targetLanguageLabel,
        sourceLanguage: current.originalLanguage,
        item: source,
      });
      const nextItem = {
        id: source.id,
        role: source.role,
        originalLanguage: pickLanguageCode(translated?.originalLanguage, current.originalLanguage),
        translatedText: asString(translated?.translatedText) || current.translatedText,
      };
      if (!isUntranslatedItem(nextItem, source, targetLanguage)) {
        repaired[index] = nextItem;
      }
    } catch {
      // Keep the original item; the caller can still return the rest of the translated thread.
    }
  }

  return repaired;
}

async function getWorkspaceSupportLanguage(serviceClient, workspaceId) {
  if (!workspaceId) return "en";
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("support_language")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeSupportLanguage(data?.support_language || "en");
}

async function getScopedThread(serviceClient, scope, threadId) {
  const { data: thread, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, workspace_id, customer_language")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (error || !thread?.id) {
    return null;
  }
  return thread;
}

async function getCachedTranslation({
  serviceClient,
  workspaceId,
  threadId,
  sourceType,
  targetLanguage,
  sourceHash,
}) {
  if (!workspaceId) return null;
  const { data } = await serviceClient
    .from("thread_translations")
    .select("translated_payload")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .eq("source_type", sourceType)
    .eq("target_language", targetLanguage)
    .eq("source_hash", sourceHash)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.translated_payload ?? null;
}

async function upsertCachedTranslation({
  serviceClient,
  workspaceId,
  threadId,
  sourceType,
  targetLanguage,
  sourceHash,
  translatedPayload,
}) {
  if (!workspaceId) return;
  const nowIso = new Date().toISOString();
  await serviceClient.from("thread_translations").upsert(
    {
      workspace_id: workspaceId,
      thread_id: threadId,
      source_type: sourceType,
      target_language: targetLanguage,
      source_hash: sourceHash,
      translated_payload: translatedPayload,
      updated_at: nowIso,
    },
    {
      onConflict: "thread_id,source_type,target_language,source_hash",
      ignoreDuplicates: false,
    }
  );
}

async function buildConversationTranslation({
  serviceClient,
  workspaceId,
  threadId,
  targetLanguage,
}) {
  const { data: rows, error } = await serviceClient
    .from("mail_messages")
    .select(
      "id, provider_message_id, from_me, clean_body_text, body_text, body_html, received_at, sent_at, created_at, updated_at"
    )
    .eq("thread_id", threadId)
    .eq("is_draft", false)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const sourceItems = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const text = asString(row?.clean_body_text) || asString(row?.body_text) || stripHtml(row?.body_html || "");
      if (!text) return null;
      return {
        id: String(row.id),
        role: getConversationRole(row),
        text,
        timestamp: getMessageTimestamp(row),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (!sourceItems.length) {
    return {
      sourceLanguageSummary: [],
      items: [],
    };
  }

  const sourceHash = createSourceHash({
    type: "conversation",
    targetLanguage,
    items: sourceItems.map((item) => ({ id: item.id, role: item.role, text: item.text })),
  });

  const cached = await getCachedTranslation({
    serviceClient,
    workspaceId,
    threadId,
    sourceType: "conversation",
    targetLanguage,
    sourceHash,
  });
  const cachedLooksFallback = isLikelyFallbackConversationCache(cached, sourceItems, targetLanguage);
  if (
    cached?.items &&
    Array.isArray(cached.items) &&
    !cachedLooksFallback
  ) {
    return cached;
  }

  let translatedItems = null;
  try {
    translatedItems = await callOpenAITranslation({
      targetLanguage,
      targetLanguageLabel: SUPPORT_LANGUAGE_LABELS[targetLanguage] || "English",
      payloadType: "conversation",
      items: sourceItems.map((item) => ({
        id: item.id,
        role: item.role,
        text: item.text,
      })),
    });
  } catch {
    translatedItems = null;
  }

  const byId = new Map((translatedItems || []).map((item) => [String(item?.id || ""), item]));
  let normalizedItems = sourceItems.map((source) => {
    const translated = byId.get(source.id);
    return {
      id: source.id,
      role: source.role,
      originalLanguage: pickLanguageCode(translated?.originalLanguage),
      translatedText: asString(translated?.translatedText) || source.text,
    };
  });

  normalizedItems = await repairUntranslatedItems({
    targetLanguage,
    targetLanguageLabel: SUPPORT_LANGUAGE_LABELS[targetLanguage] || "English",
    sourceItems,
    normalizedItems,
  });

  const sourceLanguageSummary = Array.from(
    new Set(
      normalizedItems
        .map((item) => pickLanguageCode(item.originalLanguage, ""))
        .filter(Boolean)
    )
  );

  const payload =
    translatedItems && translatedItems.length
      ? {
          isFallback: false,
          sourceLanguageSummary,
          items: normalizedItems,
        }
      : fallbackConversationPayload(sourceItems);

  await upsertCachedTranslation({
    serviceClient,
    workspaceId,
    threadId,
    sourceType: "conversation",
    targetLanguage,
    sourceHash,
    translatedPayload: payload,
  });

  return payload;
}

async function getCurrentDraftSource(serviceClient, threadId) {
  const { data: draftRow, error: draftError } = await serviceClient
    .from("mail_messages")
    .select("id, body_text, body_html, updated_at")
    .eq("thread_id", threadId)
    .eq("from_me", true)
    .eq("is_draft", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftError) throw new Error(draftError.message);

  if (draftRow?.id) {
    const text = asString(draftRow?.body_text) || stripHtml(draftRow?.body_html || "");
    if (text) {
      return {
        id: String(draftRow.id),
        text,
      };
    }
  }

  const { data: aiDraftRows, error: aiDraftError } = await serviceClient
    .from("mail_messages")
    .select("id, ai_draft_text, updated_at")
    .eq("thread_id", threadId)
    .not("ai_draft_text", "is", null)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (aiDraftError) throw new Error(aiDraftError.message);

  const aiDraftRow = (Array.isArray(aiDraftRows) ? aiDraftRows : []).find((row) =>
    asString(row?.ai_draft_text)
  );
  if (!aiDraftRow?.id) return null;

  return {
    id: String(aiDraftRow.id),
    text: asString(aiDraftRow.ai_draft_text),
  };
}

async function buildDraftTranslation({
  serviceClient,
  workspaceId,
  threadId,
  targetLanguage,
}) {
  const draftSource = await getCurrentDraftSource(serviceClient, threadId);
  if (!draftSource?.text) {
    return null;
  }

  const sourceHash = createSourceHash({
    type: "draft",
    targetLanguage,
    item: { id: draftSource.id, text: draftSource.text },
  });

  const cached = await getCachedTranslation({
    serviceClient,
    workspaceId,
    threadId,
    sourceType: "draft",
    targetLanguage,
    sourceHash,
  });
  const cachedLooksFallback = isLikelyFallbackDraftCache(cached, draftSource.text, targetLanguage);
  if (
    cached?.translatedText &&
    !cachedLooksFallback
  ) {
    return cached;
  }

  let translatedItems = null;
  try {
    translatedItems = await callOpenAITranslation({
      targetLanguage,
      targetLanguageLabel: SUPPORT_LANGUAGE_LABELS[targetLanguage] || "English",
      payloadType: "draft",
      items: [{ id: draftSource.id, text: draftSource.text }],
    });
  } catch {
    translatedItems = null;
  }

  const translated = Array.isArray(translatedItems) ? translatedItems[0] : null;
  const payload = translated
    ? {
        isFallback: false,
        originalLanguage: pickLanguageCode(translated?.originalLanguage),
        translatedText: asString(translated?.translatedText) || draftSource.text,
      }
    : fallbackDraftPayload(draftSource.text);

  await upsertCachedTranslation({
    serviceClient,
    workspaceId,
    threadId,
    sourceType: "draft",
    targetLanguage,
    sourceHash,
    translatedPayload: payload,
  });

  return payload;
}

export async function GET(request, { params }) {
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
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ error: "Auth scope not found." }, { status: 404 });
    }

    const thread = await getScopedThread(serviceClient, scope, threadId);
    if (!thread?.id) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const workspaceSupportLanguage = await getWorkspaceSupportLanguage(
      serviceClient,
      scope.workspaceId || thread.workspace_id || null
    );
    const url = new URL(request.url);
    const requestedTargetLanguage = normalizeSupportLanguage(
      url.searchParams.get("targetLanguage") || workspaceSupportLanguage,
      workspaceSupportLanguage
    );
    const targetLanguage = SUPPORTED_SUPPORT_LANGUAGE_CODES.includes(requestedTargetLanguage)
      ? requestedTargetLanguage
      : workspaceSupportLanguage;

    const conversation = await buildConversationTranslation({
      serviceClient,
      workspaceId: scope.workspaceId || thread.workspace_id,
      threadId: thread.id,
      targetLanguage,
    });

    const draft = await buildDraftTranslation({
      serviceClient,
      workspaceId: scope.workspaceId || thread.workspace_id,
      threadId: thread.id,
      targetLanguage,
    });

    // Lazy backfill: store detected language from first customer item
    if (!thread.customer_language) {
      const firstCustomerItem = (conversation?.items || []).find(
        (item) => item.role === "customer" && item.originalLanguage && item.originalLanguage !== "unknown"
      );
      if (firstCustomerItem?.originalLanguage) {
        try {
          await serviceClient
            .from("mail_threads")
            .update({ customer_language: firstCustomerItem.originalLanguage })
            .eq("id", threadId);
        } catch {}
      }
    }

    return NextResponse.json(
      {
        success: true,
        threadId: thread.id,
        targetLanguage,
        conversation,
        draft,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Could not load translation." },
      { status: 500 }
    );
  }
}
