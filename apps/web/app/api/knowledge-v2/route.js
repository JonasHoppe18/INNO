import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import {
  isGreenfieldPlaygroundDevDiagnosticsEnabled,
  isGreenfieldPlaygroundDevTarget,
  isGreenfieldPlaygroundEnabled,
  isGreenfieldPlaygroundProduction,
} from "@/lib/server/greenfield-playground";
import {
  resolveAuthScope,
  resolveScopedShop,
} from "@/lib/server/workspace-auth";
import {
  resolveKnowledgeContext,
  KnowledgeAuthzError,
} from "@/lib/server/knowledge-v2/authz";
import { manualStatus } from "@/lib/server/knowledge-v2/manual-authoring";
import { friendlyReturnsProposal } from "@/lib/server/knowledge-v2/url-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOMAIN_LABELS = {
  returns: "Returns",
  product_support: "Product Support",
  warranty: "Warranty / Complaints",
  order_status: "Order Status",
  wismo: "Order Status",
};

const SOURCE_LABELS = {
  website_page: "Website",
  shopify_policy_live: "Shopify policy",
  merchant_upload: "File",
  merchant_input: "Manual",
  system_of_record_capture: "System capture",
};

const REVIEW_LABELS = {
  question: "Missing Knowledge",
  schema_gap: "Missing Knowledge",
  establishment_gap: "Missing Knowledge",
  runtime_gap: "Runtime gap",
  value_conflict: "Conflicting",
  evidence_changed: "Changed source",
  change_proposal: "Changed source",
};

