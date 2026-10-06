import {
  ingestMerchantDocument,
  approveMerchantDocument,
  publishMerchantDocuments,
  activateMerchantDocuments,
} from "@/lib/server/knowledge-v2/merchant-documents";
import { resolveShopifyCredentialsWithDiagnostics } from "@/lib/server/shopify-credentials";
import { fetchShopifyProducts } from "@/lib/server/shopify-product-fetch";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
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
  KnowledgeAuthzError,
  resolveKnowledgeContext,
} from "@/lib/server/knowledge-v2/authz";
import {
  approveManualDraft,
  approveReturnsGuidanceDraft,
  approveOrderStatusGuidanceDraft,
  approveWarrantyGuidanceDraft,
  approveProductGuidanceDraft,
  approveExtractedProposals,
  activePinnedRelease,
  captureSource,
  createSourceGapItems,
  editExtractedProposal,
  markManualPublished,
  markReturnsGuidancePublished,
  markOrderStatusGuidancePublished,
  markWarrantyGuidancePublished,
  markProductGuidancePublished,
  markExtractedPublished,
  publishManualDraft,
  publishReturnsGuidanceDraft,
  publishOrderStatusGuidanceDraft,
  publishWarrantyGuidanceDraft,
  publishProductGuidanceDraft,
  publishReturns,
  proposeReturnsDrafts,
  rejectExtractedProposals,
  resolveReturnsReviewItem,
  resolveReturnsSlotUnitIds,
  saveManualDraft,
  saveProductGuidanceDraft,
  saveReturnsGuidanceDraft,
  saveOrderStatusGuidanceDraft,
  saveWarrantyGuidanceDraft,
  activateRelease,
} from "@/lib/server/knowledge-v2/authoring";
import { extractReturnsCandidates } from "@/lib/server/knowledge-v2/authoring";
import { extractFileSource } from "@/lib/server/knowledge-v2/file-ingestion";
import {
  detectUnsupportedSections,
  fetchUrlSource,
  friendlyReturnsProposal,
  normalizeSubmittedUrl,
  sourceStages,
} from "@/lib/server/knowledge-v2/url-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error) {
  if (error instanceof KnowledgeAuthzError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status || 400 },
    );
  }
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Knowledge authoring failed.",
    },
    { status: 500 },
  );
}
async function resolveContext({ supabase, authState, capability }) {
  const scope = await resolveAuthScope(supabase, {
    clerkUserId: authState.userId,
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
  return resolveKnowledgeContext({
    supabase,
    clerkUserId: authState.userId,
    capability,
    requestedShopId: shop.id,
  });
}

export async function POST(request) {
  if (
    !isGreenfieldPlaygroundEnabled() ||
    (isGreenfieldPlaygroundProduction() && !isGreenfieldPlaygroundDevDiagnosticsEnabled()) ||
    !isGreenfieldPlaygroundDevTarget()
  ) {
    return NextResponse.json(
      {
        error: "Knowledge authoring is available only in the DEV environment.",
      },
      { status: 404 },
    );
  }
  const authState = await auth();
  if (!authState.userId)
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
    const multipart = String(request.headers.get("content-type") || "")
      .toLowerCase()
      .includes("multipart/form-data");
    const body = multipart ? await request.formData() : await request.json();
    const action = String(
      multipart ? (body.get("action") ?? "") : (body?.action ?? ""),
    );
    if (action === "ingest_document") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const credentials = await resolveShopifyCredentialsWithDiagnostics(
        supabase,
        { workspaceId: context.workspaceId },
        { requestedShopId: context.shopId },
      );
      const products = await fetchShopifyProducts({
        domain: credentials.shop_domain,
        accessToken: credentials.access_token,
      });
      const catalog = products.map((product) => ({
        id: String(product.id),
        title: product.title,
        shopId: context.shopId,
      }));
      const result = await ingestMerchantDocument({
        supabase,
        context,
        input: body.document ?? {},
        catalog,
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "approve_document") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const result = await approveMerchantDocument({
        supabase,
        context,
        policyId: body.policyId,
        resolutions: body.resolutions ?? [],
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "publish_documents") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.publish",
      });
      const result = await publishMerchantDocuments({
        supabase,
        context,
        policyIds: body.policyIds,
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "activate_documents") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.activate",
      });
      const result = await activateMerchantDocuments({
        supabase,
        context,
        seq: body.seq,
        policyIds: body.policyIds,
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "save_draft") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const result = await saveManualDraft({
        supabase,
        context,
        input: body?.draft ?? {},
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "save_returns_guidance") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const result = await saveReturnsGuidanceDraft({
        supabase,
        context,
        input: body?.draft ?? {},
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "save_order_status_guidance") {
      const context = await resolveContext({ supabase, authState, capability: "knowledge.draft.edit" });
      const result = await saveOrderStatusGuidanceDraft({ supabase, context, input: body?.draft ?? {} });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "save_warranty_guidance") {
      const context = await resolveContext({ supabase, authState, capability: "knowledge.draft.edit" });
      const result = await saveWarrantyGuidanceDraft({ supabase, context, input: body?.draft ?? {} });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "save_product_guidance") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const result = await saveProductGuidanceDraft({
        supabase,
        context,
        input: body?.draft ?? {},
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "capture_url") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const submittedUrl = normalizeSubmittedUrl(body?.url);
      const fetched = await fetchUrlSource({ url: submittedUrl });
      const sourceTitle =
        typeof body?.title === "string" && body.title.trim()
          ? body.title.trim()
          : fetched.title;
      const source = await captureSource({
        supabase,
        context,
        sourceType: "website_page",
        sourceKey: submittedUrl,
        text: fetched.canonicalText,
        rawBytes: fetched.rawBytes,
        mime: fetched.mime,
        language: "en",
        meta: {
          url: submittedUrl,
          final_url: fetched.finalUrl,
          title: sourceTitle,
          captured_at: new Date().toISOString(),
          capture_mode: "single_url",
        },
      });
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey)
        throw new KnowledgeAuthzError(
          503,
          "extraction_unavailable",
          "The source was captured, but proposal preparation is temporarily unavailable.",
        );
      const extraction = await extractReturnsCandidates({
        apiKey,
        sourceText: fetched.canonicalText,
      });
      const unitIds = await resolveReturnsSlotUnitIds({ supabase, context });
      const title = `Returns — ${sourceTitle.slice(0, 100)}`;
      const result = await proposeReturnsDrafts({
        supabase,
        context,
        sourceId: source.id,
        extraction,
        sourceText: fetched.canonicalText,
        title,
        unitIds,
        createProposalReviews: true,
      });
      const unsupported = detectUnsupportedSections(fetched.canonicalText);
      const gaps = await createSourceGapItems({
        supabase,
        context,
        policyId: result.policyId,
        sourceId: source.id,
        findings: unsupported,
      });
      const proposals = result.drafts.map((draft) => ({
        key: draft.key,
        status: draft.review_state,
        ...friendlyReturnsProposal(draft),
        sourceId: source.id,
        policyId: result.policyId,
      }));
      return NextResponse.json({
        ok: true,
        action,
        stages: sourceStages(),
        source: {
          id: source.id,
          title: sourceTitle,
          url: fetched.finalUrl,
          capturedAt: source.captured_at,
          contentHash: source.content_hash,
          excerpt: fetched.canonicalText.slice(0, 420),
        },
        policyId: result.policyId,
        proposals,
        unresolved: result.questions,
        unsupported: [
          ...result.questions.map((question) => ({
            code: question.code,
            message: question.question,
            evidence: question.evidence,
          })),
          ...gaps,
        ],
      });
    }
    if (action === "capture_file") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const file = body.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        throw new KnowledgeAuthzError(
          400,
          "file_required",
          "Choose a PDF or TXT file to upload.",
        );
      }
      const parsed = await extractFileSource({
        fileName: file.name,
        mimeType: file.type,
        rawBytes: new Uint8Array(await file.arrayBuffer()),
      });
      const rawContentHash = `sha256:${createHash("sha256").update(Buffer.from(parsed.rawBytes)).digest("hex")}`;
      const sourceTitle =
        typeof body.get("title") === "string" && body.get("title").trim()
          ? body.get("title").trim()
          : parsed.title;
      const source = await captureSource({
        supabase,
        context,
        sourceType: "merchant_upload",
        sourceKey: `file:${parsed.fileName}:${rawContentHash}`,
        text: parsed.canonicalText,
        rawBytes: parsed.rawBytes,
        mime: parsed.mimeType,
        language: "en",
        meta: {
          filename: parsed.fileName,
          mime_type: parsed.mimeType,
          size_bytes: parsed.sizeBytes,
          original_content_hash: rawContentHash,
          title: sourceTitle,
          captured_at: new Date().toISOString(),
          capture_mode: "single_file",
          parser: parsed.kind,
          page_count: parsed.pageCount,
        },
      });
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey)
        throw new KnowledgeAuthzError(
          503,
          "extraction_unavailable",
          "The file was captured, but proposal preparation is temporarily unavailable.",
        );
      const extraction = await extractReturnsCandidates({
        apiKey,
        sourceText: parsed.canonicalText,
      });
      const unitIds = await resolveReturnsSlotUnitIds({ supabase, context });
      const title = `Returns — ${sourceTitle.slice(0, 100)}`;
      const result = await proposeReturnsDrafts({
        supabase,
        context,
        sourceId: source.id,
        extraction,
        sourceText: parsed.canonicalText,
        title,
        unitIds,
        createProposalReviews: true,
      });
      const unsupported = detectUnsupportedSections(parsed.canonicalText);
      const gaps = await createSourceGapItems({
        supabase,
        context,
        policyId: result.policyId,
        sourceId: source.id,
        findings: unsupported,
      });
      const proposals = result.drafts.map((draft) => ({
        key: draft.key,
        status: draft.review_state,
        ...friendlyReturnsProposal(draft),
        sourceId: source.id,
        policyId: result.policyId,
      }));
      return NextResponse.json({
        ok: true,
        action,
        stages: sourceStages(),
        source: {
          id: source.id,
          title: sourceTitle,
          filename: parsed.fileName,
          mime: parsed.mimeType,
          sizeBytes: parsed.sizeBytes,
          parser: parsed.kind,
          pageCount: parsed.pageCount,
          capturedAt: source.captured_at,
          contentHash: source.content_hash,
          originalContentHash: rawContentHash,
          excerpt: parsed.canonicalText.slice(0, 420),
        },
        extractedText: {
          characters: parsed.canonicalText.length,
          excerpt: parsed.canonicalText.slice(0, 1200),
        },
        policyId: result.policyId,
        proposals,
        unresolved: result.questions,
        unsupported: [
          ...result.questions.map((question) => ({
            code: question.code,
            message: question.question,
            evidence: question.evidence,
          })),
          ...gaps,
        ],
      });
    }
    if (action === "approve_url") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const approved = await approveExtractedProposals({
        supabase,
        context,
        policyId: body?.policyId,
        unitKeys: body?.keys || "all",
      });
      return NextResponse.json({
        ok: true,
        action,
        policyId: body?.policyId,
        approved,
      });
    }
    if (action === "reject_url") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const rejected = await rejectExtractedProposals({
        supabase,
        context,
        policyId: body?.policyId,
        unitKeys: body?.keys,
      });
      return NextResponse.json({
        ok: true,
        action,
        policyId: body?.policyId,
        rejected,
      });
    }
    if (action === "edit_url") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.draft.edit",
      });
      const result = await editExtractedProposal({
        supabase,
        context,
        policyId: body?.policyId,
        key: body?.key,
        edit: body?.edit ?? {},
      });
      return NextResponse.json({
        ok: true,
        action,
        policyId: result.policyId,
        key: result.key,
      });
    }
    if (action === "resolve_review") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const result = await resolveReturnsReviewItem({
        supabase,
        context,
        policyId: body?.policyId,
        resolutionKey: body?.resolutionKey,
        resolutionType: body?.resolutionType,
        answer: body?.answer ?? {},
        edit: body?.edit ?? {},
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "publish_url") {
      const publishContext = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.publish",
      });
      const { pinned } = await activePinnedRelease({
        supabase,
        context: publishContext,
      });
      const result = await publishReturns({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
        pinned,
      });
      let activatedAt = null;
      if (!result.reused) {
        const activateContext = await resolveContext({
          supabase,
          authState,
          capability: "knowledge.activate",
        });
        activatedAt = await activateRelease({
          supabase,
          context: activateContext,
          seq: result.seq,
        });
      }
      await markExtractedPublished({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
        seq: result.seq,
      });
      return NextResponse.json({ ok: true, action, ...result, activatedAt });
    }
    if (action === "approve") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const result = await approveManualDraft({
        supabase,
        context,
        policyId: body?.policyId,
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "approve_returns_guidance") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const result = await approveReturnsGuidanceDraft({
        supabase,
        context,
        policyId: body?.policyId,
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "approve_order_status_guidance") {
      const context = await resolveContext({ supabase, authState, capability: "knowledge.review.answer" });
      const result = await approveOrderStatusGuidanceDraft({ supabase, context, policyId: body?.policyId });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "approve_warranty_guidance") {
      const context = await resolveContext({ supabase, authState, capability: "knowledge.review.answer" });
      const result = await approveWarrantyGuidanceDraft({ supabase, context, policyId: body?.policyId });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "approve_product_guidance") {
      const context = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.review.answer",
      });
      const result = await approveProductGuidanceDraft({
        supabase,
        context,
        policyId: body?.policyId,
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "publish") {
      const publishContext = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.publish",
      });
      const result = await publishManualDraft({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
      });
      let activatedAt = null;
      if (!result.reused) {
        const activateContext = await resolveContext({
          supabase,
          authState,
          capability: "knowledge.activate",
        });
        activatedAt = await activateRelease({
          supabase,
          context: activateContext,
          seq: result.seq,
        });
      }
      const state = await markManualPublished({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
        seq: result.seq,
      });
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        activatedAt,
        draft: state.draft,
      });
    }
    if (action === "publish_returns_guidance") {
      const publishContext = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.publish",
      });
      const result = await publishReturnsGuidanceDraft({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
      });
      let activatedAt = null;
      if (!result.reused) {
        const activateContext = await resolveContext({
          supabase,
          authState,
          capability: "knowledge.activate",
        });
        activatedAt = await activateRelease({
          supabase,
          context: activateContext,
          seq: result.seq,
        });
      }
      const state = await markReturnsGuidancePublished({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
        seq: result.seq,
      });
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        activatedAt,
        draft: state.draft,
      });
    }
    if (action === "publish_order_status_guidance") {
      const publishContext = await resolveContext({ supabase, authState, capability: "knowledge.publish" });
      const result = await publishOrderStatusGuidanceDraft({ supabase, context: publishContext, policyId: body?.policyId });
      let activatedAt = null;
      if (!result.reused) {
        const activateContext = await resolveContext({ supabase, authState, capability: "knowledge.activate" });
        activatedAt = await activateRelease({ supabase, context: activateContext, seq: result.seq });
      }
      const state = await markOrderStatusGuidancePublished({ supabase, context: publishContext, policyId: body?.policyId, seq: result.seq });
      return NextResponse.json({ ok: true, action, ...result, activatedAt, draft: state.draft });
    }
    if (action === "publish_warranty_guidance") {
      const publishContext = await resolveContext({ supabase, authState, capability: "knowledge.publish" });
      const result = await publishWarrantyGuidanceDraft({ supabase, context: publishContext, policyId: body?.policyId });
      let activatedAt = null;
      if (!result.reused) {
        const activateContext = await resolveContext({ supabase, authState, capability: "knowledge.activate" });
        activatedAt = await activateRelease({ supabase, context: activateContext, seq: result.seq });
      }
      const state = await markWarrantyGuidancePublished({ supabase, context: publishContext, policyId: body?.policyId, seq: result.seq });
      return NextResponse.json({ ok: true, action, ...result, activatedAt, draft: state.draft });
    }
    if (action === "publish_product_guidance") {
      const publishContext = await resolveContext({
        supabase,
        authState,
        capability: "knowledge.publish",
      });
      const result = await publishProductGuidanceDraft({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
      });
      let activatedAt = null;
      if (!result.reused) {
        const activateContext = await resolveContext({
          supabase,
          authState,
          capability: "knowledge.activate",
        });
        activatedAt = await activateRelease({
          supabase,
          context: activateContext,
          seq: result.seq,
        });
      }
      const state = await markProductGuidancePublished({
        supabase,
        context: publishContext,
        policyId: body?.policyId,
        seq: result.seq,
      });
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        activatedAt,
        draft: state.draft,
      });
    }
    return NextResponse.json(
      { error: "Choose a supported authoring action." },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
