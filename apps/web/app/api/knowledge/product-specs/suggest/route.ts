// apps/web/app/api/knowledge/product-specs/suggest/route.ts
//
// Stage 4B-3-2f — admin action: generate SUGGESTED product specs from existing
// Sona-stored product text and (optionally) write them to shop_product_specs.
//
// Safety contract:
//   - Default is dry-run: writes only when dryRun=false AND apply=true.
//   - Only ever writes confidence='suggested', source='product_page_extraction'.
//   - Never overwrites confirmed or metafield-sourced specs (planner guard).
//   - Never creates confirmed specs, never deletes, never promotes.
//   - Suggested specs are not served by the runtime (it serves confirmed only).
//   - Tenant-scoped via resolveScopedShop (cross-shop access throws).

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { extractSuggestedSpecs } from "@/lib/server/commerce/product-text-spec-extraction";
import { planSuggestedSpecWrites } from "@/lib/server/commerce/product-spec-suggest";

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

// Map a planner toWrite row to a shop_product_specs DB row. needs_review is not
// a table column — fold it into review_note so the flag survives for reviewers.
function toDbRow(row: Record<string, unknown>) {
  const needsReview = row.needs_review === true;
  return {
    shop_ref_id: row.shop_ref_id,
    workspace_id: row.workspace_id,
    product_id: row.product_id,
    spec_key: row.spec_key,
    spec_group: row.spec_group,
    spec_value: row.spec_value,
    value_bool: row.value_bool ?? null,
    value_num: row.value_num ?? null,
    unit: row.unit ?? null,
    comparable: row.comparable ?? true,
    confidence: "suggested",
    source: "product_page_extraction",
    evidence_text: row.evidence_text ?? null,
    source_url: row.source_url ?? null,
    extracted_at: row.extracted_at ?? null,
    review_note: needsReview
      ? "auto-flagged: needs human review before promotion (e.g. DAC ranking conflict)"
      : null,
  };
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
    const dryRun = body?.dryRun !== false; // default true
    const apply = body?.apply === true; // default false
    const willWrite = apply && !dryRun;
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

    const products = (productRows ?? []).map((p: Record<string, any>) => ({
      productId: p.id as number,
      specs: extractSuggestedSpecs({
        productId: p.id,
        title: p.title,
        productUrl: p.product_url,
        bodyHtml: p.raw?.body_html ?? null,
        description: p.description ?? null,
      }),
    }));

    // Existing specs for the shop (to enforce the write guard).
    const { data: existing, error: existingErr } = await client
      .from("shop_product_specs")
      .select("product_id, spec_key, confidence, source")
      .eq("shop_ref_id", shopRefId);
    if (existingErr) throw new Error(existingErr.message);

    const { toWrite, skipped } = planSuggestedSpecWrites({
      shopRefId,
      workspaceId,
      products,
      existing: existing ?? [],
    });

    // Proposed view grouped by product (for the dry-run report).
    const proposedByProduct: Record<string, unknown[]> = {};
    for (const r of toWrite) {
      const k = String(r.product_id);
      (proposedByProduct[k] ??= []).push({
        spec_key: r.spec_key,
        spec_value: r.spec_value,
        value_bool: r.value_bool,
        value_num: r.value_num,
        unit: r.unit,
        evidence_text: r.evidence_text,
        source_url: r.source_url,
        needs_review: r.needs_review,
      });
    }

    let written = 0;
    if (willWrite && toWrite.length) {
      const { error: upsertErr } = await client
        .from("shop_product_specs")
        .upsert(toWrite.map(toDbRow), { onConflict: "shop_ref_id,product_id,spec_key" });
      if (upsertErr) throw new Error(upsertErr.message);
      written = toWrite.length;
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
        proposed_by_product: proposedByProduct,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Suggest failed";
    const status = /scope|not found/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
