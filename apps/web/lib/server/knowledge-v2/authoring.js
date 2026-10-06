// Smallest merchant authoring path for Returns knowledge:
//   capture source -> extract candidates -> review questions -> approve -> publish.
//
// Sources are original and authoritative only (merchant website, live Shopify
// policy, uploads, merchant input). Nothing is read from legacy knowledge tables.
// Tenant ids always come from the authorized context (A1).

import { randomUUID } from "node:crypto";
import { KnowledgeAuthzError, bindTenant } from "./authz.js";
import { activateRelease, sealRelease } from "./seal-release.js";
import { platformHashOf } from "../../../../../shared/knowledge-v2/platform.mjs";
import {
  canonicalJson,
  prepareSeal,
  unitContentHash,
} from "../../../../../shared/knowledge-v2/seal.mjs";
import { loadPlatformFromRepo } from "../../../../../shared/knowledge-v2/platform-node.mjs";
import { extractReferences } from "../../../../../shared/knowledge-v2/references.mjs";
import { validateUnit } from "../../../../../shared/knowledge-v2/units.mjs";
import {
  compileManualUnit,
  compileReturnsGuidanceUnits,
  manualStatus,
  normalizeManualDraft,
  parseReturnsGuidance,
  validateReturnsGuidanceUnits,
  validateManualDraft,
} from "./manual-authoring.js";
import {
  RETURNS_EXTRACTION_INSTRUCTIONS,
  RETURNS_EXTRACTION_SCHEMA,
  draftsFromExtraction,
} from "../../../../../shared/knowledge-v2/authoring/returns-extraction.mjs";
import {
  compileProductSupportProcedure,
  compileProductSupportKnowledgeSection,
  parseProductSupportDocument,
} from "../../../../../shared/knowledge-v2/authoring/product-support.mjs";
import {
  compileOrderStatusGuidanceUnit,
  parseOrderStatusGuidance,
} from "../../../../../shared/knowledge-v2/authoring/manual-order-status.mjs";
import {
  compileWarrantyGuidanceUnits,
  parseWarrantyGuidance,
} from "../../../../../shared/knowledge-v2/authoring/manual-warranty.mjs";

const SOURCE_TYPES = new Set([
  "website_page",
  "shopify_policy_live",
  "system_of_record_capture",
  "merchant_upload",
  "merchant_input",
]);

export async function captureSource({
  supabase,
  context,
  sourceType,
  sourceKey,
  text,
  rawBytes,
  mime = "text/plain",
  language = null,
  meta = {},
}) {
  if (!SOURCE_TYPES.has(sourceType))
    throw new KnowledgeAuthzError(
      400,
      "invalid_source_type",
      `Unsupported source type ${sourceType}.`,
    );
  if (!text?.trim())
    throw new KnowledgeAuthzError(
      400,
      "empty_source",
      "A source needs captured text.",
    );
  const contentHash = await platformHashOf(new TextEncoder().encode(text));

  let storagePath = null;
  if (rawBytes) {
    storagePath = `${context.workspaceId}/${context.shopId}/sources/${contentHash.slice("sha256:".length)}`;
    const upload = await supabase.storage
      .from("knowledge")
      .upload(storagePath, rawBytes, { contentType: mime, upsert: false });
    if (upload.error && !/exists/i.test(upload.error.message)) {
      throw new KnowledgeAuthzError(
        502,
        "source_upload_failed",
        upload.error.message,
      );
    }
  }

  const row = bindTenant(context, {
    source_type: sourceType,
    source_key: sourceKey,
    content_hash: contentHash,
    language,
    mime,
    text_content: text,
    storage_path: storagePath,
    meta,
  });
  const { error } = await supabase
    .from("kn2_sources")
    .upsert(row, {
      onConflict: "shop_id,source_key,content_hash",
      ignoreDuplicates: true,
    });
  if (error)
    throw new KnowledgeAuthzError(409, "source_rejected", error.message);
  const { data, error: readError } = await supabase
    .from("kn2_sources")
    .select("id, content_hash, captured_at")
    .eq("shop_id", context.shopId)
    .eq("source_key", sourceKey)
    .eq("content_hash", contentHash)
    .single();
  if (readError)
    throw new KnowledgeAuthzError(
      500,
      "source_lookup_failed",
      readError.message,
    );
  return data;
}

// The model reads the source and reports what it says; typed payloads are built
// deterministically from its report.
export async function extractReturnsCandidates({
  apiKey,
  model = "gpt-5.6-luna",
  sourceText,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: RETURNS_EXTRACTION_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: `Document:\n\n${sourceText}` }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "returns_extraction",
          strict: true,
          schema: RETURNS_EXTRACTION_SCHEMA,
        },
      },
      store: false,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new KnowledgeAuthzError(
      502,
      "extraction_failed",
      payload?.error?.message ?? `Extraction failed (${response.status}).`,
    );
  const text =
    typeof payload?.output_text === "string" && payload.output_text
      ? payload.output_text
      : (payload?.output ?? [])
          .flatMap((item) => item?.content ?? [])
          .filter((part) => part?.type === "output_text")
          .map((part) => part.text)
          .join("");
  if (!text)
    throw new KnowledgeAuthzError(
      502,
      "extraction_empty",
      "The extractor returned no content.",
    );
  return JSON.parse(text);
}

// URL-derived Returns proposals replace the corresponding frozen slot instead
// of creating a second overlapping slot. The mapping is derived from the
// active release; no unit identifiers are accepted from the browser.
export async function resolveReturnsSlotUnitIds({ supabase, context }) {
  const { release } = await activePinnedRelease({ supabase, context });
  const members = await openMembers({ supabase, context, seq: release.seq });
  const result = {};
  const find = (predicate) => members.find(predicate)?.unit_id ?? null;
  result.accepted = find((row) => row.slot_key === "returns.ELIG.accepted");
  result.window = find((row) => row.slot_key === "returns.ELIG.window");
  result.method = find((row) => row.slot_key === "returns.PROC.method");
  result.shipping = find(
    (row) =>
      (row.kind === "procedure" || row.kind === "guidance") &&
      row.family_key === "LOG",
  );
  result.payer = find((row) => row.slot_key === "returns.LOG.payer");
  result.address = find(
    (row) =>
      row.kind === "value" && row.payload?.value_type === "postal_address",
  );
  result.destination = find(
    (row) => row.slot_key === "returns.LOG.destination",
  );
  result.refund_expectation = find((row) => row.kind === "expectation");
  result.timing = find((row) => row.slot_key === "returns.MONEY.timing");
  result.exchange = find((row) => row.slot_key === "returns.EXCH.offered");
  result.restocking_none = find(
    (row) => row.slot_key === "returns.MONEY.restocking_fee",
  );
  result.item_conditions = find(
    (row) => row.slot_key === "returns.ELIG.item_conditions",
  );
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value),
  );
}

async function resolveReturnsGuidanceTargets({ supabase, context }) {
  const { release, pinned } = await activePinnedRelease({ supabase, context });
  const members = await openMembers({ supabase, context, seq: release.seq });
  const targets = {};
  const replaceUnitIds = [];
  const addTarget = (key, row) => {
    if (!row) return;
    targets[key] = row;
    replaceUnitIds.push(row.unit_id);
  };
  const global = (row) =>
    row && (!row.scope || Object.keys(row.scope).length === 0);
  for (const row of members.filter(
    (member) => member.domain_key === "returns" && global(member),
  )) {
    if (row.slot_key === "returns.ELIG.accepted") addTarget("accepted", row);
    else if (row.slot_key === "returns.ELIG.window") addTarget("window", row);
    else if (row.slot_key === "returns.ELIG.item_conditions")
      addTarget("item_conditions", row);
    else if (row.slot_key === "returns.PROC.method") addTarget("method", row);
    else if (row.slot_key === "returns.LOG.payer") addTarget("payer", row);
    else if (row.slot_key === "returns.LOG.destination")
      addTarget("destination", row);
    else if (
      row.kind === "value" && row.payload?.value_type === "postal_address"
    )
      addTarget("address", row);
    else if (row.slot_key === "returns.MONEY.timing") addTarget("timing", row);
    else if (row.slot_key === "returns.EXCH.offered")
      addTarget("exchange", row);
    else if (
      (row.kind === "procedure" || row.kind === "guidance") &&
      row.family_key === "LOG"
    )
      addTarget("shipping", row);
    else if (row.kind === "expectation" && row.domain_key === "returns")
      addTarget("refund_expectation", row);
  }
  return {
    release,
    pinned,
    members,
    targets,
    targetIdsByKey: Object.fromEntries(
      Object.entries(targets).map(([key, row]) => [key, row.unit_id]),
    ),
    replaceUnitIds: [...new Set(replaceUnitIds)],
  };
}

function sourceExcerptForReturnsKey(key, sourceText) {
  const lines = String(sourceText ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const patterns = {
    accepted:
      /accept|offer|return policy|right of cancellation|right to cancel|right of withdrawal/i,
    window:
      /\b(?:\d+\s+)?(?:calendar\s+)?days?\b|return window|delivery|order date/i,
    method: /contact|email|support/i,
    payer: /postage|return cost|paid by|shipping|you must pay/i,
    shipping: /track|trace|carrier|shipment/i,
    refund_expectation: /refund|reimburse|compensation|processing/i,
    timing: /refund|reimburse|compensation|processing/i,
    item_conditions:
      /original packaging|unused|resale|condition|safely wrapped/i,
    destination: /send the goods|return.*address|Nordre Fasanvej|postal/i,
    exchange: /exchange/i,
    restocking_none: /restock/i,
  };
  const pattern = patterns[key];
  if (!pattern) return null;
  const priority = {
    accepted: /return policy|returns? accepted|right to cancel/i,
    window:
      /return window|\b30\s+(?:calendar\s+)?days?\b|\b14\s+(?:calendar\s+)?days?\b|from delivery|from order/i,
    payer: /paid by you|return costs|costs.*return/i,
    shipping: /track|trace|carrier|shipment/i,
    method: /contact us|support@|email/i,
    item_conditions: /original packaging|safely wrapped|unused|resale/i,
    destination: /send the goods|Nordre Fasanvej|postal/i,
    timing:
      /refunds?\s+(?:are|is)|after the return|after receipt|reimburse|compensation|processing/i,
    refund_expectation:
      /refunds?\s+(?:are|is)|after the return|after receipt|reimburse|compensation|processing/i,
  }[key];
  const match =
    (priority && lines.find((line) => priority.test(line))) ||
    lines.find((line) => pattern.test(line));
  return match ? match.slice(0, 1200) : null;
}

export async function proposeReturnsDrafts({
  supabase,
  context,
  sourceId,
  extraction,
  sourceText = "",
  title = "Returns",
  unitIds: requestedUnitIds = null,
  createProposalReviews = false,
}) {
  let { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("shop_id", context.shopId)
    .eq("title", title)
    .maybeSingle();
  if (error)
    throw new KnowledgeAuthzError(500, "policy_lookup_failed", error.message);
  if (!policy) {
    const inserted = await supabase
      .from("kn2_policies")
      .insert(
        bindTenant(context, {
          domain_key: "returns",
          title,
          template_version: "returns-0.1.0",
          drafts: { unit_ids: {} },
          updated_by: context.clerkUserId,
        }),
      )
      .select("id, drafts, revision")
      .single();
    if (inserted.error)
      throw new KnowledgeAuthzError(
        409,
        "policy_rejected",
        inserted.error.message,
      );
    policy = inserted.data;
  }

  const unitIds = {
    ...(policy.drafts?.unit_ids ?? {}),
    ...(requestedUnitIds ?? {}),
  };
  for (const key of [
    "accepted",
    "window",
    "method",
    "shipping",
    "payer",
    "address",
    "destination",
    "refund_expectation",
    "timing",
    "exchange",
    "restocking_none",
    "item_conditions",
  ]) {
    if (!unitIds[key]) unitIds[key] = randomUUID();
  }

  const { drafts, questions } = draftsFromExtraction(extraction, {
    unitIds,
    sourceId,
    policyId: policy.id,
  });
  for (const item of drafts) {
    if ((!item.evidence || !item.evidence.length) && sourceText) {
      const excerpt = sourceExcerptForReturnsKey(item.key, sourceText);
      if (excerpt) item.evidence = [excerpt];
    }
  }
  const existing = policy.drafts?.units ?? {};
  const units = { ...existing };
  for (const item of drafts) {
    const previous = existing[item.unit_id];
    units[item.unit_id] = {
      ...item,
      // An already accepted value is not silently replaced by a new proposal.
      // JSONB normalizes key order, so the comparison must be canonical.
      review_state:
        (previous?.review_state === "accepted" ||
          previous?.review_state === "published") &&
        canonicalJson(previous.payload) === canonicalJson(item.payload)
          ? previous.review_state
          : "proposed",
      origin: "extraction",
      source_id: sourceId,
    };
  }

  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { unit_ids: unitIds, units, extraction_source_id: sourceId },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policy.id)
    .eq("shop_id", context.shopId)
    .select("id, drafts")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "policy_update_rejected",
      update.error.message,
    );

  // Review questions are the safety net of this flow, so an insert that fails
  // must surface. The open-item uniqueness is a partial index, which cannot be
  // used for upsert conflict inference: look first, insert second.
  const openItems = [];
  for (const question of questions) {
    // URL-derived findings belong to the captured source/policy. Keep the
    // original global keys for the frozen fixture authoring path, but avoid
    // letting an older source's open question swallow a new source's finding.
    const dedupeKey = createProposalReviews
      ? `returns:question:${sourceId}:${question.code}`
      : `returns:${question.code}`;
    const { data: existing, error: lookupError } = await supabase
      .from("kn2_review_items")
      .select("id")
      .eq("shop_id", context.shopId)
      .eq("dedupe_key", dedupeKey)
      .eq("status", "open")
      .maybeSingle();
    if (lookupError)
      throw new KnowledgeAuthzError(
        500,
        "review_item_lookup_failed",
        lookupError.message,
      );
    let id = existing?.id ?? null;
    if (!id) {
      const row = bindTenant(context, {
        policy_id: policy.id,
        item_type: "question",
        dedupe_key: dedupeKey,
        payload: {
          question: question.question,
          options: question.options ?? [],
          evidence: question.evidence ?? null,
          source_id: sourceId,
        },
      });
      const { data, error: itemError } = await supabase
        .from("kn2_review_items")
        .insert(row)
        .select("id")
        .single();
      // 23505 means another run opened the same question first; anything else is a real failure.
      if (itemError && itemError.code !== "23505")
        throw new KnowledgeAuthzError(
          409,
          "review_item_rejected",
          itemError.message,
        );
      id = data?.id ?? null;
    }
    openItems.push({
      code: question.code,
      question: question.question,
      options: question.options,
      evidence: question.evidence,
      id,
    });
  }

  // URL-derived typed candidates are independently reviewable. Keep this
  // opt-in so the original source-authoring tests and frozen Returns flow
  // retain their question-only behavior.
  if (createProposalReviews) {
    for (const item of drafts) {
      const dedupeKey = `returns:proposal:${sourceId}:${item.key}`;
      const { data: existing, error: lookupError } = await supabase
        .from("kn2_review_items")
        .select("id")
        .eq("shop_id", context.shopId)
        .eq("dedupe_key", dedupeKey)
        .eq("status", "open")
        .maybeSingle();
      if (lookupError)
        throw new KnowledgeAuthzError(
          500,
          "review_item_lookup_failed",
          lookupError.message,
        );
      if (existing?.id) continue;
      const row = bindTenant(context, {
        policy_id: policy.id,
        item_type: "change_proposal",
        requires_role: "merchant",
        dedupe_key: dedupeKey,
        vocabulary_request:
          "Review this source-backed Returns proposal before Sona uses it.",
        payload: {
          proposal_key: item.key,
          source_id: sourceId,
          domain_key: item.domain_key,
          evidence: item.evidence?.[0] ?? null,
          unit_id: item.unit_id,
        },
      });
      const { error: itemError } = await supabase
        .from("kn2_review_items")
        .insert(row)
        .select("id")
        .single();
      if (itemError && itemError.code !== "23505")
        throw new KnowledgeAuthzError(
          409,
          "review_item_rejected",
          itemError.message,
        );
    }
  }

  return {
    policyId: policy.id,
    drafts: Object.values(update.data.drafts.units ?? {}),
    questions: openItems,
  };
}

