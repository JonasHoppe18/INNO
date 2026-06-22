// apps/web/app/api/knowledge/product-compatibility/suggest/route.ts
//
// Slice G — admin action: generate SUGGESTED product compatibility rows from
// existing Sona-stored product content (body_html/description, plus OCR chart
// text), and (optionally) write them to shop_product_compatibility.
//
// Safety contract (mirrors product-specs/suggest):
//   - Default is dry-run: writes only when dryRun=false AND apply=true.
//   - Only ever writes confidence='suggested',
//     source='website_compatibility_extraction'.
//   - Never overwrites confirmed / manual / metafield rows (planner guard).
//   - Never creates confirmed rows, never deletes, never promotes.
//   - Suggested rows are NOT served by the runtime (it serves confirmed only).
//   - apply=true requires the additive evidence-columns migration; if those
//     columns are missing it fails safely with a clear error and writes nothing.
//   - Tenant-scoped via resolveScopedShop (cross-shop access throws).

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
// Single source of truth: the pure extractor shipped in Slice F. Imported across
// the app boundary (next.config experimental.externalDir = true).
import { extractCompatibilityCandidates } from "../../../../../../../supabase/functions/generate-draft-v2/stages/product-compatibility-extraction";
import {
  missingEvidenceColumns,
  planSuggestedCompatibilityWrites,
  REQUIRED_EVIDENCE_COLUMNS,
  resolveWriteIntent,
} from "@/lib/server/commerce/product-compatibility-suggest";

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

function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Map a planner toWrite row to a shop_product_compatibility DB row. needs_review
// is not a table column — fold it into review_note so the flag survives.
function toDbRow(row: Record<string, unknown>) {
  const needsReview = row.needs_review === true;
  const note = (row.review_note as string | null) ??
    (needsReview ? "auto-flagged: needs human review before promotion" : null);
  return {
    shop_ref_id: row.shop_ref_id,
    workspace_id: row.workspace_id,
    product_id: row.product_id,
    target: row.target,
    connection: row.connection,
    compatible: row.compatible,
    condition: row.condition ?? null,
    reason: row.reason ?? null,
    workaround: row.workaround ?? null,
    confidence: "suggested",
    source: "website_compatibility_extraction",
    evidence_text: row.evidence_text ?? null,
    source_url: row.source_url ?? null,
    source_type: row.source_type ?? null,
    extracted_at: row.extracted_at ?? null,
    review_note: note,
  };
}

// Probe whether the additive evidence columns exist (apply path only). Selecting
// them with limit(0) errors cleanly on a pre-migration table.
async function evidenceColumnsReady(client: ReturnType<typeof createClient>) {
  const { error } = await client
    .from("shop_product_compatibility")
    .select(REQUIRED_EVIDENCE_COLUMNS.join(","))
    .limit(0);
  return !error;
}

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const client = serviceClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(
      client,
      { clerkUserId, orgId },
      { requireExplicitWorkspace: true },
    );
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ error: "Could not resolve workspace/user scope." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedShopId = String(body?.shop_ref_id || body?.shop_id || "").trim();
    const { dryRun, apply, willWrite } = resolveWriteIntent({
      dryRun: body?.dryRun,
      apply: body?.apply,
    });
    const productIds: number[] = Array.isArray(body?.productIds)
      ? body.productIds.map((x: unknown) => Number(x)).filter(Number.isFinite)
      : [];

    // Tenant guard: throws if the shop is not in the caller's scope.
    const shop = await resolveScopedShop(client, scope, requestedShopId, {
      fields: "id, workspace_id",
      missingShopMessage: "shop_ref_id is required.",
    });
    const shopRefId = shop.id as string;
    const workspaceId = (shop.workspace_id as string) ?? scope.workspaceId ?? null;

    // Product text (already synced into Sona — no Shopify call).
    let productQuery = client
      .from("shop_products")
      .select("id, title, product_url, description, raw")
      .eq("shop_ref_id", shopRefId);
    if (productIds.length) productQuery = productQuery.in("id", productIds);
    const { data: productRows, error: productErr } = await productQuery;
    if (productErr) throw new Error(productErr.message);

    // Optional secondary source: OCR'd comparison-chart text (shop-level).
    // Best-effort — never fails the dry-run.
    let ocrText = "";
    try {
      const { data: ocrRows } = await client
        .from("agent_knowledge")
        .select("content")
        .eq("shop_id", shopRefId)
        .eq("source_provider", "shopify_file")
        .eq("metadata->>file_kind", "image_ocr")
        .limit(50);
      ocrText = (ocrRows ?? []).map((r: Record<string, unknown>) => String(r.content ?? "")).join("\n");
    } catch {
      ocrText = "";
    }

    const products = (productRows ?? []).map((p: Record<string, any>) => ({
      productId: p.id as number,
      candidates: extractCompatibilityCandidates({
        productId: p.id,
        productTitle: p.title,
        productUrl: p.product_url,
        bodyHtml: p.raw?.body_html ?? p.description ?? null,
        ocrText: ocrText || null,
        sourceType: "body_html",
      }),
    }));

    // Existing rows — minimal columns only, so dry-run works pre-migration.
    const { data: existing, error: existingErr } = await client
      .from("shop_product_compatibility")
      .select("product_id, target, connection, confidence, source")
      .eq("shop_ref_id", shopRefId);
    if (existingErr) throw new Error(existingErr.message);

    const { toWrite, skipped, byProduct } = planSuggestedCompatibilityWrites({
      shopRefId,
      workspaceId,
      products,
      existing: existing ?? [],
    });

    let written = 0;
    if (willWrite) {
      // Fail safely if the additive migration has not been applied.
      const ready = await evidenceColumnsReady(client);
      if (!ready) {
        return NextResponse.json(
          {
            error:
              "Compatibility evidence columns are not present. Apply migration " +
              "20260622000000_shop_product_compatibility_evidence_fields.sql before using apply=true.",
            migration_required: true,
            required_columns: REQUIRED_EVIDENCE_COLUMNS,
            missing_columns_helper: missingEvidenceColumns([]),
          },
          { status: 409 },
        );
      }
      if (toWrite.length) {
        const { error: upsertErr } = await client
          .from("shop_product_compatibility")
          .upsert(toWrite.map(toDbRow), {
            onConflict: "shop_ref_id,product_id,target,connection",
          });
        if (upsertErr) throw new Error(upsertErr.message);
        written = toWrite.length;
      }
    }

    return NextResponse.json(
      {
        success: true,
        shop_ref_id: shopRefId,
        dryRun,
        applied: willWrite,
        proposed_count: toWrite.length,
        written,
        skipped,
        proposed_by_product: byProduct,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Suggest failed";
    const status = /scope|not found/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
