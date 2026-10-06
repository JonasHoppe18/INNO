// Document authoring uses the same tenant authorization and sealed-release RPCs
// as the existing slot authoring path. No derived runtime rows are seeded.
import { randomUUID } from "node:crypto";
import { KnowledgeAuthzError, bindTenant } from "./authz.js";
import { captureSource, openMembers } from "./authoring.js";
import { sealRelease, activateRelease } from "./seal-release.js";
import { loadPlatformFromRepo } from "../../../../../shared/knowledge-v2/platform-node.mjs";
import {
  unitContentHash,
  prepareSeal,
} from "../../../../../shared/knowledge-v2/seal.mjs";
import { extractSupportDocument } from "../../../../../shared/knowledge-v2/merchant-support.mjs";
import { validateUnit } from "../../../../../shared/knowledge-v2/units.mjs";
import { extractReferences } from "../../../../../shared/knowledge-v2/references.mjs";
const VERSION = "sona-0.6.0";
function requireCapability(context, capability) {
  if (
    !context?.workspaceId ||
    !context?.shopId ||
    !context?.clerkUserId ||
    !["admin", "member"].includes(context?.role)
  )
    throw new KnowledgeAuthzError(
      403,
      "scope_required",
      "An authorized workspace, shop and merchant principal are required.",
    );
  if (context?.capability !== capability)
    throw new KnowledgeAuthzError(403, "forbidden", `Requires ${capability}.`);
}
function fail(error) {
  if (error)
    throw new KnowledgeAuthzError(409, "document_write_failed", error.message);
}
async function scopedPolicy(supabase, context, id) {
  const r = await supabase
    .from("kn2_policies")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", context.workspaceId)
    .eq("shop_id", context.shopId)
    .single();
  fail(r.error);
  if (r.data.drafts?.merchant_document?.contract !== "merchant_support/v1")
    throw new KnowledgeAuthzError(
      422,
      "document_required",
      "Choose a merchant document draft.",
    );
  return r.data;
}
export async function ingestMerchantDocument({
  supabase,
  context,
  input,
  catalog,
}) {
  requireCapability(context, "knowledge.draft.edit");
  if (
    !input ||
    typeof input.title !== "string" ||
    typeof input.content !== "string"
  )
    throw new KnowledgeAuthzError(
      422,
      "document_invalid",
      "Document title and content must be strings.",
    );
  const title = String(input.title ?? "").trim(),
    content = String(input.content ?? "");
  if (!title || title.length > 180 || !content.trim() || content.length > 50000)
    throw new KnowledgeAuthzError(
      422,
      "document_invalid",
      "A document needs a bounded title and source content.",
    );
  if (
    !Array.isArray(catalog) ||
    catalog.some((p) => p.shopId !== context.shopId)
  )
    throw new KnowledgeAuthzError(
      422,
      "catalog_scope",
      "Catalog identities must be verified for this shop.",
    );
  const key = String(input.documentKey ?? randomUUID());
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key))
    throw new KnowledgeAuthzError(
      422,
      "document_key",
      "Use a stable document key.",
    );
  const previous = await supabase
    .from("kn2_policies")
    .select("id,drafts,status")
    .eq("workspace_id", context.workspaceId)
    .eq("shop_id", context.shopId)
    .eq("drafts->merchant_document->>document_key", key)
    .maybeSingle();
  fail(previous.error);
  if (previous.data) {
    const d = previous.data.drafts.merchant_document;
    if (
      d.content !== content ||
      d.title !== title ||
      JSON.stringify(d.product_ids ?? []) !==
        JSON.stringify(input.productIds ?? []) ||
      (d.requested_domain ?? null) !== (input.domain ?? null) ||
      (d.requested_type ?? null) !== (input.semanticType ?? null)
    )
      throw new KnowledgeAuthzError(
        409,
        "document_changed",
        "Create a new document revision; reviewed source is immutable.",
      );
    return { policyId: previous.data.id, draft: d, reused: true };
  }
  const policyId = randomUUID();
  // Validate the whole proposed source before creating authoring rows.
  const preliminary = extractSupportDocument({
    content,
    title,
    productIds: input.productIds ?? [],
    catalog,
    sourceId: "00000000-0000-4000-8000-000000000000",
    policyId,
    defaultDomain: input.domain ?? null,
    defaultType: input.semanticType ?? null,
  });
  if (!preliminary.units.length)
    throw new KnowledgeAuthzError(
      422,
      "document_no_units",
      JSON.stringify(preliminary.unresolved),
    );
  const pinned = await loadPlatformFromRepo(VERSION);
  const preliminaryErrors = preliminary.units.flatMap((u) => [
    ...validateUnit(pinned.platform, u),
    ...extractReferences(pinned.platform, u.kind, u.payload).errors,
  ]);
  if (preliminaryErrors.length)
    throw new KnowledgeAuthzError(
      422,
      "document_invalid",
      JSON.stringify(preliminaryErrors),
    );
  const source = await captureSource({
    supabase,
    context,
    sourceType: "merchant_upload",
    sourceKey: `document:${key}`,
    text: content,
    meta: {
      title,
      document_key: key,
      catalog_bindings: catalog.map((p) => ({ id: p.id, title: p.title })),
    },
  });
  const parsed = extractSupportDocument({
    content,
    title,
    productIds: input.productIds ?? [],
    catalog,
    sourceId: source.id,
    policyId,
    defaultDomain: input.domain ?? null,
    defaultType: input.semanticType ?? null,
  });
  const errors = parsed.units.flatMap((u) => [
    ...validateUnit(pinned.platform, u),
    ...extractReferences(pinned.platform, u.kind, u.payload).errors,
  ]);
  if (errors.length)
    throw new KnowledgeAuthzError(
      422,
      "document_invalid",
      JSON.stringify(errors),
    );
  const draft = {
    contract: "merchant_support/v1",
    document_key: key,
    title,
    content,
    product_ids: input.productIds ?? [],
    requested_domain: input.domain ?? null,
    requested_type: input.semanticType ?? null,
    source_id: source.id,
    units: parsed.units,
    unresolved: parsed.unresolved,
    review_state: "ready_for_review",
    platform_version: VERSION,
  };
  const document = await supabase
    .from("knowledge_documents")
    .upsert(
      {
        shop_id: context.shopId,
        category: "merchant_support",
        document_type: `document:${key}`,
        title,
        draft_markdown: content,
        has_unpublished_changes: true,
      },
      { onConflict: "shop_id,category,document_type" },
    )
    .select("id")
    .single();
  fail(document.error);
  draft.document_id = document.data.id;
  const saved = await supabase.from("kn2_policies").insert(
    bindTenant(context, {
      id: policyId,
      domain_key: "general",
      title,
      template_version: VERSION,
      drafts: { merchant_document: draft },
      updated_by: context.clerkUserId,
    }),
  );
  fail(saved.error);
  const review = await supabase.from("kn2_review_items").insert(
    bindTenant(context, {
      policy_id: policyId,
      item_type: "change_proposal",
      status: "open",
      requires_role: "merchant",
      dedupe_key: `document:${policyId}`,
      unit_ids: parsed.units.map((u) => u.unit_id),
      vocabulary_request:
        "Review the source-backed merchant document units and unresolved sections.",
      payload: {
        source_id: source.id,
        unit_count: parsed.units.length,
        unresolved: parsed.unresolved,
      },
    }),
  );
  fail(review.error);
  return { policyId, draft, reused: false };
}
export async function approveMerchantDocument({
  supabase,
  context,
  policyId,
  resolutions = [],
}) {
  requireCapability(context, "knowledge.review.answer");
  const policy = await scopedPolicy(supabase, context, policyId);
  const draft = policy.drafts.merchant_document;
  if (draft.review_state === "published" || draft.review_state === "approved")
    return { policyId, draft, reused: true };
  if (
    draft.unresolved.length !== resolutions.length ||
    draft.unresolved.some(
      (u, i) =>
        resolutions[i]?.code !== u.code ||
        resolutions[i]?.decision !== "evidence_only" ||
        !String(resolutions[i]?.reason ?? "").trim(),
    )
  )
    throw new KnowledgeAuthzError(
      422,
      "unresolved_document",
      "Resolve every ambiguous section explicitly before approval.",
    );
  const source = await supabase
    .from("kn2_sources")
    .select("id,text_content,content_hash")
    .eq("id", draft.source_id)
    .eq("workspace_id", context.workspaceId)
    .eq("shop_id", context.shopId)
    .single();
  fail(source.error);
  const pinned = await loadPlatformFromRepo(draft.platform_version);
  const errors = draft.units.flatMap((u) => [
    ...validateUnit(pinned.platform, u),
    ...extractReferences(pinned.platform, u.kind, u.payload).errors,
  ]);
  if (
    source.data.text_content !== draft.content ||
    draft.units.some(
      (u) =>
        u.payload.provenance[0].source_id !== source.data.id ||
        u.payload.source_hash !== source.data.content_hash ||
        source.data.text_content.slice(
          u.payload.source_location.start,
          u.payload.source_location.end,
        ) !== u.payload.text,
    )
  )
    errors.push({ code: "source_substitution" });
  if (errors.length)
    throw new KnowledgeAuthzError(
      422,
      "document_invalid",
      JSON.stringify(errors),
    );
  const approved = {
    ...draft,
    review_state: "approved",
    review_hashes: await Promise.all(draft.units.map(unitContentHash)),
    resolutions,
    reviewed_by: context.clerkUserId,
    reviewed_at: new Date().toISOString(),
  };
  fail(
    (
      await supabase
        .from("kn2_policies")
        .update({
          drafts: { ...policy.drafts, merchant_document: approved },
          revision: policy.revision + 1,
          updated_by: context.clerkUserId,
        })
        .eq("id", policyId)
        .eq("workspace_id", context.workspaceId)
        .eq("shop_id", context.shopId)
    ).error,
  );
  fail(
    (
      await supabase
        .from("kn2_review_items")
        .update({
          status: "resolved",
          resolution: { decision: "approved", resolutions },
          resolved_by: context.clerkUserId,
          resolved_role: context.role,
          resolved_at: new Date().toISOString(),
        })
        .eq("policy_id", policyId)
        .eq("workspace_id", context.workspaceId)
        .eq("shop_id", context.shopId)
        .eq("status", "open")
    ).error,
  );
  return { policyId, draft: approved };
}
export async function publishMerchantDocuments({
  supabase,
  context,
  policyIds,
}) {
  requireCapability(context, "knowledge.publish");
  if (
    !Array.isArray(policyIds) ||
    !policyIds.length ||
    new Set(policyIds).size !== policyIds.length
  )
    throw new KnowledgeAuthzError(
      422,
      "documents_required",
      "Choose distinct approved documents.",
    );
  const policies = [];
  for (const id of policyIds)
    policies.push(await scopedPolicy(supabase, context, id));
  if (
    policies.some(
      (p) =>
        !["approved", "published"].includes(
          p.drafts.merchant_document.review_state,
        ),
    )
  )
    throw new KnowledgeAuthzError(
      422,
      "approval_required",
      "Every document must be reviewed.",
    );
  const parentResult = await supabase
    .from("kn2_releases")
    .select("seq,platform_version,platform_hash,activated_at")
    .eq("workspace_id", context.workspaceId)
    .eq("shop_id", context.shopId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(parentResult.error);
  const parent = parentResult.data;
  const pinned = await loadPlatformFromRepo(VERSION);
  const members = parent
    ? await openMembers({ supabase, context, seq: parent.seq })
    : [];
  for (const policy of policies) {
    const d = policy.drafts.merchant_document;
    const hashes = await Promise.all(d.units.map(unitContentHash));
    if (JSON.stringify(hashes) !== JSON.stringify(d.review_hashes))
      throw new KnowledgeAuthzError(
        422,
        "review_changed",
        "Unit content changed after review.",
      );
  }
  const units = policies.flatMap((p) => p.drafts.merchant_document.units);
  const existing = new Set(members.map((u) => u.unit_id));
  const add = units.filter((u) => !existing.has(u.unit_id));
  if (!add.length && parent?.platform_hash === pinned.hash)
    return { seq: parent.seq, reused: true };
  const kind =
    parent && parent.platform_hash !== pinned.hash
      ? "platform_adoption"
      : "publish";
  const prepared = await prepareSeal({
    platform: pinned,
    parent,
    members,
    add,
    kind,
  });
  if (!prepared.ok)
    throw new KnowledgeAuthzError(
      422,
      "document_seal_invalid",
      JSON.stringify(prepared.errors),
    );
  prepared.rpc.approved_policy_ids = policyIds;
  const sealContext =
    kind === "platform_adoption"
      ? { ...context, capability: "knowledge.platform_migration.approve" }
      : context;
  const sealed = await sealRelease({
    supabase,
    context: sealContext,
    prepared,
  });
  return { seq: sealed, reused: false };
}
export async function activateMerchantDocuments({
  supabase,
  context,
  seq,
  policyIds,
}) {
  requireCapability(context, "knowledge.activate");
  // Verify membership before activation, including callers that reuse a release.
  const members = await openMembers({ supabase, context, seq });
  const policies = [];
  for (const id of policyIds)
    policies.push(await scopedPolicy(supabase, context, id));
  const memberIds = new Set(members.map((u) => u.unit_id));
  if (
    policies.some((p) =>
      p.drafts.merchant_document.units.some((u) => !memberIds.has(u.unit_id)),
    )
  )
    throw new KnowledgeAuthzError(
      422,
      "release_membership",
      "All document units must be sealed in this release.",
    );
  const release = await supabase
    .from("kn2_releases")
    .select("seq,activated_at")
    .eq("workspace_id", context.workspaceId)
    .eq("shop_id", context.shopId)
    .order("seq", { ascending: false })
    .limit(1)
    .single();
  fail(release.error);
  if (release.data.seq !== seq)
    throw new KnowledgeAuthzError(
      409,
      "stale_release",
      "Only the newest release may be activated.",
    );
  const reused = Boolean(release.data.activated_at);
  const activatedAt =
    release.data.activated_at ??
    (await activateRelease({ supabase, context, seq }));
  for (const p of policies) {
    const d = p.drafts.merchant_document;
    if (d.review_state === "published" && d.release_seq === seq) continue;
    fail(
      (
        await supabase
          .from("kn2_policies")
          .update({
            drafts: {
              ...p.drafts,
              merchant_document: {
                ...d,
                review_state: "published",
                release_seq: seq,
              },
            },
            updated_by: context.clerkUserId,
          })
          .eq("id", p.id)
          .eq("workspace_id", context.workspaceId)
          .eq("shop_id", context.shopId)
      ).error,
    );
    fail(
      (
        await supabase
          .from("knowledge_documents")
          .update({
            published_markdown: d.content,
            has_unpublished_changes: false,
            published_at: activatedAt,
          })
          .eq("id", d.document_id)
          .eq("shop_id", context.shopId)
      ).error,
    );
  }
  return { seq, activatedAt, reused };
}