// Records a merchant's answer to a review question and turns it into a typed,
// merchant-confirmed draft. The answer, not the source, is the authority here.
export async function applyWindowAnswer({
  supabase,
  context,
  policyId,
  days,
  anchorFact,
  evidence,
  sourceId,
  answeredBy,
  reviewItemId = null,
}) {
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const unitId = policy.drafts?.unit_ids?.window;
  if (!unitId)
    throw new KnowledgeAuthzError(
      409,
      "no_window_unit",
      "No unit id is reserved for the window.",
    );
  const units = { ...(policy.drafts?.units ?? {}) };
  units[unitId] = {
    key: "window",
    unit_id: unitId,
    kind: "slot_rule",
    domain_key: "returns",
    family_key: "ELIG",
    slot_key: "returns.ELIG.window",
    audience: "customer",
    scope: {},
    origin_policy_id: policyId,
    evidence: evidence ? [evidence] : [],
    payload: {
      state: "configured",
      value: {
        duration: { amount: days, unit: "calendar_day" },
        anchor: { fact: anchorFact },
      },
      provenance: [{ source_id: sourceId, role: "supports" }],
    },
    review_state: "accepted",
    origin: "merchant_answer",
    reviewed_by: answeredBy ?? context.clerkUserId,
    reviewed_at: new Date().toISOString(),
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...policy.drafts, units },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "window_answer_rejected",
      update.error.message,
    );

  const resolution = {
    answer: `${days} calendar days from ${anchorFact}`,
    answered_by: answeredBy ?? context.clerkUserId,
  };
  let reviewUpdate = supabase
    .from("kn2_review_items")
    .update({
      status: "resolved",
      resolution,
      resolved_by: answeredBy ?? context.clerkUserId,
      resolved_role: context.role,
      resolved_at: new Date().toISOString(),
    })
    .eq("shop_id", context.shopId)
    .eq("policy_id", policyId)
    .eq("status", "open");
  reviewUpdate = reviewItemId
    ? reviewUpdate.eq("id", reviewItemId)
    : reviewUpdate.eq("dedupe_key", "returns:window_conflict");
  const { error: itemError } = await reviewUpdate;
  if (itemError)
    throw new KnowledgeAuthzError(
      409,
      "review_item_update_rejected",
      itemError.message,
    );
  return units[unitId];
}

// Exchange availability is a bounded clarification, not free-form prose. The
// merchant answer is compiled into the existing frozen Returns exchange slot.
export async function applyExchangeAnswer({
  supabase,
  context,
  policyId,
  offered,
  sourceId,
  answeredBy,
  reviewItemId = null,
}) {
  if (typeof offered !== "boolean")
    throw new KnowledgeAuthzError(
      422,
      "bounded_answer_required",
      "Choose whether exchanges are offered.",
    );
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const unitId = policy.drafts?.unit_ids?.exchange || randomUUID();
  const draft = {
    key: "exchange",
    unit_id: unitId,
    kind: "slot_rule",
    domain_key: "returns",
    family_key: "EXCH",
    slot_key: "returns.EXCH.offered",
    audience: "customer",
    scope: {},
    origin_policy_id: policyId,
    evidence: [],
    payload: {
      state: offered ? "configured" : "explicitly_none",
      ...(offered ? { value: { offered: true } } : {}),
      provenance: [{ source_id: sourceId, role: "supports" }],
    },
    review_state: "accepted",
    origin: "merchant_answer",
    reviewed_by: answeredBy ?? context.clerkUserId,
    reviewed_at: new Date().toISOString(),
  };
  const { pinned } = await activePinnedRelease({ supabase, context });
  const errors = [
    ...validateUnit(pinned.platform, draft),
    ...extractReferences(pinned.platform, draft.kind, draft.payload).errors,
  ];
  if (errors.length)
    throw new KnowledgeAuthzError(
      422,
      "bounded_answer_invalid",
      JSON.stringify(errors),
    );
  const units = { ...(policy.drafts?.units ?? {}), [unitId]: draft };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: {
        ...policy.drafts,
        unit_ids: { ...(policy.drafts?.unit_ids ?? {}), exchange: unitId },
        units,
      },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "exchange_answer_rejected",
      update.error.message,
    );
  const resolution = {
    decision: "confirmed",
    offered,
    answered_by: answeredBy ?? context.clerkUserId,
  };
  let reviewUpdate = supabase
    .from("kn2_review_items")
    .update({
      status: "resolved",
      resolution,
      resolved_by: answeredBy ?? context.clerkUserId,
      resolved_role: context.role,
      resolved_at: new Date().toISOString(),
    })
    .eq("shop_id", context.shopId)
    .eq("policy_id", policyId)
    .eq("status", "open");
  reviewUpdate = reviewItemId
    ? reviewUpdate.eq("id", reviewItemId)
    : reviewUpdate.eq("dedupe_key", "returns:exchanges_unknown");
  const { error: itemError } = await reviewUpdate;
  if (itemError)
    throw new KnowledgeAuthzError(
      409,
      "review_item_update_rejected",
      itemError.message,
    );
  return draft;
}

export async function approveDrafts({
  supabase,
  context,
  policyId,
  unitKeys,
  reviewedBy,
}) {
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const units = { ...(policy.drafts?.units ?? {}) };
  const approved = [];
  for (const [unitId, draft] of Object.entries(units)) {
    if (unitKeys !== "all" && !unitKeys.includes(draft.key)) continue;
    units[unitId] = {
      ...draft,
      review_state: "accepted",
      reviewed_by: reviewedBy ?? context.clerkUserId,
      reviewed_at: new Date().toISOString(),
    };
    approved.push(draft.key);
  }
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...policy.drafts, units },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "approval_rejected",
      update.error.message,
    );
  return approved;
}