function text(value, fallback = "") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function truncate(value, max = 240) {
  const normalized = text(value);
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1)}…`;
}

function domainLabel(value) {
  const key = text(value).toLowerCase();
  return (
    DOMAIN_LABELS[key] ||
    key
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) ||
    "Knowledge"
  );
}

function sourceLabel(row) {
  return SOURCE_LABELS[text(row?.source_type).toLowerCase()] || "Source";
}

function sourceOrigin(row) {
  const key = text(row?.source_key);
  const uri = text(row?.meta?.url || row?.meta?.source_uri);
  if (/^https?:\/\//i.test(uri)) return uri;
  if (/^https?:\/\//i.test(key)) return key;
  if (
    text(row?.source_type).toLowerCase() === "merchant_upload" &&
    text(row?.meta?.filename)
  )
    return text(row.meta.filename);
  if (key.startsWith("manual:")) return "Merchant entry";
  if (key.startsWith("shopify:")) return "Shopify policy source";
  if (/\breturns?\b/i.test(key)) return "Returns policy source";
  if (/\bkn2\b|fixture/i.test(key)) return "Merchant source";
  return key || "Merchant source";
}

function sourceIdFromPayload(payload) {
  const provenance = Array.isArray(payload?.provenance)
    ? payload.provenance
    : [];
  return text(
    provenance[0]?.source_id ||
      payload?.source_id ||
      payload?.evidence?.source_id,
  );
}

function humanValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.map(humanValue).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    for (const key of [
      "text",
      "description",
      "message",
      "instruction",
      "answer",
      "value",
      "label",
    ]) {
      if (value[key] !== undefined) {
        const result = humanValue(value[key]);
        if (result) return result;
      }
    }
  }
  return "";
}

function humanize(value) {
  return text(value)
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slotTitle(value, domain) {
  const parts = text(value)
    .split(/[._\-\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts[0]?.toLowerCase() === text(domain).toLowerCase()) parts.shift();
  if (!parts.length) return `${domainLabel(domain)} guidance`;
  const prefix = {
    elig: "Eligibility",
    proc: "Process",
    log: "Return shipping",
    money: "Refund timing",
  }[parts[0].toLowerCase()];
  if (!prefix) return `${domainLabel(domain)} guidance`;
  const suffix = parts.slice(1).join(" ");
  return suffix ? `${prefix} — ${humanize(suffix)}` : prefix;
}

function merchantTitle(value, fallback) {
  const candidate = text(value);
  return candidate && !/\bkn2\b|fixture/i.test(candidate)
    ? candidate
    : fallback;
}

function merchantCopy(value, fallback) {
  const candidate = text(value);
  if (!candidate) return fallback;
  return candidate
    .replace(/\bkn2\b/gi, "Knowledge")
    .replace(/\bfixture\b/gi, "source")
    .replace(/\bunit[_ -]?version\b/gi, "guidance version");
}

// A workspace can have immutable historical policy rows (for example, from a
// publish replay) alongside the current canonical merchant draft.  The
// workspace editor must hydrate from the newest active canonical draft, not
// whichever row happens to be returned first by PostgREST.  Runtime unit
// selection remains release-based; this only controls the merchant-facing
// document hydration payload.
function newestActivePolicy(policies = [], domainKey) {
  return policies
    .filter((policy) => policy?.status === "active" && policy?.domain_key === domainKey)
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left?.updated_at || left?.created_at || 0).getTime();
      const rightTime = new Date(right?.updated_at || right?.created_at || 0).getTime();
      return rightTime - leftTime;
    })[0] || null;
}

function canonicalGuidanceFromPolicies(policies = []) {
  const draftFor = (domainKey, draftKey) => {
    const policy = newestActivePolicy(policies, domainKey);
    const draft = policy?.drafts?.[draftKey];
    if (!draft || typeof draft !== "object") return null;
    const content = text(draft.customerContent || draft.customer_content);
    return content
      ? {
          title: text(draft.title || policy.title),
          content,
          policyId: policy.id,
          updatedAt: policy.updated_at || policy.created_at || null,
        }
      : null;
  };

  return {
    returns: draftFor("returns", "returns_guidance"),
    orderStatus: draftFor("order_status", "order_status_guidance"),
    warranty: draftFor("complaints_warranty", "warranty_guidance"),
  };
}

function unitTitle(row, policy) {
  const payload =
    row?.payload && typeof row.payload === "object" ? row.payload : {};
  if (payload.contract === "merchant_support/v1") return payload.title;
  if (row?.kind === "procedure") return "Return shipping instructions";
  if (row?.kind === "value" && payload.value_type === "postal_address")
    return "Return destination";
  if (row?.kind === "expectation") return "Refund timing";
  return merchantTitle(
    policy?.title,
    slotTitle(row?.slot_key, row?.domain_key),
  );
}

function customerSummary(row) {
  const payload =
    row?.payload && typeof row.payload === "object" ? row.payload : {};
  if (payload.contract === "merchant_support/v1") return truncate(payload.text, 220);
  if (row?.kind === "procedure") {
    const customerText = Array.isArray(payload.texts)
      ? payload.texts.find(
          (entry) =>
            entry?.audience === "customer" && typeof entry?.text === "string",
        )?.text
      : null;
    if (customerText) return truncate(customerText, 220);
  }
  if (row?.kind === "value" && payload.value_type === "postal_address") {
    return "Customers receive a return address when they start a return.";
  }
  if (row?.kind === "expectation") {
    const duration = payload.duration;
    if (duration?.amount) {
      const unit = duration.unit === "business_day" ? "business days" : "days";
      return `Refunds are issued after the return is received and processed, usually within ${duration.amount} ${unit}.`;
    }
    return "Refund timing follows return receipt and processing.";
  }
  const slot = text(row?.slot_key).toLowerCase();
  if (slot.includes("window")) {
    const duration = payload.value?.duration;
    const anchor =
      payload.value?.anchor?.fact === "order.placed_at"
        ? "the order date"
        : "delivery";
    if (duration?.amount) {
      const unit = duration.unit === "business_day" ? "business days" : "days";
      return `Customers can return eligible products within ${duration.amount} ${unit} of ${anchor}.`;
    }
    return "Customers can return eligible products within the stated return window.";
  }
  if (slot.includes("accepted"))
    return "Eligible products can be returned under the merchant’s return policy.";
  if (slot.includes("method"))
    return "Customers can start a return by contacting support.";
  if (slot.includes("payer")) return "Customers pay the return shipping cost.";
  if (slot.includes("destination"))
    return "Customers receive a return address when they start a return.";
  if (slot.includes("timing"))
    return "Refunds are issued after the return is received and processed.";
  if (slot.includes("condition"))
    return "Products should meet the return condition.";
  return "This guidance helps Sona answer customers consistently.";
}

function manualSummary(manual) {
  return merchantCopy(
    manual?.customerContent || manual?.customer_content,
    "This guidance is ready for review.",
  );
}

function applicability(row) {
  if (row?.payload?.contract === "merchant_support/v1") {
    return row.payload.applicability.kind === "merchant"
      ? ["All supported products"]
      : row.payload.product_bindings.map(product => product.title);
  }

  const scope = row?.scope && typeof row.scope === "object" ? row.scope : {};
  const values = [
    scope.product_name,
    scope.product,
    scope.model,
    scope.model_name,
    scope.applies_to,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => text(value))
    .filter(Boolean);
  return values.length ? values : ["All supported products"];
}

function reviewText(row) {
  const payload =
    row?.payload && typeof row.payload === "object" ? row.payload : {};
  const question = humanValue(
    payload.question || payload.prompt || payload.issue || payload.reason,
  );
  return merchantCopy(
    question || row?.vocabulary_request,
    "Sona needs a merchant decision before this guidance can be used safely.",
  );
}

function reviewResolutionKey(row) {
  if (row?.item_type === "change_proposal")
    return `proposal:${text(row.payload?.proposal_key)}`;
  if (row?.item_type === "schema_gap")
    return `gap:${text(row.dedupe_key).split(":").at(-1)}`;
  return `question:${text(row.dedupe_key).split(":").at(-1)}`;
}

function reviewCode(row) {
  return text(row?.dedupe_key).split(":").at(-1);
}

function friendlyReviewDetails(row, policy) {
  const code = reviewCode(row);
  const proposalKey = text(row.payload?.proposal_key);
  const draft = proposalKey
    ? Object.values(policy?.drafts?.units ?? {}).find(
        (candidate) => candidate?.key === proposalKey,
      )
    : null;
  const proposal = draft ? friendlyReturnsProposal(draft) : null;
  if (row.item_type === "change_proposal" && proposal) {
    return {
      issueTitle: proposal.title,
      why: "Sona found a source-backed interpretation, but a merchant must confirm it before it can be published.",
      proposedInterpretation: proposal.summary,
      decision:
        "Confirm this interpretation, edit the suggested guidance, or reject it.",
      evidence:
        truncate(draft.evidence?.[0] || row.payload?.evidence, 1200) || null,
      resolutionKey: `proposal:${proposalKey}`,
      resolutionType: "proposal",
      proposalKey,
    };
  }
  if (code === "window_conflict" || code === "window_anchor_unknown") {
    return {
      issueTitle: "Choose the return window Sona should use",
      why: "The captured source mentions more than one return period, so Sona will not choose between them automatically.",
      proposedInterpretation:
        "The source contains statutory and merchant return periods. The ordinary return flow needs one clear window.",
      decision:
        "Choose 14 or 30 calendar days and whether the period starts at delivery or order date.",
      evidence: truncate(row.payload?.evidence, 1200) || null,
      resolutionKey: `question:${code}`,
      resolutionType: "window",
      options: [
        { value: "30_delivery", label: "30 calendar days from delivery" },
        { value: "14_delivery", label: "14 calendar days from delivery" },
        { value: "14_order_date", label: "14 calendar days from order date" },
      ],
    };
  }
  if (code === "exchanges_unknown") {
    return {
      issueTitle: "Confirm whether exchanges are offered",
      why: "The captured source does not state clearly whether customers can exchange an item instead of returning it.",
      proposedInterpretation:
        "No exchange rule will be published until you choose yes or no.",
      decision: "Confirm whether exchanges are offered.",
      evidence:
        truncate(row.payload?.evidence, 1200) ||
        "No clear exchange statement was found in the captured source.",
      resolutionKey: `question:${code}`,
      resolutionType: "exchange",
      options: [
        { value: "yes", label: "Confirm exchanges are offered" },
        { value: "no", label: "Confirm exchanges are not offered" },
      ],
    };
  }
  if (row.item_type === "schema_gap") {
    const unsupported = code.replace(/^unsupported_/, "");
    const domain =
      unsupported === "warranty" || unsupported === "complaints"
        ? "Warranty / Complaints"
        : "Returns";
    return {
      domain,
      issueTitle:
        unsupported === "warranty"
          ? "Warranty guidance needs a supported format"
          : unsupported === "complaints"
            ? "Complaint guidance needs a supported format"
            : "Source guidance is not supported here",
      why: merchantCopy(
        row.vocabulary_request || row.payload?.reason,
        "This source contains guidance that the current Knowledge model cannot publish safely.",
      ),
      proposedInterpretation:
        "The source remains evidence only. No generic prose rule will be created.",
      decision:
        "Dismiss this finding if it is not relevant, or keep it visible as a Knowledge gap.",
      evidence: truncate(row.payload?.evidence, 1200) || null,
      resolutionKey: `gap:${code}`,
      resolutionType: "gap",
      unsupported: true,
    };
  }
  return {
    issueTitle: reviewText(row),
    why: reviewText(row),
    proposedInterpretation: null,
    decision:
      "This item needs a specific merchant decision before it can be published.",
    evidence: truncate(row.payload?.evidence, 1200) || null,
    resolutionKey: reviewResolutionKey(row),
    resolutionType: "unsupported",
  };
}

function toFriendlySource(row, proposalCount = 0) {
  const origin = sourceOrigin(row);
  return {
    id: row.id,
    policyId: row.policy_id || null,
    title: merchantTitle(row?.meta?.title || row?.meta?.name, origin),
    type: sourceLabel(row),
    origin,
    capturedAt: row.captured_at || null,
    state: proposalCount ? "Needs review" : "Captured",
    proposalCount,
    excerpt:
      truncate(row.text_content, 420) ||
      "The captured source is stored securely for review.",
    proposals: [],
  };
}

function toFriendlyReview(row, policies, sources) {
  const policy = policies.get(text(row.policy_id));
  const sourceId = text(row.payload?.source_id);
  const details = friendlyReviewDetails(row, policy);
  const code = reviewCode(row);
  const type =
    row.item_type === "question" && code === "window_conflict"
      ? "Conflicting"
      : REVIEW_LABELS[text(row.item_type).toLowerCase()] || "Needs review";
  return {
    key: reviewResolutionKey(row),
    type,
    domain:
      details.domain ||
      domainLabel(policy?.domain_key || row.payload?.domain_key),
    issueTitle: details.issueTitle,
    why: details.why,
    proposedInterpretation: details.proposedInterpretation,
    decision: details.decision,
    scenario: truncate(
      merchantCopy(
        row.payload?.scenario || row.payload?.customer_question,
        "A customer scenario is waiting for merchant guidance.",
      ),
      220,
    ),
    source: sources.get(sourceId)?.title || "Merchant source",
    sourceId: sourceId || null,
    policyId: row.policy_id || null,
    proposalKey: details.proposalKey || null,
    resolutionKey: details.resolutionKey,
    resolutionType: details.resolutionType,
    options: details.options || [],
    unsupported: Boolean(details.unsupported),
    affectedKnowledge: details.proposalKey ? details.issueTitle : null,
    evidence: details.evidence,
    createdAt: row.created_at || null,
    status: text(row.status, "open"),
  };
}

export async function GET() {
  if (
    !isGreenfieldPlaygroundEnabled() ||
    (isGreenfieldPlaygroundProduction() && !isGreenfieldPlaygroundDevDiagnosticsEnabled()) ||
    !isGreenfieldPlaygroundDevTarget()
  ) {
    return NextResponse.json(
      { error: "Knowledge V2 UI is available only in the DEV environment." },
      { status: 404 },
    );
  }

  const authState = await auth();
  const { userId } = authState;
  if (!userId)
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );

  const supabase = createServiceSupabase();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase configuration is missing." },
      { status: 500 },
    );

  try {
    // Resolve the workspace exactly as the dashboard does, then select the
    // single active Shopify shop inside that server-derived scope. No tenant
    // identifier is accepted from the browser for this read-only surface.
    const scope = await resolveAuthScope(supabase, {
      clerkUserId: userId,
      orgId: authState.orgId,
      sessionClaims: authState.sessionClaims,
    });
    const shop = await resolveScopedShop(supabase, scope, undefined, {
      fields: "id, workspace_id, shop_domain",
      platform: "shopify",
      allowSingleScopedFallback: true,
      missingShopMessage:
        "No active Shopify store is available in this workspace.",
    });
    const context = await resolveKnowledgeContext({
      supabase,
      clerkUserId: userId,
      capability: "knowledge.read",
      requestedShopId: shop.id,
    });

    const { data: release, error: releaseError } = await supabase
      .from("kn2_releases")
      .select("seq, platform_version, platform_hash, sealed_at, activated_at")
      .eq("shop_id", context.shopId)
      .not("activated_at", "is", null)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (releaseError) throw new Error(releaseError.message);

    const [unitsResult, policiesResult, sourcesResult, reviewsResult, catalogResult] =
      await Promise.all([
        release
          ? supabase
              .from("kn2_unit_versions")
              .select(
                "id, unit_id, version, kind, domain_key, family_key, slot_key, audience, scope, payload, from_seq, to_seq, created_at, origin_policy_id",
              )
              .eq("shop_id", context.shopId)
              .lte("from_seq", release.seq)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("kn2_policies")
          .select(
            "id, domain_key, title, created_at, updated_at, drafts, template_version, status",
          )
          .eq("shop_id", context.shopId)
          // Immutable publish sealing archives the policy row after its
          // product units enter the release.  Keep archived Product
          // Knowledge rows available for editor hydration; runtime remains
          // release-based and general guidance still uses active rows only.
          .or("status.eq.active,domain_key.eq.product_support,drafts->merchant_document->>contract.eq.merchant_support/v1"),
        supabase
          .from("kn2_sources")
          .select(
            "id, source_type, source_key, captured_at, language, mime, text_content, storage_path, meta",
          )
          .eq("shop_id", context.shopId)
          .order("captured_at", { ascending: false })
          .limit(100),
        supabase
          .from("kn2_review_items")
          .select(
            "id, policy_id, item_type, status, dedupe_key, vocabulary_request, payload, created_at, updated_at",
          )
          .eq("shop_id", context.shopId)
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("shop_products")
          .select("id, external_id, title, handle, raw")
          .eq("shop_ref_id", context.shopId)
          .eq("status", "active")
          .order("title", { ascending: true })
          .limit(200),
      ]);
    for (const result of [
      unitsResult,
      policiesResult,
      sourcesResult,
      reviewsResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const policies = new Map(
      (policiesResult.data || []).map((row) => [row.id, row]),
    );
    const productGuidance = Object.fromEntries(
      (policiesResult.data || [])
        .map((policy) => ({ policy, draft: policy.drafts?.product_guidance }))
        .filter(({ draft }) => draft?.product_id)
        // Duplicate active product policies can exist after immutable publish
        // replays.  The newest canonical draft is the one the editor should
        // show; the active release still determines runtime units.
        .sort((left, right) => {
          const leftTime = new Date(left.policy?.updated_at || left.policy?.created_at || 0).getTime();
          const rightTime = new Date(right.policy?.updated_at || right.policy?.created_at || 0).getTime();
          return rightTime - leftTime;
        })
        .map(({ policy, draft }) => [
          String(draft.product_id),
          {
            policyId: policy.id,
            productId: String(draft.product_id),
            productExternalId: draft.product_external_id || null,
            productTitle: draft.product_title || null,
            customerContent: draft.customer_content || "",
            sourceId: draft.source_id || null,
            reviewState: draft.review_state || "draft",
            runtimeState:
              draft.runtime_state || "awaiting_supported_product_contract",
            typedReady: Boolean(
              draft.validation?.ok && Object.keys(draft.units || {}).length,
            ),
            problemKey: draft.problem_key || null,
            modelKey: draft.model_key || null,
            validation: draft.validation || { ok: false, errors: [] },
            unitIds: Object.keys(draft.units || {}),
            updatedAt: draft.updated_at || null,
          },
        ])
        // If two active rows somehow share a product id, Map construction
        // would otherwise keep the last row and make hydration order
        // dependent.  The list is sorted newest-first, so retain the first
        // canonical draft for each stable shop product id.
        .filter((entry, index, entries) =>
          entries.findIndex(([productId]) => productId === entry[0]) === index,
        ),
    );
    const sourceRows = sourcesResult.data || [];
    const sourceCounts = new Map();
    for (const unit of unitsResult.data || []) {
      const sourceId = sourceIdFromPayload(unit.payload);
      if (sourceId)
        sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
    }
    for (const policy of policiesResult.data || []) {
      const sourceId = text(policy.drafts?.manual?.source_id);
      if (sourceId)
        sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
      const extractionSourceId = text(policy.drafts?.extraction_source_id);
      if (extractionSourceId)
        sourceCounts.set(
          extractionSourceId,
          (sourceCounts.get(extractionSourceId) || 0) +
            Object.keys(policy.drafts?.units ?? {}).length,
        );
      for (const draft of Object.values(policy.drafts?.units ?? {})) {
        if (draft?.source_id)
          sourceCounts.set(
            draft.source_id,
            (sourceCounts.get(draft.source_id) || 0) + 1,
          );
      }
    }
    const sources = new Map(
      sourceRows.map((row) => [
        row.id,
        toFriendlySource(row, sourceCounts.get(row.id) || 0),
      ]),
    );
    const units = (unitsResult.data || [])
      .filter((row) => row.to_seq === null || row.to_seq > release.seq)
      .map((row) => {
        const policy = policies.get(row.origin_policy_id);
        const source = sources.get(sourceIdFromPayload(row.payload));
        const manual = policy?.drafts?.manual;
        const urlDraft =
          policy?.drafts?.units &&
          Object.values(policy.drafts.units).find(
            (draft) => draft.unit_id === row.unit_id,
          );
        const proposalCopy =
          urlDraft?.origin === "extraction"
            ? friendlyReturnsProposal(urlDraft)
            : null;
        return {
          id: row.id,
          title: proposalCopy?.title || unitTitle(row, policy),
          domain: domainLabel(row.domain_key),
          status: "Published",
          summary:
            manual?.review_state === "published"
              ? manualSummary(manual)
              : proposalCopy?.summary || customerSummary(row),
          applicability: proposalCopy?.applicability || applicability(row),
          source: source?.title || "Merchant source",
          sourceId: source?.id || null,
          evidence: proposalCopy?.evidence || null,
          updatedAt:
            row.created_at || release.activated_at || release.sealed_at,
          audience:
            row.audience === "customer"
              ? "Customer-facing"
              : "Internal guidance",
          policyId: row.origin_policy_id || null,
          unitId: row.unit_id || null,
          knowledgeType:
            row.payload?.semantic_type || manual?.knowledgeType || manual?.knowledge_type || null,
        };
      });
    const draftItems = (policiesResult.data || [])
      .map((policy) => ({ policy, manual: policy.drafts?.manual }))
      .filter(({ manual }) => manual && manual.review_state !== "published")
      .map(({ policy, manual }) => ({
        id: `draft-${policy.id}`,
        title: merchantTitle(manual.title, policy.title),
        domain: domainLabel(manual.domain || policy.domain_key),
        status: manualStatus(manual.review_state),
        summary: manualSummary(manual),
        applicability: [
          manual.appliesTo || manual.applies_to || "Applicability not set",
        ],
        source: sources.get(text(manual.source_id))?.title || "Manual source",
        sourceId: text(manual.source_id) || null,
        updatedAt: manual.updated_at || policy.updated_at,
        audience: "Customer-facing",
        policyId: policy.id,
        unitId: manual.unit_id || null,
        knowledgeType: manual.knowledgeType || manual.knowledge_type || null,
        validation: manual.validation || { ok: false, errors: [] },
      }));
    const extractedItems = (policiesResult.data || [])
      .flatMap((policy) =>
        Object.values(policy.drafts?.units ?? {}).map((draft) => ({
          policy,
          draft,
        })),
      )
      .filter(
        ({ draft }) =>
          draft?.origin === "extraction" && draft.review_state !== "published",
      )
      .map(({ policy, draft }) => {
        const copy = friendlyReturnsProposal(draft);
        return {
          id: `proposal-${policy.id}-${draft.key}`,
          title: copy.title,
          domain: "Returns",
          status:
            draft.review_state === "accepted"
              ? "Needs review"
              : draft.review_state === "rejected"
                ? "Draft"
                : "Needs review",
          summary: copy.summary,
          applicability: copy.applicability,
          source: sources.get(text(draft.source_id))?.title || "Website source",
          sourceId: text(draft.source_id) || null,
          evidence: copy.evidence || null,
          updatedAt: draft.reviewed_at || policy.updated_at,
          audience: "Customer-facing",
          policyId: policy.id,
          proposalKey: draft.key,
          unitId: draft.unit_id,
          knowledgeType: "Returns guidance",
          validation: { ok: true, errors: [] },
        };
      });
    const visibleUnits = [...units, ...draftItems, ...extractedItems];
    const friendlySources = [...sources.values()]
      .map((source) => ({
        ...source,
        proposals: visibleUnits
          .filter((unit) => unit.sourceId === source.id)
          .map((unit) => ({
            id: unit.id,
            title: unit.title,
            domain: unit.domain,
          })),
      }))
      .map((source) => ({
        ...source,
        state: source.proposals.some(
          (proposal) =>
            visibleUnits.find((unit) => unit.id === proposal.id)?.status ===
            "Published",
        )
          ? "Published"
          : source.state,
      }));
    const reviews = (reviewsResult.data || [])
      .filter((row) => row.status === "open")
      .map((row) => toFriendlyReview(row, policies, sources));
    const recentChanges = [
      ...visibleUnits.map((unit) => ({
        id: `knowledge-${unit.id}`,
        kind: "Knowledge",
        title: unit.title,
        detail: `${unit.domain} · ${unit.status}`,
        occurredAt: unit.updatedAt,
      })),
      ...friendlySources.map((source) => ({
        id: `source-${source.id}`,
        kind: "Source",
        title: source.title,
        detail: `${source.type} · ${source.state}`,
        occurredAt: source.capturedAt,
      })),
      ...reviews.map((review) => ({
        id: `review-${review.key}`,
        kind: "Review",
        title: review.issueTitle,
        detail: `${review.domain} · ${review.type}`,
        occurredAt: review.createdAt,
      })),
    ]
      .filter((change) => change.occurredAt)
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime(),
      )
      .filter(
        (change, index, changes) =>
          changes.findIndex(
            (candidate) =>
              candidate.kind === change.kind &&
              candidate.title === change.title,
          ) === index,
      )
      .slice(0, 8);

    return NextResponse.json({
      data_source: "kn2",
      release: release
        ? { seq: release.seq, platformVersion: release.platform_version, platformHash: release.platform_hash, activatedAt: release.activated_at, sealedAt: release.sealed_at }
        : null,
      knowledge: visibleUnits,
      canonicalGuidance: canonicalGuidanceFromPolicies(policiesResult.data || []),
      productGuidance,
      merchantDocuments: (policiesResult.data || [])
        .filter(policy => policy.drafts?.merchant_document?.contract === "merchant_support/v1")
        .map(policy => ({ policyId: policy.id, ...policy.drafts.merchant_document })),
      catalogProducts: (catalogResult.data || []).map((product) => {
        const raw = product?.raw && typeof product.raw === "object" ? product.raw : {};
        const description = text(raw.body_html || raw.description || raw.body || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const variants = Array.isArray(raw.variants)
          ? raw.variants
              .map((variant) => text(variant?.title || variant?.name))
              .filter(Boolean)
              .slice(0, 12)
          : [];
        return {
          id: String(product.id),
          externalId: String(product.external_id || ""),
          title: text(product.title),
          handle: text(product.handle),
          description,
          vendor: text(raw.vendor),
          productType: text(raw.product_type || raw.productType),
          variants,
        };
      }),
      sources: friendlySources,
      reviews,
      recentChanges,
    });
  } catch (error) {
    if (error instanceof KnowledgeAuthzError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status || 403 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load Knowledge V2.",
      },
      { status: 500 },
    );
  }
}