export async function approveExtractedProposals({
  supabase,
  context,
  policyId,
  unitKeys = "all",
}) {
  if (context?.capability !== "knowledge.review.answer")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge review is not authorized.",
    );
  const approved = await approveDrafts({
    supabase,
    context,
    policyId,
    unitKeys,
    reviewedBy: context.clerkUserId,
  });
  const keySet = unitKeys === "all" ? null : new Set(unitKeys);
  const { data: items, error } = await supabase
    .from("kn2_review_items")
    .select("id, payload")
    .eq("shop_id", context.shopId)
    .eq("policy_id", policyId)
    .eq("status", "open")
    .eq("item_type", "change_proposal");
  if (error)
    throw new KnowledgeAuthzError(
      500,
      "review_item_lookup_failed",
      error.message,
    );
  for (const item of items ?? []) {
    if (keySet && !keySet.has(item.payload?.proposal_key)) continue;
    const result = await supabase
      .from("kn2_review_items")
      .update({
        status: "resolved",
        resolution: {
          decision: "approved",
          proposal_key: item.payload?.proposal_key,
        },
        resolved_by: context.clerkUserId,
        resolved_role: context.role,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("shop_id", context.shopId)
      .eq("status", "open");
    if (result.error)
      throw new KnowledgeAuthzError(
        409,
        "review_item_update_rejected",
        result.error.message,
      );
  }
  return approved;
}

export async function rejectExtractedProposals({
  supabase,
  context,
  policyId,
  unitKeys,
}) {
  if (context?.capability !== "knowledge.review.answer")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge review is not authorized.",
    );
  const selected = new Set(Array.isArray(unitKeys) ? unitKeys : []);
  if (!selected.size)
    throw new KnowledgeAuthzError(
      400,
      "proposal_required",
      "Choose a proposal to reject.",
    );
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const units = { ...(policy.drafts?.units ?? {}) };
  const rejected = [];
  for (const [unitId, draft] of Object.entries(units)) {
    if (!selected.has(draft.key)) continue;
    units[unitId] = {
      ...draft,
      review_state: "rejected",
      reviewed_by: context.clerkUserId,
      reviewed_at: new Date().toISOString(),
    };
    rejected.push(draft.key);
  }
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...policy.drafts, units },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId);
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "rejection_rejected",
      update.error.message,
    );
  const { data: items, error: itemLookupError } = await supabase
    .from("kn2_review_items")
    .select("id, payload")
    .eq("shop_id", context.shopId)
    .eq("policy_id", policyId)
    .eq("status", "open")
    .eq("item_type", "change_proposal");
  if (itemLookupError)
    throw new KnowledgeAuthzError(
      500,
      "review_item_lookup_failed",
      itemLookupError.message,
    );
  for (const item of items ?? []) {
    if (!selected.has(item.payload?.proposal_key)) continue;
    const result = await supabase
      .from("kn2_review_items")
      .update({
        status: "resolved",
        resolution: {
          decision: "rejected",
          proposal_key: item.payload?.proposal_key,
        },
        resolved_by: context.clerkUserId,
        resolved_role: context.role,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("shop_id", context.shopId)
      .eq("status", "open");
    if (result.error)
      throw new KnowledgeAuthzError(
        409,
        "review_item_update_rejected",
        result.error.message,
      );
  }
  return rejected;
}

function reviewResolutionKey(item) {
  if (item?.item_type === "change_proposal")
    return `proposal:${item.payload?.proposal_key || ""}`;
  if (item?.item_type === "schema_gap")
    return `gap:${
      String(item.dedupe_key || "")
        .split(":")
        .at(-1) || ""
    }`;
  return `question:${
    String(item?.dedupe_key || "")
      .split(":")
      .at(-1) || ""
  }`;
}

async function openReviewItemForResolution({
  supabase,
  context,
  policyId,
  resolutionKey,
}) {
  if (!policyId || typeof resolutionKey !== "string" || !resolutionKey.trim()) {
    throw new KnowledgeAuthzError(
      400,
      "review_item_required",
      "Choose a review item to resolve.",
    );
  }
  const { data: items, error } = await supabase
    .from("kn2_review_items")
    .select("id, policy_id, item_type, status, dedupe_key, payload")
    .eq("shop_id", context.shopId)
    .eq("policy_id", policyId)
    .eq("status", "open")
    .limit(100);
  if (error)
    throw new KnowledgeAuthzError(
      500,
      "review_item_lookup_failed",
      error.message,
    );
  const item = (items ?? []).find(
    (candidate) => reviewResolutionKey(candidate) === resolutionKey,
  );
  if (!item)
    throw new KnowledgeAuthzError(
      404,
      "review_item_not_found",
      "This review item is no longer open.",
    );
  return item;
}

// Resolve only the URL-derived review shapes. Every branch is bounded by an
// existing Returns contract; unsupported findings can be dismissed, but never
// converted into generic published prose.
export async function resolveReturnsReviewItem({
  supabase,
  context,
  policyId,
  resolutionKey,
  resolutionType,
  answer = {},
  edit = {},
}) {
  if (context?.capability !== "knowledge.review.answer")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge review is not authorized.",
    );
  const item = await openReviewItemForResolution({
    supabase,
    context,
    policyId,
    resolutionKey,
  });
  const code = String(item.dedupe_key || "")
    .split(":")
    .at(-1);

  if (item.item_type === "schema_gap") {
    if (resolutionType === "dismiss") {
      const update = await supabase
        .from("kn2_review_items")
        .update({
          status: "dismissed",
          resolution: {
            decision: "dismissed",
            reason: "merchant_marked_irrelevant",
          },
          resolved_by: context.clerkUserId,
          resolved_role: context.role,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("shop_id", context.shopId)
        .eq("status", "open");
      if (update.error)
        throw new KnowledgeAuthzError(
          409,
          "review_item_update_rejected",
          update.error.message,
        );
      return { decision: "dismissed", resolutionKey };
    }
    if (resolutionType === "needs_guidance") {
      const update = await supabase
        .from("kn2_review_items")
        .update({
          resolution: { decision: "guidance_needed" },
          resolved_by: context.clerkUserId,
          resolved_role: context.role,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("shop_id", context.shopId)
        .eq("status", "open");
      if (update.error)
        throw new KnowledgeAuthzError(
          409,
          "review_item_update_rejected",
          update.error.message,
        );
      return { decision: "guidance_needed", resolutionKey, status: "open" };
    }
    throw new KnowledgeAuthzError(
      422,
      "unsupported_resolution",
      "This finding is not representable by the current Knowledge contract. Dismiss it or keep it as a guidance gap.",
    );
  }

  if (item.item_type === "change_proposal") {
    const key = item.payload?.proposal_key;
    if (!key)
      throw new KnowledgeAuthzError(
        422,
        "proposal_required",
        "This proposal is missing its typed key.",
      );
    if (resolutionType === "confirm") {
      const approved = await approveExtractedProposals({
        supabase,
        context,
        policyId,
        unitKeys: [key],
      });
      return { decision: "approved", approved };
    }
    if (resolutionType === "reject") {
      const rejected = await rejectExtractedProposals({
        supabase,
        context,
        policyId,
        unitKeys: [key],
      });
      return { decision: "rejected", rejected };
    }
    if (resolutionType === "edit") {
      const result = await editExtractedProposal({
        supabase,
        context: { ...context, capability: "knowledge.draft.edit" },
        policyId,
        key,
        edit,
      });
      return { decision: "edited", proposal: result.proposal };
    }
    throw new KnowledgeAuthzError(
      422,
      "unsupported_resolution",
      "Choose confirm, edit, or reject for this typed proposal.",
    );
  }

  if (item.item_type === "question" && code === "window_conflict") {
    const days = Number(answer.days);
    const anchor = String(answer.anchor || "");
    if (
      ![14, 30].includes(days) ||
      !["delivery", "order_date"].includes(anchor)
    ) {
      throw new KnowledgeAuthzError(
        422,
        "bounded_answer_required",
        "Choose 14 or 30 calendar days and whether the period starts at delivery or order date.",
      );
    }
    const unit = await applyWindowAnswer({
      supabase,
      context,
      policyId,
      days,
      anchorFact:
        anchor === "delivery" ? "line_item.delivered_at" : "order.placed_at",
      evidence: item.payload?.evidence || null,
      sourceId: item.payload?.source_id || null,
      answeredBy: context.clerkUserId,
      reviewItemId: item.id,
    });
    return { decision: "confirmed", unit };
  }

  if (item.item_type === "question" && code === "exchanges_unknown") {
    const offered = answer.offered;
    if (typeof offered !== "boolean")
      throw new KnowledgeAuthzError(
        422,
        "bounded_answer_required",
        "Choose whether exchanges are offered.",
      );
    const unit = await applyExchangeAnswer({
      supabase,
      context,
      policyId,
      offered,
      sourceId: item.payload?.source_id || null,
      answeredBy: context.clerkUserId,
      reviewItemId: item.id,
    });
    return { decision: "confirmed", unit };
  }

  throw new KnowledgeAuthzError(
    422,
    "unsupported_resolution",
    "This review question needs a typed contract before it can be answered here.",
  );
}

export async function editExtractedProposal({
  supabase,
  context,
  policyId,
  key,
  edit = {},
}) {
  if (context?.capability !== "knowledge.draft.edit")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Draft editing is not authorized.",
    );
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const entry = Object.entries(policy.drafts?.units ?? {}).find(
    ([, draft]) => draft.key === key,
  );
  if (!entry)
    throw new KnowledgeAuthzError(
      404,
      "proposal_not_found",
      "This source-backed proposal could not be found.",
    );
  const [unitId, draft] = entry;
  const payload = { ...(draft.payload ?? {}) };
  const clean = (input) => String(input ?? "").trim();
  if (key === "accepted") {
    if (typeof edit.accepted !== "boolean")
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Choose whether the published policy accepts returns.",
      );
    payload.state = "configured";
    payload.value = { accepted: edit.accepted };
  } else if (key === "window") {
    const days = Number(edit.days);
    const anchor = clean(edit.anchor);
    if (
      !Number.isInteger(days) ||
      days <= 0 ||
      !["delivery", "order_date"].includes(anchor)
    )
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Enter a positive number of calendar days and choose delivery or order date.",
      );
    payload.state = "configured";
    payload.value = {
      duration: { amount: days, unit: "calendar_day" },
      anchor: {
        fact:
          anchor === "delivery" ? "line_item.delivered_at" : "order.placed_at",
      },
    };
  } else if (key === "payer") {
    const payer = clean(edit.payer);
    if (!["customer", "merchant"].includes(payer))
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Choose customer or merchant for return shipping.",
      );
    payload.state = "configured";
    payload.value =
      payer === "customer"
        ? { payer, mechanism: "customer_arranges" }
        : { payer, mechanism: "prepaid_by_merchant" };
  } else if (key === "exchange") {
    if (typeof edit.offered !== "boolean")
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Choose whether exchanges are offered.",
      );
    payload.state = edit.offered ? "configured" : "explicitly_none";
    if (edit.offered) payload.value = { offered: true };
    else delete payload.value;
  } else if (key === "method") {
    const method = clean(edit.method);
    if (
      ![
        "contact_support",
        "self_service_portal",
        "rma_request",
        "provider_portal",
        "in_store",
      ].includes(method)
    )
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Choose a supported way for a customer to start a return.",
      );
    payload.state = "configured";
    payload.value = { method };
  } else if (key === "shipping") {
    const tracked = clean(edit.tracked);
    if (!["required", "recommended"].includes(tracked))
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Choose required or recommended tracked shipping.",
      );
    if (tracked === "required" && draft.kind !== "procedure")
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "This proposal's published shape is guidance; changing it to a procedure requires a new source proposal.",
      );
    if (tracked === "recommended" && draft.kind !== "guidance")
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "This proposal's published shape is a procedure; changing it to guidance requires a new source proposal.",
      );
    payload.applies_to = "returns.return_shipment";
    payload.texts = [
      {
        role: tracked === "required" ? "steps" : "explanation",
        audience: "customer",
        locale: "en",
        text:
          tracked === "required"
            ? "Send the return with a tracked shipping service."
            : "Using a tracked shipping service is recommended so the return can be followed.",
      },
    ];
  } else if (key === "item_conditions") {
    const conditions = Array.isArray(edit.conditions)
      ? edit.conditions.filter((item) =>
          [
            "unused",
            "original_packaging",
            "tags_attached",
            "resaleable",
          ].includes(item),
        )
      : [];
    if (!conditions.length)
      throw new KnowledgeAuthzError(
        422,
        "unsupported_edit",
        "Choose at least one supported return condition.",
      );
    payload.state = "configured";
    payload.value = {
      conditions: conditions.map((item) => `return_subject.${item}`),
    };
  } else {
    throw new KnowledgeAuthzError(
      422,
      "unsupported_edit",
      "This proposal can only be changed by creating a new source-backed proposal; free-text edits are not supported.",
    );
  }
  const { pinned } = await activePinnedRelease({ supabase, context });
  const candidate = {
    ...draft,
    payload,
    review_state: "proposed",
    reviewed_by: null,
    reviewed_at: null,
  };
  const errors = [
    ...validateUnit(pinned.platform, { ...candidate, unit_id: unitId }),
    ...extractReferences(pinned.platform, candidate.kind, payload).errors,
  ];
  if (errors.length)
    throw new KnowledgeAuthzError(
      422,
      "unsupported_edit",
      JSON.stringify(errors),
    );
  const units = { ...(policy.drafts?.units ?? {}), [unitId]: candidate };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...policy.drafts, units },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId);
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "proposal_update_rejected",
      update.error.message,
    );
  return { policyId, key, proposal: candidate };
}

export async function createSourceGapItems({
  supabase,
  context,
  policyId,
  sourceId,
  findings = [],
}) {
  const created = [];
  for (const finding of findings) {
    const dedupeKey = `returns:source-gap:${sourceId}:${finding.code}`;
    const lookup = await supabase
      .from("kn2_review_items")
      .select("id")
      .eq("shop_id", context.shopId)
      .eq("dedupe_key", dedupeKey)
      .eq("status", "open")
      .maybeSingle();
    if (lookup.error)
      throw new KnowledgeAuthzError(
        500,
        "review_item_lookup_failed",
        lookup.error.message,
      );
    if (lookup.data?.id) {
      created.push({ ...finding, id: lookup.data.id });
      continue;
    }
    const row = bindTenant(context, {
      policy_id: policyId,
      item_type: "schema_gap",
      requires_role: "merchant",
      dedupe_key: dedupeKey,
      vocabulary_request: finding.message,
      payload: {
        source_id: sourceId,
        domain_key: "returns",
        reason: finding.message,
        evidence: finding.evidence ?? null,
      },
    });
    const inserted = await supabase
      .from("kn2_review_items")
      .insert(row)
      .select("id")
      .single();
    if (inserted.error && inserted.error.code !== "23505")
      throw new KnowledgeAuthzError(
        409,
        "review_item_rejected",
        inserted.error.message,
      );
    created.push({ ...finding, id: inserted.data?.id ?? null });
  }
  return created;
}

export async function markExtractedPublished({
  supabase,
  context,
  policyId,
  seq,
}) {
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const units = Object.fromEntries(
    Object.entries(policy.drafts?.units ?? {}).map(([unitId, draft]) => [
      unitId,
      draft.review_state === "accepted"
        ? {
            ...draft,
            review_state: "published",
            published_seq: seq,
            published_at: new Date().toISOString(),
          }
        : draft,
    ]),
  );
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...policy.drafts, units },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId);
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "publish_state_rejected",
      update.error.message,
    );
  return { policyId, seq };
}

// Compiles accepted drafts into a release and activates it.
export async function publishReturns({ supabase, context, policyId, pinned }) {
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);

  const accepted = Object.values(policy.drafts?.units ?? {}).filter(
    (draft) => draft.review_state === "accepted",
  );
  if (!accepted.length)
    throw new KnowledgeAuthzError(
      422,
      "nothing_accepted",
      "No accepted drafts to publish.",
    );

  const { data: releases, error: releaseError } = await supabase
    .from("kn2_releases")
    .select("seq, platform_version, platform_hash")
    .eq("shop_id", context.shopId)
    .order("seq", { ascending: false })
    .limit(1);
  if (releaseError)
    throw new KnowledgeAuthzError(
      500,
      "release_lookup_failed",
      releaseError.message,
    );
  const latest = releases?.[0] ?? null;

  const members = latest
    ? await openMembers({ supabase, context, seq: latest.seq })
    : [];
  const units = accepted.map((draft) => ({
    unit_id: draft.unit_id,
    kind: draft.kind,
    domain_key: draft.domain_key,
    family_key: draft.family_key ?? null,
    slot_key: draft.slot_key ?? null,
    audience: draft.audience,
    scope: draft.scope ?? {},
    payload: draft.payload,
    origin_policy_id: draft.origin_policy_id,
  }));

  const changed = [];
  for (const unit of units) {
    const member = members.find((row) => row.unit_id === unit.unit_id);
    if (!member || member.content_hash !== (await unitContentHash(unit)))
      changed.push(unit);
  }
  if (!changed.length) return { seq: latest.seq, added: 0, reused: true };

  const prepared = await prepareSeal({
    platform: pinned,
    parent: latest
      ? {
          seq: latest.seq,
          platform_version: latest.platform_version,
          platform_hash: latest.platform_hash,
        }
      : null,
    members,
    add: changed,
    close: [],
    kind: "publish",
  });
  if (!prepared.ok)
    throw new KnowledgeAuthzError(
      422,
      "seal_invalid",
      JSON.stringify(prepared.errors),
    );

  const seq = await sealRelease({ supabase, context, prepared });
  return { seq, added: changed.length, reused: false, prepared };
}

export async function openMembers({ supabase, context, seq }) {
  const { data, error } = await supabase
    .from("kn2_unit_versions")
    .select(
      "id, unit_id, version, kind, domain_key, family_key, slot_key, audience, period_start, period_end, period_basis, scope, payload, content_hash, origin_policy_id, from_seq, to_seq",
    )
    .eq("shop_id", context.shopId)
    .lte("from_seq", seq);
  if (error)
    throw new KnowledgeAuthzError(500, "member_lookup_failed", error.message);
  return (data ?? []).filter((row) => row.to_seq === null || row.to_seq > seq);
}

export { activateRelease };

export async function activePinnedRelease({ supabase, context }) {
  const { data, error } = await supabase
    .from("kn2_releases")
    .select("seq, platform_version, platform_hash, activated_at")
    .eq("shop_id", context.shopId)
    .not("activated_at", "is", null)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new KnowledgeAuthzError(500, "release_lookup_failed", error.message);
  if (!data)
    throw new KnowledgeAuthzError(
      409,
      "no_active_release",
      "Publish a platform release before adding merchant Knowledge.",
    );
  const pinned = await loadPlatformFromRepo(data.platform_version);
  if (pinned.hash !== data.platform_hash) {
    throw new KnowledgeAuthzError(
      409,
      "platform_pin_mismatch",
      "The active Knowledge platform could not be verified.",
    );
  }
  return { release: data, pinned };
}

async function findOpenReviewItem({ supabase, context, policyId }) {
  const { data, error } = await supabase
    .from("kn2_review_items")
    .select("id")
    .eq("shop_id", context.shopId)
    .eq("policy_id", policyId)
    .eq("status", "open")
    .eq("dedupe_key", `manual:${policyId}`)
    .maybeSingle();
  if (error)
    throw new KnowledgeAuthzError(
      500,
      "review_item_lookup_failed",
      error.message,
    );
  return data ?? null;
}

async function ensureManualReviewItem({
  supabase,
  context,
  policyId,
  draft,
  sourceId,
}) {
  const existing = await findOpenReviewItem({ supabase, context, policyId });
  if (existing) return existing.id;
  const row = bindTenant(context, {
    policy_id: policyId,
    item_type: "change_proposal",
    requires_role: "merchant",
    dedupe_key: `manual:${policyId}`,
    vocabulary_request: "Review this manual Knowledge before Sona uses it.",
    payload: {
      question: `Review “${draft.title}” before Sona uses it.`,
      scenario: draft.customerContent,
      domain_key: draft.domain,
      knowledge_type: draft.knowledgeType,
      source_id: sourceId,
    },
  });
  const { data, error } = await supabase
    .from("kn2_review_items")
    .insert(row)
    .select("id")
    .single();
  if (error)
    throw new KnowledgeAuthzError(409, "review_item_rejected", error.message);
  return data.id;
}

async function sourceExists({ supabase, context, sourceId }) {
  if (!sourceId) return false;
  const { data, error } = await supabase
    .from("kn2_sources")
    .select("id")
    .eq("shop_id", context.shopId)
    .eq("id", sourceId)
    .maybeSingle();
  if (error)
    throw new KnowledgeAuthzError(500, "source_lookup_failed", error.message);
  return Boolean(data?.id);
}

async function resolveReplacementUnit({ supabase, context, sourceUnitId }) {
  if (!sourceUnitId) return null;
  let result = await supabase
    .from("kn2_unit_versions")
    .select(
      "unit_id, id, kind, domain_key, family_key, slot_key, audience, scope, payload, origin_policy_id",
    )
    .eq("shop_id", context.shopId)
    .eq("id", sourceUnitId)
    .is("to_seq", null)
    .maybeSingle();
  if (result.error)
    throw new KnowledgeAuthzError(
      500,
      "unit_lookup_failed",
      result.error.message,
    );
  if (result.data) return result.data;
  result = await supabase
    .from("kn2_unit_versions")
    .select(
      "unit_id, id, kind, domain_key, family_key, slot_key, audience, scope, payload, origin_policy_id",
    )
    .eq("shop_id", context.shopId)
    .eq("unit_id", sourceUnitId)
    .is("to_seq", null)
    .maybeSingle();
  if (result.error)
    throw new KnowledgeAuthzError(
      500,
      "unit_lookup_failed",
      result.error.message,
    );
  if (!result.data)
    throw new KnowledgeAuthzError(
      404,
      "published_unit_not_found",
      "The published Knowledge item is no longer available.",
    );
  return result.data;
}

function publicManualDraft(manual, validation, policyId, reviewItemId = null) {
  return {
    policyId,
    title: manual.title,
    domain: manual.domain,
    customerContent: manual.customerContent,
    appliesTo: manual.appliesTo,
    condition: manual.condition,
    knowledgeType: manual.knowledgeType,
    sourceId: manual.source_id ?? manual.sourceId ?? null,
    unitId: manual.unit_id ?? manual.unitId ?? null,
    reviewState: manual.review_state,
    status: manualStatus(manual.review_state),
    reviewItemId,
    validation,
  };
}

function publicReturnsGuidanceDraft(manual, validation, policyId) {
  return {
    policyId,
    title: manual.title,
    domain: "returns",
    customerContent: manual.customerContent,
    appliesTo: manual.appliesTo,
    sourceId: manual.source_id || null,
    reviewState: manual.review_state,
    status:
      manual.review_state === "published"
        ? "Published"
        : manual.review_state === "approved"
          ? "Needs review"
          : "Draft",
    proposals: (manual.proposals || []).map((proposal) => ({
      key: proposal.key,
      title:
        RETURNS_GUIDANCE_TITLES[proposal.key] || proposal.title || proposal.key,
      sentence: proposal.sentence,
      status:
        manual.review_state === "published"
          ? "Published"
          : manual.review_state === "approved"
            ? "Approved"
            : "Ready for review",
    })),
    ambiguities: manual.ambiguities || [],
    unsupported: manual.unsupported || [],
    validation,
  };
}

const RETURNS_GUIDANCE_TITLES = Object.freeze({
  accepted: "Return eligibility",
  window: "Return window",
  method: "Starting a return",
  payer: "Return shipping",
  shipping: "Tracked return shipping",
  destination: "Return destination",
  refund_expectation: "Refund processing",
  timing: "Refund processing",
  exchange: "Exchanges",
  item_conditions: "Return condition",
});

const CANONICAL_GUIDANCE_CONFIG = Object.freeze({
  order_status: Object.freeze({
    field: "order_status_guidance",
    title: "Shipping & Order Status",
    parser: parseOrderStatusGuidance,
    compile: compileOrderStatusGuidanceUnit,
    unitKeys: ["merchant_guidance"],
  }),
  complaints_warranty: Object.freeze({
    field: "warranty_guidance",
    title: "Warranty & Complaints",
    parser: parseWarrantyGuidance,
    compile: compileWarrantyGuidanceUnits,
    unitKeys: ["eligibility", "evidence", "remedy"],
  }),
});

function publicCanonicalGuidanceDraft(draft, policyId) {
  return {
    policyId,
    domain: draft.domain,
    title: draft.title,
    customerContent: draft.customer_content ?? "",
    sourceId: draft.source_id ?? null,
    unitIds: Object.keys(draft.units ?? {}),
    proposals: draft.proposals ?? [],
    unsupported: draft.unsupported ?? [],
    ambiguities: draft.ambiguities ?? [],
    reviewState: draft.review_state ?? "draft",
    runtimeState: draft.runtime_state ?? "draft",
    validation: draft.validation ?? { ok: false, errors: [] },
    updatedAt: draft.updated_at ?? null,
  };
}

async function resolveCanonicalGuidanceTargets({ supabase, context, domain }) {
  const { release, pinned } = await activePinnedRelease({ supabase, context });
  const members = await openMembers({ supabase, context, seq: release.seq });
  const targets = {};
  for (const member of members) {
    if (member.domain_key !== domain || member.kind !== "value") continue;
    const ruleKey = member.payload?.rule_key;
    if (domain === "order_status" && ruleKey === "merchant_guidance") targets.merchant_guidance = member;
    if (domain === "complaints_warranty" && ["eligibility", "evidence", "remedy_scope"].includes(ruleKey)) targets[ruleKey === "remedy_scope" ? "remedy" : ruleKey] = member;
  }
  return {
    release,
    pinned,
    members,
    targets,
    targetIdsByKey: Object.fromEntries(Object.entries(targets).map(([key, value]) => [key, value.unit_id])),
  };
}

async function saveCanonicalTypedGuidance({ supabase, context, input = {}, domain }) {
  if (context?.capability !== "knowledge.draft.edit") throw new KnowledgeAuthzError(403, "forbidden", "Draft editing is not authorized.");
  const config = CANONICAL_GUIDANCE_CONFIG[domain];
  if (!config) throw new KnowledgeAuthzError(422, "domain_unsupported", "This Knowledge area is not supported.");
  const customerContent = String(input.customerContent || input.customer_content || "").trim();
  if (!customerContent) throw new KnowledgeAuthzError(422, "content_required", `Write the ${config.title} guidance you want Sona to use.`);
  if (customerContent.length > 8000) throw new KnowledgeAuthzError(422, "content_too_long", "Keep this guidance under 8,000 characters.");
  const policyId = String(input.policyId || input.policy_id || randomUUID());
  let existing = null;
  if (input.policyId) {
    const result = await supabase.from("kn2_policies").select("id, domain_key, drafts, revision, template_version").eq("id", policyId).eq("shop_id", context.shopId).maybeSingle();
    if (result.error) throw new KnowledgeAuthzError(500, "policy_lookup_failed", result.error.message);
    existing = result.data;
    if (!existing) throw new KnowledgeAuthzError(404, "policy_not_found", "The Knowledge draft could not be found.");
    if (existing.domain_key !== domain) throw new KnowledgeAuthzError(409, "domain_mismatch", "This draft belongs to another Knowledge area.");
    if (existing.drafts?.[config.field]?.review_state === "published") throw new KnowledgeAuthzError(409, "published_immutable", "Published Knowledge is immutable. Save a new draft change instead.");
  }
  const targets = await resolveCanonicalGuidanceTargets({ supabase, context, domain });
  const previous = existing?.drafts?.[config.field];
  const source = await captureSource({
    supabase,
    context,
    sourceType: "merchant_input",
    sourceKey: `manual-${domain}:${policyId}`,
    text: customerContent,
    language: "en",
    meta: { title: String(input.title || config.title), domain, parser: `${domain}-guidance-v1` },
  });
  const parsed = config.parser(customerContent);
  const unitIds = {};
  for (const key of config.unitKeys) unitIds[key] = targets.targetIdsByKey[key] || previous?.unit_ids?.[key] || randomUUID();
  const compiledRaw = domain === "order_status"
    ? config.compile({ parsed, sourceId: source.id, policyId, unitId: unitIds.merchant_guidance })
    : config.compile({ parsed, sourceId: source.id, policyId, unitIds });
  const compiled = (Array.isArray(compiledRaw) ? compiledRaw : compiledRaw ? [compiledRaw] : []);
  const unitErrors = compiled.flatMap((unit) => validateUnit(targets.pinned.platform, unit).map((error) => ({ ...error, unit_id: unit.unit_id })));
  const validUnits = compiled.filter((unit) => !unitErrors.some((error) => error.unit_id === unit.unit_id));
  const errors = [
    ...(parsed.ambiguities ?? []).map((finding) => ({ code: "ambiguous_statement", field: "customerContent", message: finding.message, sentence: finding.sentence })),
    ...(parsed.unsupported ?? []).map((finding) => ({ code: "unsupported_statement", field: "customerContent", message: finding.message, sentence: finding.sentence })),
    ...unitErrors,
  ];
  const targetIds = Object.values(targets.targetIdsByKey);
  const replaceUnitIds = targetIds.filter((unitId) => !validUnits.some((unit) => String(unit.unit_id).toLowerCase() === String(unitId).toLowerCase()));
  const draft = {
    domain,
    title: String(input.title || config.title),
    customer_content: customerContent,
    source_id: source.id,
    units: Object.fromEntries(validUnits.map((unit) => [unit.unit_id, { ...unit, review_state: "ready_for_review" }])),
    unit_ids: Object.fromEntries(validUnits.map((unit) => [
      unit.payload?.rule_key === "remedy_scope" ? "remedy" : unit.payload?.rule_key || "merchant_guidance",
      unit.unit_id,
    ])),
    replace_unit_ids: replaceUnitIds,
    proposals: parsed.proposals ?? [],
    unsupported: parsed.unsupported ?? [],
    ambiguities: parsed.ambiguities ?? [],
    validation: { ok: validUnits.length > 0 && (parsed.ambiguities ?? []).length === 0, errors },
    review_state: validUnits.length > 0 && (parsed.ambiguities ?? []).length === 0 ? "ready_for_review" : "draft",
    runtime_state: validUnits.length > 0 && (parsed.ambiguities ?? []).length === 0 ? "ready_to_publish" : "draft_evidence_only",
    updated_by: context.clerkUserId,
    updated_at: new Date().toISOString(),
  };
  const row = bindTenant(context, { id: policyId, domain_key: domain, title: draft.title, template_version: targets.pinned.version, drafts: { ...(existing?.drafts || {}), [config.field]: draft }, updated_by: context.clerkUserId });
  const update = existing
    ? await supabase.from("kn2_policies").update({ domain_key: domain, title: draft.title, template_version: row.template_version, drafts: row.drafts, updated_by: row.updated_by, revision: (existing.revision ?? 0) + 1 }).eq("id", policyId).eq("shop_id", context.shopId).select("id").single()
    : await supabase.from("kn2_policies").insert(row).select("id").single();
  if (update.error) throw new KnowledgeAuthzError(409, "draft_rejected", update.error.message);
  return { policyId, draft: publicCanonicalGuidanceDraft(draft, policyId), pinned: { version: targets.pinned.version, hash: targets.pinned.hash } };
}

async function approveCanonicalTypedGuidance({ supabase, context, policyId, domain }) {
  if (context?.capability !== "knowledge.review.answer") throw new KnowledgeAuthzError(403, "forbidden", "Knowledge review is not authorized.");
  const config = CANONICAL_GUIDANCE_CONFIG[domain];
  const result = await supabase.from("kn2_policies").select("id, domain_key, drafts, revision").eq("id", policyId).eq("shop_id", context.shopId).single();
  if (result.error) throw new KnowledgeAuthzError(404, "policy_not_found", result.error.message);
  if (result.data.domain_key !== domain) throw new KnowledgeAuthzError(409, "domain_mismatch", "This draft belongs to another Knowledge area.");
  const draft = result.data.drafts?.[config.field];
  if (!draft || !draft.validation?.ok || !Object.keys(draft.units ?? {}).length) throw new KnowledgeAuthzError(422, "draft_invalid", "There are no safely supported statements ready to publish.");
  const { pinned } = await activePinnedRelease({ supabase, context });
  const errors = Object.values(draft.units).flatMap((unit) => validateUnit(pinned.platform, unit));
  if (errors.length) throw new KnowledgeAuthzError(422, "draft_invalid", JSON.stringify(errors));
  const approved = { ...draft, review_state: "approved", runtime_state: "ready_to_publish", validation: { ok: true, errors: [] }, units: Object.fromEntries(Object.entries(draft.units).map(([unitId, unit]) => [unitId, { ...unit, review_state: "approved", reviewed_by: context.clerkUserId, reviewed_at: new Date().toISOString() }])) };
  const update = await supabase.from("kn2_policies").update({ drafts: { ...(result.data.drafts || {}), [config.field]: approved }, revision: (result.data.revision ?? 0) + 1, updated_by: context.clerkUserId }).eq("id", policyId).eq("shop_id", context.shopId).select("id").single();
  if (update.error) throw new KnowledgeAuthzError(409, "approval_rejected", update.error.message);
  return { policyId, draft: publicCanonicalGuidanceDraft(approved, policyId), pinned: { version: pinned.version, hash: pinned.hash } };
}

async function publishCanonicalTypedGuidance({ supabase, context, policyId, domain }) {
  if (context?.capability !== "knowledge.publish") throw new KnowledgeAuthzError(403, "forbidden", "Knowledge publishing is not authorized.");
  const config = CANONICAL_GUIDANCE_CONFIG[domain];
  const result = await supabase.from("kn2_policies").select("id, domain_key, drafts").eq("id", policyId).eq("shop_id", context.shopId).single();
  if (result.error) throw new KnowledgeAuthzError(404, "policy_not_found", result.error.message);
  if (result.data.domain_key !== domain) throw new KnowledgeAuthzError(409, "domain_mismatch", "This draft belongs to another Knowledge area.");
  const draft = result.data.drafts?.[config.field];
  if (!draft || draft.review_state !== "approved") throw new KnowledgeAuthzError(422, "approval_required", "Approve the valid Knowledge before publishing it.");
  const { release: parent, pinned } = await activePinnedRelease({ supabase, context });
  const members = await openMembers({ supabase, context, seq: parent.seq });
  const units = Object.values(draft.units || {}).filter((unit) => unit.review_state === "approved").map(({ review_state: _reviewState, reviewed_by: _reviewedBy, reviewed_at: _reviewedAt, ...unit }) => unit);
  const errors = units.flatMap((unit) => validateUnit(pinned.platform, unit));
  if (errors.length) throw new KnowledgeAuthzError(422, "draft_invalid", JSON.stringify(errors));
  const close = (draft.replace_unit_ids || []).filter((unitId) => members.some((member) => String(member.unit_id).toLowerCase() === String(unitId).toLowerCase()));
  const changed = [];
  for (const unit of units) {
    const previous = members.find((member) => String(member.unit_id).toLowerCase() === String(unit.unit_id).toLowerCase());
    if (!previous || previous.content_hash !== (await unitContentHash(unit))) changed.push(unit);
  }
  if (!changed.length && !close.length) return { policyId, seq: parent.seq, added: 0, closed: 0, reused: true, activated: Boolean(parent.activated_at), draft };
  const prepared = await prepareSeal({ platform: pinned, parent: { seq: parent.seq, platform_version: parent.platform_version, platform_hash: parent.platform_hash }, members, add: changed, close, kind: "publish" });
  if (!prepared.ok) throw new KnowledgeAuthzError(422, "seal_invalid", JSON.stringify(prepared.errors));
  const seq = await sealRelease({ supabase, context, prepared });
  return { policyId, seq, added: changed.length, closed: close.length, reused: false, prepared, draft };
}

async function markCanonicalTypedGuidancePublished({ supabase, context, policyId, seq, domain }) {
  const config = CANONICAL_GUIDANCE_CONFIG[domain];
  const result = await supabase.from("kn2_policies").select("id, domain_key, drafts, revision").eq("id", policyId).eq("shop_id", context.shopId).single();
  if (result.error) throw new KnowledgeAuthzError(404, "policy_not_found", result.error.message);
  if (result.data.domain_key !== domain) throw new KnowledgeAuthzError(409, "domain_mismatch", "This draft belongs to another Knowledge area.");
  const draft = result.data.drafts?.[config.field];
  if (!draft) throw new KnowledgeAuthzError(422, "draft_required", "The canonical Knowledge draft was not found.");
  const publishedAt = new Date().toISOString();
  const published = { ...draft, review_state: "published", runtime_state: "published", published_seq: seq, published_at: publishedAt, units: Object.fromEntries(Object.entries(draft.units || {}).map(([unitId, unit]) => [unitId, { ...unit, review_state: "published", published_seq: seq, published_at: publishedAt }])) };
  const update = await supabase.from("kn2_policies").update({ drafts: { ...(result.data.drafts || {}), [config.field]: published }, revision: (result.data.revision ?? 0) + 1, updated_by: context.clerkUserId }).eq("id", policyId).eq("shop_id", context.shopId).select("id").single();
  if (update.error) throw new KnowledgeAuthzError(409, "publish_state_rejected", update.error.message);
  return { policyId, seq, draft: publicCanonicalGuidanceDraft(published, policyId) };
}

export async function saveOrderStatusGuidanceDraft({ supabase, context, input = {} }) {
  return saveCanonicalTypedGuidance({ supabase, context, input, domain: "order_status" });
}
export async function approveOrderStatusGuidanceDraft({ supabase, context, policyId }) {
  return approveCanonicalTypedGuidance({ supabase, context, policyId, domain: "order_status" });
}
export async function publishOrderStatusGuidanceDraft({ supabase, context, policyId }) {
  return publishCanonicalTypedGuidance({ supabase, context, policyId, domain: "order_status" });
}
export async function markOrderStatusGuidancePublished({ supabase, context, policyId, seq }) {
  return markCanonicalTypedGuidancePublished({ supabase, context, policyId, seq, domain: "order_status" });
}
export async function saveWarrantyGuidanceDraft({ supabase, context, input = {} }) {
  return saveCanonicalTypedGuidance({ supabase, context, input, domain: "complaints_warranty" });
}
export async function approveWarrantyGuidanceDraft({ supabase, context, policyId }) {
  return approveCanonicalTypedGuidance({ supabase, context, policyId, domain: "complaints_warranty" });
}
export async function publishWarrantyGuidanceDraft({ supabase, context, policyId }) {
  return publishCanonicalTypedGuidance({ supabase, context, policyId, domain: "complaints_warranty" });
}
export async function markWarrantyGuidancePublished({ supabase, context, policyId, seq }) {
  return markCanonicalTypedGuidancePublished({ supabase, context, policyId, seq, domain: "complaints_warranty" });
}

async function resolveReturnsScope({ supabase, context, input }) {
  const productIds = Array.isArray(input?.productIds)
    ? [
        ...new Set(
          input.productIds.map((value) => String(value).trim()).filter(Boolean),
        ),
      ]
    : [];
  const appliesTo = String(input?.appliesTo || "All supported products").trim();
  if (
    !productIds.length &&
    (!appliesTo || /^(all products|all supported products)$/i.test(appliesTo))
  )
    return {};
  if (!productIds.length) {
    throw new KnowledgeAuthzError(
      422,
      "product_scope_required",
      "Choose products from the connected catalog instead of naming them in free text.",
    );
  }
  if (productIds.some((id) => !/^\d+$/.test(id))) {
    throw new KnowledgeAuthzError(
      422,
      "product_scope_invalid",
      "The selected products could not be verified in this shop.",
    );
  }
  const { data, error } = await supabase
    .from("shop_products")
    .select("id, external_id, title")
    .eq("shop_ref_id", context.shopId)
    .in("id", productIds.map(Number));
  if (error)
    throw new KnowledgeAuthzError(
      500,
      "product_scope_lookup_failed",
      error.message,
    );
  if (!Array.isArray(data) || data.length !== productIds.length) {
    throw new KnowledgeAuthzError(
      422,
      "product_scope_invalid",
      "One or more selected products are not available in this shop.",
    );
  }
  // The frozen Returns evaluator deliberately ignores non-empty scopes in this
  // slice. Resolve and verify the catalog ids, then refuse to publish rather
  // than creating guidance that could never route at runtime.
  throw new KnowledgeAuthzError(
    422,
    "product_scope_unsupported",
    "Product-specific Returns guidance is not routable by the pinned Returns platform yet. Keep this guidance scoped to all supported products for now.",
  );
}

function stableReturnsValue(value) {
  if (Array.isArray(value)) return value.map(stableReturnsValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "provenance" && key !== "texts")
        .sort()
        .map((key) => [key, stableReturnsValue(value[key])]),
    );
  }
  return value;
}

function proposalKeyForUnit(unit) {
  if (unit.kind === "expectation") return "refund_expectation";
  if (unit.kind === "procedure" && unit.family_key === "LOG") return "shipping";
  const bySlot = {
    "returns.ELIG.accepted": "accepted",
    "returns.ELIG.window": "window",
    "returns.ELIG.item_conditions": "item_conditions",
    "returns.PROC.method": "method",
    "returns.LOG.payer": "payer",
    "returns.LOG.destination": "destination",
    "returns.MONEY.timing": "timing",
    "returns.EXCH.offered": "exchange",
  };
  if (unit.kind === "value" && unit.payload?.value_type === "postal_address") return "address";
  return bySlot[unit.slot_key] || null;
}

function returnsProposalMatchesTarget(proposal, target, targets) {
  if (!target || target.kind !== proposal.kind) return false;
  const current = proposal.value || {};
  if (proposal.key === "shipping") {
    return target.payload?.shipping?.tracked === current.tracked;
  }
  if (proposal.key === "address") {
    return JSON.stringify(stableReturnsValue(target.payload?.address || {})) ===
      JSON.stringify(stableReturnsValue(current));
  }
  if (proposal.key === "method") {
    return target.payload?.value?.method === current.method &&
      JSON.stringify(target.payload?.requirements || []) ===
      JSON.stringify(current.requirements || []);
  }
  if (proposal.key === "timing") {
    return target.payload?.value?.ref === targets.targets.refund_expectation?.unit_id;
  }
  if (proposal.key === "exchange") {
    const offered = target.payload?.state === "configured";
    return offered === Boolean(current.offered);
  }
  if (proposal.key === "refund_expectation") {
    return JSON.stringify(stableReturnsValue(target.payload)) ===
      JSON.stringify(stableReturnsValue({ ...current, provenance: undefined }));
  }
  return JSON.stringify(stableReturnsValue(target.payload?.value)) ===
    JSON.stringify(stableReturnsValue(current));
}

function reusableReturnsUnit(target, proposal) {
  return {
    unit_id: target.unit_id,
    kind: target.kind,
    domain_key: target.domain_key,
    family_key: target.family_key ?? null,
    slot_key: target.slot_key ?? null,
    audience: target.audience,
    period_start: target.period_start ?? null,
    period_end: target.period_end ?? null,
    period_basis: target.period_basis ?? null,
    scope: target.scope ?? {},
    payload: target.payload,
    origin_policy_id: target.origin_policy_id,
    evidence: proposal.sentence ? [proposal.sentence] : [],
  };
}

export async function saveReturnsGuidanceDraft({
  supabase,
  context,
  input = {},
}) {
  if (context?.capability !== "knowledge.draft.edit") {
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Draft editing is not authorized.",
    );
  }
  const customerContent = String(
    input.customerContent || input.customer_content || "",
  ).trim();
  if (!customerContent)
    throw new KnowledgeAuthzError(
      422,
      "content_required",
      "Write the Returns guidance you want Sona to use.",
    );
  if (customerContent.length > 4000)
    throw new KnowledgeAuthzError(
      422,
      "content_too_long",
      "Keep the Returns guidance under 4,000 characters.",
    );
  const policyId = String(input.policyId || input.policy_id || randomUUID());
  let existing = null;
  if (input.policyId) {
    const result = await supabase
      .from("kn2_policies")
      .select("id, drafts, revision")
      .eq("id", policyId)
      .eq("shop_id", context.shopId)
      .maybeSingle();
    if (result.error)
      throw new KnowledgeAuthzError(
        500,
        "policy_lookup_failed",
        result.error.message,
      );
    existing = result.data;
    if (!existing)
      throw new KnowledgeAuthzError(
        404,
        "policy_not_found",
        "The Returns draft could not be found.",
      );
    if (existing.drafts?.returns_guidance?.review_state === "published")
      throw new KnowledgeAuthzError(
        409,
        "published_immutable",
        "Published Knowledge is immutable. Save a new draft change instead.",
      );
  }

  const scope = await resolveReturnsScope({ supabase, context, input });
  const parsed = parseReturnsGuidance(customerContent);
  const targets = await resolveReturnsGuidanceTargets({ supabase, context });
  const unitIds = {};
  const replacementKeys = new Set(
    Array.isArray(input.replaceKeys)
      ? input.replaceKeys.map((key) => String(key).trim()).filter(Boolean)
      : [],
  );
  // The workspace creates a fresh immutable draft for each edit. Recover the
  // last published natural-language draft server-side as well, so deleting a
  // sentence cannot depend on browser session state. Only keys that were
  // previously authored and are now omitted are candidates for closure.
  const history = await supabase
    .from("kn2_policies")
    .select("drafts, updated_at")
    .eq("shop_id", context.shopId)
    .eq("domain_key", "returns")
    .order("updated_at", { ascending: false })
    .limit(25);
  if (history.error)
    throw new KnowledgeAuthzError(
      500,
      "returns_guidance_history_failed",
      history.error.message,
    );
  const previousManual = (history.data || [])
    .map((row) => row?.drafts?.returns_guidance)
    .find((draft) => draft?.review_state === "published");
  const currentKeys = new Set(parsed.proposals.map((proposal) => proposal.key));
  for (const key of previousManual?.proposals || []) {
    if (key?.key && !currentKeys.has(key.key)) replacementKeys.add(key.key);
  }
  for (const proposal of parsed.proposals) {
    const target = targets.targets[proposal.key];
    if (target && target.kind === proposal.kind) {
      unitIds[proposal.key] = target.unit_id;
    } else if (target) {
      // A kind change needs the old member explicitly closed; same-kind
      // changes are replaced automatically by the seal path.
      replacementKeys.add(proposal.key);
    }
  }
  const replaceUnitIds = [...replacementKeys]
    .map((key) => targets.targetIdsByKey[key])
    .filter(Boolean);
  const source = await captureSource({
    supabase,
    context,
    sourceType: "merchant_input",
    sourceKey: `manual-returns:${policyId}`,
    text: customerContent,
    language: "en",
    meta: {
      title: String(input.title || "Returns & Refunds"),
      domain: "returns",
      parser: "returns-guidance-v1",
      statements: parsed.statements,
    },
  });
  const compiledUnits = compileReturnsGuidanceUnits({
    proposals: parsed.proposals,
    sourceId: source.id,
    policyId,
    unitIds,
    scope,
  });
  const units = compiledUnits.map((unit) => {
    const proposal = parsed.proposals.find((item) => item.key === proposalKeyForUnit(unit));
    const target = proposal ? targets.targets[proposal.key] : null;
    return proposal && returnsProposalMatchesTarget(proposal, target, targets)
      ? reusableReturnsUnit(target, proposal)
      : unit;
  });
  const unitErrors = validateReturnsGuidanceUnits({
    units,
    platform: targets.pinned.platform,
  });
  const invalidUnitIds = new Set(
    unitErrors.map((error) => error.unit_id).filter(Boolean),
  );
  const validUnits = units.filter((unit) => !invalidUnitIds.has(unit.unit_id));
  const errors = [
    ...parsed.ambiguities.map((finding) => ({
      code: "ambiguous_statement",
      field: finding.key,
      message: finding.message,
      sentence: finding.sentence,
    })),
    ...parsed.unsupported.map((finding) => ({
      code: "unsupported_statement",
      field: "customerContent",
      message: finding.message,
      sentence: finding.sentence,
    })),
    ...unitErrors.map((error) => ({ ...error, message: error.message })),
  ];
  const manual = {
    title: String(input.title || "Returns & Refunds"),
    domain: "returns",
    customerContent,
    appliesTo: scope.product_ids?.length
      ? "Selected products"
      : "All supported products",
    scope,
    source_id: source.id,
    review_state: validUnits.length ? "ready_for_review" : "draft",
    units: Object.fromEntries(
      validUnits.map((unit) => [
        unit.unit_id,
        {
          ...unit,
          review_state: "ready_for_review",
          evidence: unit.evidence || [],
        },
      ]),
    ),
    unit_ids: Object.fromEntries(
      validUnits.map((unit) => [unit.unit_id, unit.unit_id]),
    ),
    // Only close members the editor explicitly removed (or whose typed kind
    // changed). Unmentioned published guidance remains active.
    replace_unit_ids: [...new Set(replaceUnitIds)],
    proposals: parsed.proposals,
    ambiguities: parsed.ambiguities,
    unsupported: parsed.unsupported,
    validation: { ok: validUnits.length > 0, errors },
    updated_by: context.clerkUserId,
    updated_at: new Date().toISOString(),
  };
  const row = bindTenant(context, {
    id: policyId,
    domain_key: "returns",
    title: manual.title,
    template_version: targets.pinned.version,
    drafts: { ...(existing?.drafts || {}), returns_guidance: manual },
    updated_by: context.clerkUserId,
  });
  const update = existing
    ? await supabase
        .from("kn2_policies")
        .update({
          domain_key: row.domain_key,
          title: row.title,
          template_version: row.template_version,
          drafts: row.drafts,
          updated_by: row.updated_by,
          revision: (existing.revision ?? 0) + 1,
        })
        .eq("id", policyId)
        .eq("shop_id", context.shopId)
        .select("id")
        .single()
    : await supabase.from("kn2_policies").insert(row).select("id").single();
  if (update.error)
    throw new KnowledgeAuthzError(409, "draft_rejected", update.error.message);
  return {
    policyId,
    draft: publicReturnsGuidanceDraft(manual, manual.validation, policyId),
    pinned: { version: targets.pinned.version, hash: targets.pinned.hash },
  };
}

// Product documents use the same tenant-scoped KN2 policy/source records as
// other merchant authoring. Only the deterministic Product Support procedure
// contract is eligible for a release; the original document remains source
// evidence and is never injected into the writer.
export async function saveProductGuidanceDraft({
  supabase,
  context,
  input = {},
}) {
  if (context?.capability !== "knowledge.draft.edit") {
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Draft editing is not authorized.",
    );
  }
  const productId = String(input.productId || input.product_id || "").trim();
  if (!/^\d+$/.test(productId)) {
    throw new KnowledgeAuthzError(
      422,
      "product_required",
      "Choose a product from the connected catalog.",
    );
  }
  const productResult = await supabase
    .from("shop_products")
    .select("id, external_id, title, handle")
    .eq("shop_ref_id", context.shopId)
    .eq("id", Number(productId))
    .maybeSingle();
  if (productResult.error)
    throw new KnowledgeAuthzError(500, "product_lookup_failed", productResult.error.message);
  if (!productResult.data)
    throw new KnowledgeAuthzError(404, "product_not_found", "That product is not available in this shop.");

  const customerContent = String(
    input.customerContent || input.customer_content || "",
  ).trim();
  // Product documents may contain several verified support sections. The
  // typed compiler promotes only deterministic procedure/fact shapes; the
  // complete document remains source evidence for the merchant editor.
  if (customerContent.length > 20000)
    throw new KnowledgeAuthzError(
      422,
      "content_too_long",
      "Keep product guidance under 20,000 characters.",
    );

  const policyId = String(input.policyId || input.policy_id || randomUUID());
  let existing = null;
  if (input.policyId) {
    const result = await supabase
      .from("kn2_policies")
      .select("id, domain_key, drafts, revision, template_version")
      .eq("id", policyId)
      .eq("shop_id", context.shopId)
      .maybeSingle();
    if (result.error)
      throw new KnowledgeAuthzError(500, "policy_lookup_failed", result.error.message);
    existing = result.data;
    if (!existing)
      throw new KnowledgeAuthzError(404, "policy_not_found", "The product guidance draft could not be found.");
    const existingProductId = String(
      existing.drafts?.product_guidance?.product_id || "",
    );
    if (
      existing.domain_key !== "product_support" ||
      (existingProductId && existingProductId !== productId)
    )
      throw new KnowledgeAuthzError(
        409,
        "product_binding_mismatch",
        "This draft is bound to a different product.",
      );
  }

  let sourceId = existing?.drafts?.product_guidance?.source_id || null;
  if (customerContent) {
    const source = await captureSource({
      supabase,
      context,
      sourceType: "merchant_input",
      sourceKey:
        String(input.sourceKey || `manual-product:${productId}:${policyId}`),
      text: customerContent,
      language: "en",
      meta: {
        title: productResult.data.title || "Product guidance",
        domain: "product_support",
        product_id: productId,
        product_external_id: productResult.data.external_id || null,
        parser: "product-guidance-draft-v1",
        ...(input.sourceMeta && typeof input.sourceMeta === "object"
          ? input.sourceMeta
          : {}),
      },
    });
    sourceId = source.id;
  }

  const parsed = parseProductSupportDocument(customerContent, {
    shopId: context.shopId,
    productId,
    productExternalId: productResult.data.external_id || null,
  });
  let pinned = null;
  let activeRelease = null;
  try {
    ({ pinned, release: activeRelease } = await activePinnedRelease({ supabase, context }));
  } catch {
    // A source draft may be captured before a shop has an active release. It
    // remains non-routable until the platform is available.
  }
  const activeMembersForDraft = activeRelease
    ? await openMembers({ supabase, context, seq: activeRelease.seq })
    : [];
  const activeKindByUnitId = new Map(
    activeMembersForDraft.map((member) => [String(member.unit_id).toLowerCase(), member.kind]),
  );
  const previousDraft = existing?.drafts?.product_guidance || {};
  const previousUnitIds = previousDraft.unit_ids || {};
  const unitDrafts = [];
  for (const item of parsed.units || []) {
    const sectionKey = `${item.section.normalizedHeading || "section"}:${item.section.normalizedContent || unitDrafts.length + 1}`;
    let unitId = previousUnitIds[sectionKey] || randomUUID();
    let unit = item.kind === "procedure"
      ? compileProductSupportProcedure({
          parsed: item.parsed,
          shopId: context.shopId,
          productId,
          productExternalId: productResult.data.external_id || null,
          sourceId,
          policyId,
          unitId,
        })
      : compileProductSupportKnowledgeSection({
          section: item.section,
          kind: item.kind,
          shopId: context.shopId,
          productId,
          productExternalId: productResult.data.external_id || null,
          sourceId,
          policyId,
          unitId,
        });
    // An immutable release cannot change a unit's kind in place. If an edited
    // section moves from evidence/fact to procedure (or back), mint a new
    // unit id and let publish close the old version through the normal
    // replace-unit path.
    if (unit && activeKindByUnitId.get(String(unitId).toLowerCase())
      && activeKindByUnitId.get(String(unitId).toLowerCase()) !== unit.kind) {
      unitId = randomUUID();
      unit = item.kind === "procedure"
        ? compileProductSupportProcedure({
            parsed: item.parsed,
            shopId: context.shopId,
            productId,
            productExternalId: productResult.data.external_id || null,
            sourceId,
            policyId,
            unitId,
          })
        : compileProductSupportKnowledgeSection({
            section: item.section,
            kind: item.kind,
            shopId: context.shopId,
            productId,
            productExternalId: productResult.data.external_id || null,
            sourceId,
            policyId,
            unitId,
          });
    }
    if (unit) unitDrafts.push({ sectionKey, section: item.section, unit });
  }
  const validationErrors = unitDrafts.flatMap(({ unit }) =>
    pinned?.platform?.domains?.product_support ? validateUnit(pinned.platform, unit) : [],
  );
  const unsupported = [...(parsed.unsupported || [])];
  const ambiguities = [...(parsed.ambiguities || [])];
  const typedReady = Boolean(unitDrafts.length && !validationErrors.length);
  const runtimeState = !unitDrafts.length
    ? "draft_needs_runtime_usable_section"
    : !pinned?.platform?.domains?.product_support
      ? "product_support_platform_not_active"
      : validationErrors.length
        ? "typed_validation_failed"
        : "ready_to_publish";
  const units = typedReady
    ? Object.fromEntries(unitDrafts.map(({ unit }) => [unit.unit_id, unit]))
    : {};
  let replaceUnitIds = [];
  if (pinned?.platform?.domains?.product_support) {
    const currentUnitIds = new Set(unitDrafts.map(({ unit }) => String(unit.unit_id).toLowerCase()));
    replaceUnitIds = activeMembersForDraft
      .filter(
        (member) =>
          ["procedure", "guidance"].includes(member.kind) &&
          member.domain_key === "product_support" &&
          String(member.payload?.product_binding?.product_id || "") === productId &&
          !currentUnitIds.has(String(member.unit_id).toLowerCase()),
      )
      .map((member) => member.unit_id);
  }

  const firstUnit = unitDrafts[0]?.unit || null;
  const draft = {
    product_id: productId,
    product_external_id: productResult.data.external_id || null,
    product_title: productResult.data.title || null,
    customer_content: customerContent,
    source_id: sourceId,
    unit_id: firstUnit?.unit_id || previousDraft.unit_id || randomUUID(),
    unit_ids: Object.fromEntries(unitDrafts.map(({ sectionKey, unit }) => [sectionKey, unit.unit_id])),
    units,
    replace_unit_ids: replaceUnitIds,
    issue_family: firstUnit?.payload?.issue_family || null,
    // Keep the public draft alias while clients migrate to issueFamily.
    problem_key: firstUnit?.payload?.issue_family || firstUnit?.payload?.problem_key || null,
    model_key: firstUnit?.payload?.applies_to_models?.[0] || null,
    proposals: Object.values(units),
    section_classifications: parsed.sections.map((section) => ({
      heading: section.heading,
      kind: section.kind ?? section.classification,
      classification: section.classification,
      typed: Boolean(section.typed),
      duplicate: Boolean(section.duplicate),
    })),
    unsupported,
    ambiguities,
    validation: {
      ok: typedReady,
      errors: [
        ...unsupported.map((finding) => ({
          code: finding.code,
          message: finding.message,
          sentence: finding.sentence,
        })),
        ...ambiguities.map((finding) => ({
          code: finding.code,
          message: finding.message,
          sentence: finding.sentence,
        })),
        ...validationErrors,
      ],
    },
    review_state: typedReady ? "ready_for_review" : "draft",
    runtime_state: runtimeState,
    updated_by: context.clerkUserId,
    updated_at: new Date().toISOString(),
  };
  const row = bindTenant(context, {
    id: policyId,
    domain_key: "product_support",
    title: `Product guidance — ${productResult.data.title || productId}`,
    template_version: pinned?.version || existing?.template_version || null,
    drafts: { ...(existing?.drafts || {}), product_guidance: draft },
    updated_by: context.clerkUserId,
  });
  const update = existing
    ? await supabase
        .from("kn2_policies")
        .update({
          domain_key: row.domain_key,
          title: row.title,
          drafts: row.drafts,
          updated_by: row.updated_by,
          revision: (existing.revision ?? 0) + 1,
        })
        .eq("id", policyId)
        .eq("shop_id", context.shopId)
        .select("id")
        .single()
    : await supabase.from("kn2_policies").insert(row).select("id").single();
  if (update.error)
    throw new KnowledgeAuthzError(409, "draft_rejected", update.error.message);

  return {
    policyId,
    draft: {
      ...draft,
      productId,
      productExternalId: draft.product_external_id,
      customerContent,
      sourceId,
      typedReady,
      problemKey: draft.problem_key,
      issueFamily: draft.issue_family ?? draft.problem_key ?? null,
      modelKey: draft.model_key,
      validation: draft.validation,
      runtimeState: draft.runtime_state,
    },
    pinned: pinned
      ? { version: pinned.version, hash: pinned.hash }
      : null,
  };
}

function publicProductGuidanceDraft(draft, policyId) {
  return {
    policyId,
    productId: draft.product_id,
    productExternalId: draft.product_external_id ?? null,
    productTitle: draft.product_title ?? null,
    customerContent: draft.customer_content ?? "",
    sourceId: draft.source_id ?? null,
    unitId: draft.unit_id ?? null,
    problemKey: draft.problem_key ?? draft.issue_family ?? null,
    issueFamily: draft.issue_family ?? draft.problem_key ?? null,
    modelKey: draft.model_key ?? null,
    sectionClassifications: draft.section_classifications ?? [],
    runtimeSectionCount: Object.keys(draft.units || {}).length,
    evidenceSectionCount: (draft.section_classifications ?? []).filter((section) => !section.typed).length,
    typedReady: Boolean(draft.validation?.ok && Object.keys(draft.units || {}).length),
    reviewState: draft.review_state ?? "draft",
    runtimeState: draft.runtime_state ?? null,
    validation: draft.validation ?? { ok: false, errors: [] },
    updatedAt: draft.updated_at ?? null,
  };
}

export async function approveProductGuidanceDraft({
  supabase,
  context,
  policyId,
}) {
  if (context?.capability !== "knowledge.review.answer")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge review is not authorized.",
    );
  const result = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision, template_version")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (result.error)
    throw new KnowledgeAuthzError(404, "policy_not_found", result.error.message);
  const draft = result.data.drafts?.product_guidance;
  if (!draft)
    throw new KnowledgeAuthzError(
      422,
      "product_guidance_required",
      "This policy is not a Product Knowledge draft.",
    );
  const clearingProductGuidance =
    !String(draft.customer_content || "").trim() &&
    (draft.replace_unit_ids || []).length > 0;
  if (
    (!draft.validation?.ok || !Object.keys(draft.units || {}).length) &&
    !clearingProductGuidance
  )
    throw new KnowledgeAuthzError(
      422,
      "draft_invalid",
      "Add a runtime-usable Product Knowledge section before publishing.",
    );
  const { pinned } = await activePinnedRelease({ supabase, context });
  if (!pinned.platform?.domains?.product_support)
    throw new KnowledgeAuthzError(
      422,
      "product_support_platform_not_active",
      "Product Support is not available in the active Knowledge release yet.",
    );
  const units = Object.fromEntries(
    Object.entries(draft.units).map(([unitId, unit]) => [
      unitId,
      {
        ...unit,
        review_state: "approved",
        reviewed_by: context.clerkUserId,
        reviewed_at: new Date().toISOString(),
      },
    ]),
  );
  const errors = Object.values(units).flatMap((unit) =>
    validateUnit(pinned.platform, unit),
  );
  if (errors.length)
    throw new KnowledgeAuthzError(422, "draft_invalid", JSON.stringify(errors));
  const approved = {
    ...draft,
    units,
    proposals: Object.values(units),
    review_state: "approved",
    runtime_state: "ready_to_publish",
    validation: { ok: true, errors: [] },
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...(result.data.drafts || {}), product_guidance: approved },
      revision: (result.data.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(409, "approval_rejected", update.error.message);
  return {
    policyId,
    draft: publicProductGuidanceDraft(approved, policyId),
    pinned: { version: pinned.version, hash: pinned.hash },
  };
}

export async function publishProductGuidanceDraft({
  supabase,
  context,
  policyId,
}) {
  if (context?.capability !== "knowledge.publish")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge publishing is not authorized.",
    );
  const result = await supabase
    .from("kn2_policies")
    .select("id, drafts")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (result.error)
    throw new KnowledgeAuthzError(404, "policy_not_found", result.error.message);
  const draft = result.data.drafts?.product_guidance;
  if (!draft || draft.review_state !== "approved")
    throw new KnowledgeAuthzError(
      422,
      "approval_required",
      "Approve the valid Product Knowledge before publishing it.",
    );
  const { release: parent, pinned } = await activePinnedRelease({
    supabase,
    context,
  });
  if (!pinned.platform?.domains?.product_support)
    throw new KnowledgeAuthzError(
      422,
      "product_support_platform_not_active",
      "Product Support is not available in the active Knowledge release yet.",
    );
  const members = await openMembers({ supabase, context, seq: parent.seq });
  const units = Object.values(draft.units || {})
    .filter((unit) => unit.review_state === "approved")
    .map(({ review_state: _reviewState, reviewed_by: _reviewedBy, reviewed_at: _reviewedAt, ...unit }) => unit);
  const errors = units.flatMap((unit) => validateUnit(pinned.platform, unit));
  if (errors.length)
    throw new KnowledgeAuthzError(422, "draft_invalid", JSON.stringify(errors));
  const close = (draft.replace_unit_ids || []).filter((unitId) =>
    members.some((member) => String(member.unit_id).toLowerCase() === String(unitId).toLowerCase()),
  );
  const changed = [];
  for (const unit of units) {
    const previous = members.find(
      (member) =>
        String(member.unit_id).toLowerCase() === String(unit.unit_id).toLowerCase(),
    );
    if (!previous || previous.content_hash !== (await unitContentHash(unit)))
      changed.push(unit);
  }
  if (!changed.length && !close.length)
    return {
      policyId,
      seq: parent.seq,
      added: 0,
      closed: 0,
      reused: true,
      activated: Boolean(parent.activated_at),
      draft,
    };
  const prepared = await prepareSeal({
    platform: pinned,
    parent: {
      seq: parent.seq,
      platform_version: parent.platform_version,
      platform_hash: parent.platform_hash,
    },
    members,
    add: changed,
    close,
    kind: "publish",
  });
  if (!prepared.ok)
    throw new KnowledgeAuthzError(422, "seal_invalid", JSON.stringify(prepared.errors));
  const seq = await sealRelease({ supabase, context, prepared });
  return {
    policyId,
    seq,
    added: changed.length,
    closed: close.length,
    reused: false,
    prepared,
    draft,
  };
}

export async function markProductGuidancePublished({
  supabase,
  context,
  policyId,
  seq,
}) {
  const result = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (result.error)
    throw new KnowledgeAuthzError(404, "policy_not_found", result.error.message);
  const draft = result.data.drafts?.product_guidance;
  if (!draft)
    throw new KnowledgeAuthzError(
      422,
      "product_guidance_required",
      "This policy is not a Product Knowledge draft.",
    );
  const publishedAt = new Date().toISOString();
  const published = {
    ...draft,
    review_state: "published",
    published_seq: seq,
    published_at: publishedAt,
    units: Object.fromEntries(
      Object.entries(draft.units || {}).map(([unitId, unit]) => [
        unitId,
        { ...unit, review_state: "published", published_seq: seq, published_at: publishedAt },
      ]),
    ),
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...(result.data.drafts || {}), product_guidance: published },
      revision: (result.data.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(409, "publish_state_rejected", update.error.message);
  return { policyId, seq, draft: publicProductGuidanceDraft(published, policyId) };
}

export async function approveReturnsGuidanceDraft({
  supabase,
  context,
  policyId,
}) {
  if (context?.capability !== "knowledge.review.answer")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge review is not authorized.",
    );
  const result = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (result.error)
    throw new KnowledgeAuthzError(
      404,
      "policy_not_found",
      result.error.message,
    );
  const manual = result.data.drafts?.returns_guidance;
  if (!manual)
    throw new KnowledgeAuthzError(
      422,
      "returns_guidance_required",
      "This policy is not a Returns guidance draft.",
    );
  const targets = await resolveReturnsGuidanceTargets({ supabase, context });
  const acceptedUnits = Object.fromEntries(
    Object.entries(manual.units || {}).map(([unitId, unit]) => [
      unitId,
      {
        ...unit,
        review_state: "approved",
        reviewed_by: context.clerkUserId,
        reviewed_at: new Date().toISOString(),
      },
    ]),
  );
  if (!Object.keys(acceptedUnits).length)
    throw new KnowledgeAuthzError(
      422,
      "nothing_valid",
      "There are no safely supported Returns statements ready to publish.",
    );
  const approvedManual = {
    ...manual,
    units: acceptedUnits,
    review_state: "approved",
    validation: { ...manual.validation, ok: true },
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: {
        ...(result.data.drafts || {}),
        returns_guidance: approvedManual,
      },
      revision: (result.data.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "approval_rejected",
      update.error.message,
    );
  return {
    policyId,
    draft: publicReturnsGuidanceDraft(
      approvedManual,
      approvedManual.validation,
      policyId,
    ),
    pinned: { version: targets.pinned.version, hash: targets.pinned.hash },
  };
}

export async function publishReturnsGuidanceDraft({
  supabase,
  context,
  policyId,
}) {
  if (context?.capability !== "knowledge.publish")
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge publishing is not authorized.",
    );
  const result = await supabase
    .from("kn2_policies")
    .select("id, drafts")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (result.error)
    throw new KnowledgeAuthzError(
      404,
      "policy_not_found",
      result.error.message,
    );
  const manual = result.data.drafts?.returns_guidance;
  if (!manual || manual.review_state !== "approved")
    throw new KnowledgeAuthzError(
      422,
      "approval_required",
      "Approve the valid Returns guidance before publishing it.",
    );
  const { release: parent, pinned } = await activePinnedRelease({
    supabase,
    context,
  });
  const members = await openMembers({ supabase, context, seq: parent.seq });
  const units = Object.values(manual.units || {}).filter(
    (unit) => unit.review_state === "approved",
  );
  const errors = validateReturnsGuidanceUnits({
    units,
    platform: pinned.platform,
  });
  if (errors.length)
    throw new KnowledgeAuthzError(422, "draft_invalid", JSON.stringify(errors));
  const acceptedIds = new Set(
    units.map((unit) => String(unit.unit_id).toLowerCase()),
  );
  const close = (manual.replace_unit_ids || []).filter(
    (unitId) => !acceptedIds.has(String(unitId).toLowerCase()),
  );
  const changed = [];
  for (const unit of units) {
    const previous = members.find(
      (member) =>
        String(member.unit_id).toLowerCase() ===
        String(unit.unit_id).toLowerCase(),
    );
    if (!previous || previous.content_hash !== (await unitContentHash(unit)))
      changed.push(unit);
  }
  if (!changed.length && !close.length)
    return {
      policyId,
      seq: parent.seq,
      added: 0,
      closed: 0,
      reused: true,
      activated: Boolean(parent.activated_at),
      draft: manual,
    };
  const prepared = await prepareSeal({
    platform: pinned,
    parent: {
      seq: parent.seq,
      platform_version: parent.platform_version,
      platform_hash: parent.platform_hash,
    },
    members,
    add: changed,
    close,
    kind: "publish",
  });
  if (!prepared.ok)
    throw new KnowledgeAuthzError(
      422,
      "seal_invalid",
      JSON.stringify(prepared.errors),
    );
  const seq = await sealRelease({ supabase, context, prepared });
  return {
    policyId,
    seq,
    added: changed.length,
    closed: close.length,
    reused: false,
    prepared,
    draft: manual,
  };
}

export async function markReturnsGuidancePublished({
  supabase,
  context,
  policyId,
  seq,
}) {
  const result = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (result.error)
    throw new KnowledgeAuthzError(
      404,
      "policy_not_found",
      result.error.message,
    );
  const manual = result.data.drafts?.returns_guidance;
  if (!manual)
    throw new KnowledgeAuthzError(
      422,
      "returns_guidance_required",
      "This policy is not a Returns guidance draft.",
    );
  const published = {
    ...manual,
    review_state: "published",
    published_seq: seq,
    published_at: new Date().toISOString(),
    units: Object.fromEntries(
      Object.entries(manual.units || {}).map(([unitId, unit]) => [
        unitId,
        {
          ...unit,
          review_state: "published",
          published_seq: seq,
          published_at: new Date().toISOString(),
        },
      ]),
    ),
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { ...(result.data.drafts || {}), returns_guidance: published },
      revision: (result.data.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "publish_state_rejected",
      update.error.message,
    );
  return {
    policyId,
    seq,
    draft: publicReturnsGuidanceDraft(
      published,
      { ok: true, errors: [] },
      policyId,
    ),
  };
}

// Saves only mutable merchant authoring state. The source snapshot is
// immutable; every content change captures a new source row.
export async function saveManualDraft({ supabase, context, input }) {
  if (context?.capability !== "knowledge.draft.edit") {
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Draft editing is not authorized.",
    );
  }
  const draft = normalizeManualDraft(input);
  const policyId = draft.policyId ?? randomUUID();
  let existing = null;
  if (draft.policyId) {
    const result = await supabase
      .from("kn2_policies")
      .select("id, drafts, status, revision")
      .eq("id", draft.policyId)
      .eq("shop_id", context.shopId)
      .maybeSingle();
    if (result.error)
      throw new KnowledgeAuthzError(
        500,
        "policy_lookup_failed",
        result.error.message,
      );
    existing = result.data;
    if (!existing)
      throw new KnowledgeAuthzError(
        404,
        "policy_not_found",
        "The draft could not be found.",
      );
    if (existing.drafts?.manual?.review_state === "published") {
      throw new KnowledgeAuthzError(
        409,
        "published_immutable",
        "Published Knowledge is immutable. Save a new draft change instead.",
      );
    }
  }

  const replacement = await resolveReplacementUnit({
    supabase,
    context,
    sourceUnitId: draft.sourceUnitId,
  });
  const unitId =
    existing?.drafts?.manual?.unit_id ?? replacement?.unit_id ?? randomUUID();
  let source = null;
  if (draft.customerContent) {
    source = await captureSource({
      supabase,
      context,
      sourceType: "merchant_input",
      sourceKey: `manual:${policyId}`,
      text: draft.customerContent,
      language: "en",
      meta: {
        title: draft.title,
        domain: draft.domain,
        knowledge_type: draft.knowledgeType,
      },
    });
  }
  const sourceId = source?.id ?? existing?.drafts?.manual?.source_id ?? null;
  const { pinned } = await activePinnedRelease({ supabase, context });
  const validationResult = validateManualDraft({
    draft,
    platform: pinned.platform,
    sourceId,
    policyId,
    unitId,
  });
  if (sourceId && !(await sourceExists({ supabase, context, sourceId }))) {
    validationResult.ok = false;
    validationResult.errors.push({
      code: "provenance_missing",
      message: "The manual source could not be resolved.",
      field: "sourceId",
    });
  }
  const reviewState = validationResult.ok ? "ready_for_review" : "draft";
  const manual = {
    ...validationResult.draft,
    source_id: sourceId,
    unit_id: unitId,
    source_unit_id: replacement?.id ?? null,
    review_state: reviewState,
    validation: validationResult,
    updated_by: context.clerkUserId,
    updated_at: new Date().toISOString(),
  };
  const row = bindTenant(context, {
    id: policyId,
    domain_key: validationResult.draft.domain || "returns",
    title: validationResult.draft.title || "Untitled manual Knowledge",
    template_version: pinned.version,
    drafts: { manual },
    updated_by: context.clerkUserId,
  });
  const update = existing
    ? await supabase
        .from("kn2_policies")
        .update({
          domain_key: row.domain_key,
          title: row.title,
          template_version: row.template_version,
          drafts: row.drafts,
          updated_by: row.updated_by,
          revision: (existing.revision ?? 0) + 1,
        })
        .eq("id", policyId)
        .eq("shop_id", context.shopId)
        .select("id")
        .single()
    : await supabase.from("kn2_policies").insert(row).select("id").single();
  if (update.error)
    throw new KnowledgeAuthzError(409, "draft_rejected", update.error.message);

  let reviewItemId = null;
  if (validationResult.ok)
    reviewItemId = await ensureManualReviewItem({
      supabase,
      context,
      policyId,
      draft: validationResult.draft,
      sourceId,
    });
  return {
    policyId,
    draft: publicManualDraft(
      manual,
      { ok: validationResult.ok, errors: validationResult.errors },
      policyId,
      reviewItemId,
    ),
    pinned: { version: pinned.version, hash: pinned.hash },
  };
}

export async function approveManualDraft({ supabase, context, policyId }) {
  if (context?.capability !== "knowledge.review.answer") {
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge review is not authorized.",
    );
  }
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const manual = policy.drafts?.manual;
  if (!manual)
    throw new KnowledgeAuthzError(
      422,
      "manual_draft_required",
      "This policy is not a manual Knowledge draft.",
    );
  const { pinned } = await activePinnedRelease({ supabase, context });
  const validationResult = validateManualDraft({
    draft: manual,
    platform: pinned.platform,
    sourceId: manual.source_id,
    policyId: policy.id,
    unitId: manual.unit_id,
  });
  if (
    !validationResult.ok ||
    !(await sourceExists({ supabase, context, sourceId: manual.source_id }))
  ) {
    throw new KnowledgeAuthzError(
      422,
      "draft_invalid",
      JSON.stringify(validationResult.errors),
    );
  }
  const approvedManual = {
    ...manual,
    review_state: "approved",
    reviewed_by: context.clerkUserId,
    reviewed_at: new Date().toISOString(),
    validation: validationResult,
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { manual: approvedManual },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policy.id)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "approval_rejected",
      update.error.message,
    );
  const review = await findOpenReviewItem({
    supabase,
    context,
    policyId: policy.id,
  });
  if (review) {
    const reviewUpdate = await supabase
      .from("kn2_review_items")
      .update({
        status: "resolved",
        resolution: { decision: "approved", unit_id: manual.unit_id },
        resolved_by: context.clerkUserId,
        resolved_role: context.role,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", review.id)
      .eq("shop_id", context.shopId)
      .eq("status", "open");
    if (reviewUpdate.error)
      throw new KnowledgeAuthzError(
        409,
        "review_item_update_rejected",
        reviewUpdate.error.message,
      );
  }
  return {
    policyId: policy.id,
    draft: publicManualDraft(
      approvedManual,
      { ok: true, errors: [] },
      policy.id,
      review?.id ?? null,
    ),
  };
}

export async function publishManualDraft({ supabase, context, policyId }) {
  if (context?.capability !== "knowledge.publish") {
    throw new KnowledgeAuthzError(
      403,
      "forbidden",
      "Knowledge publishing is not authorized.",
    );
  }
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const manual = policy.drafts?.manual;
  if (!manual || manual.review_state !== "approved")
    throw new KnowledgeAuthzError(
      422,
      "approval_required",
      "Approve the valid draft before publishing it.",
    );
  const { release: parent, pinned } = await activePinnedRelease({
    supabase,
    context,
  });
  const validationResult = validateManualDraft({
    draft: manual,
    platform: pinned.platform,
    sourceId: manual.source_id,
    policyId: policy.id,
    unitId: manual.unit_id,
  });
  if (!validationResult.ok)
    throw new KnowledgeAuthzError(
      422,
      "draft_invalid",
      JSON.stringify(validationResult.errors),
    );
  const members = await openMembers({ supabase, context, seq: parent.seq });
  const unit = compileManualUnit({
    draft: validationResult.draft,
    sourceId: manual.source_id,
    policyId: policy.id,
    unitId: manual.unit_id,
  });
  const previous = members.find(
    (member) =>
      String(member.unit_id).toLowerCase() ===
      String(unit.unit_id).toLowerCase(),
  );
  const changed =
    !previous || previous.content_hash !== (await unitContentHash(unit));
  if (!changed)
    return {
      policyId: policy.id,
      seq: parent.seq,
      added: 0,
      reused: true,
      activated: Boolean(parent.activated_at),
      draft: manual,
    };
  const prepared = await prepareSeal({
    platform: pinned,
    parent: {
      seq: parent.seq,
      platform_version: parent.platform_version,
      platform_hash: parent.platform_hash,
    },
    members,
    add: [unit],
    close: [],
    kind: "publish",
  });
  if (!prepared.ok)
    throw new KnowledgeAuthzError(
      422,
      "seal_invalid",
      JSON.stringify(prepared.errors),
    );
  const seq = await sealRelease({ supabase, context, prepared });
  return {
    policyId: policy.id,
    seq,
    added: 1,
    reused: false,
    prepared,
    draft: manual,
  };
}

export async function markManualPublished({
  supabase,
  context,
  policyId,
  seq,
}) {
  const { data: policy, error } = await supabase
    .from("kn2_policies")
    .select("id, drafts, revision")
    .eq("id", policyId)
    .eq("shop_id", context.shopId)
    .single();
  if (error)
    throw new KnowledgeAuthzError(404, "policy_not_found", error.message);
  const manual = policy.drafts?.manual;
  if (!manual)
    throw new KnowledgeAuthzError(
      422,
      "manual_draft_required",
      "This policy is not a manual Knowledge draft.",
    );
  const published = {
    ...manual,
    review_state: "published",
    published_seq: seq,
    published_at: new Date().toISOString(),
  };
  const update = await supabase
    .from("kn2_policies")
    .update({
      drafts: { manual: published },
      revision: (policy.revision ?? 0) + 1,
      updated_by: context.clerkUserId,
    })
    .eq("id", policy.id)
    .eq("shop_id", context.shopId)
    .select("id")
    .single();
  if (update.error)
    throw new KnowledgeAuthzError(
      409,
      "publish_state_rejected",
      update.error.message,
    );
  return {
    policyId: policy.id,
    seq,
    draft: publicManualDraft(published, { ok: true, errors: [] }, policy.id),
  };
}
