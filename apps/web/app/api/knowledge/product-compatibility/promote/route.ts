// apps/web/app/api/knowledge/product-compatibility/promote/route.ts
//
// Slice I — admin action: PROMOTE selected suggested compatibility rows to
// confidence='confirmed' (human approval). Dry-run-first, gated, tenant-scoped.
//
// Safety contract:
//   - Default is dry-run: promotes only when dryRun=false AND apply=true.
//   - Promotes ONLY confidence='suggested', source='website_compatibility_extraction'.
//   - Conflict (review_note) / source_type='ocr_chart' rows require force=true.
//   - The update sets confidence + reviewed_at/by + (optional) review_note ONLY;
//     evidence_text/source_url/source_type/condition/target/connection/compatible
//     are never touched.
//   - Only the requested ids, only within the caller's scoped shop, are affected.
//   - Promotion makes rows runtime-usable (runtime serves confirmed-only); this
//     is the one place suggested -> confirmed happens, and only on explicit apply.

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import {
  buildPromotionUpdate,
  planCompatibilityPromotion,
  PROMOTE_SOURCE,
  resolvePromoteIntent,
} from "@/lib/server/commerce/product-compatibility-promote";

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
    const force = body?.force === true;
    const reviewNote = typeof body?.review_note === "string" && body.review_note.trim()
      ? body.review_note.trim()
      : null;
    const { dryRun, willWrite } = resolvePromoteIntent({ dryRun: body?.dryRun, apply: body?.apply });
    const ids: number[] = Array.isArray(body?.ids)
      ? body.ids.map((x: unknown) => Number(x)).filter(Number.isFinite)
      : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids[] is required." }, { status: 400 });
    }

    // Tenant guard: throws if the shop is not in the caller's scope.
    const shop = await resolveScopedShop(client, scope, requestedShopId, {
      fields: "id, workspace_id",
      missingShopMessage: "shop_ref_id is required.",
    });
    const shopRefId = shop.id as string;

    // Fetch ONLY this shop's rows for the requested ids, from this source.
    // (Other shops' ids are excluded here, so they can never be promoted.)
    const { data: rows, error: fetchErr } = await client
      .from("shop_product_compatibility")
      .select("id, confidence, source, source_type, review_note")
      .eq("shop_ref_id", shopRefId)
      .eq("source", PROMOTE_SOURCE)
      .in("id", ids);
    if (fetchErr) throw new Error(fetchErr.message);

    const { toPromote, skipped } = planCompatibilityPromotion({ ids, rows: rows ?? [], force });

    let promoted = 0;
    if (willWrite && toPromote.length) {
      const update = buildPromotionUpdate({
        reviewedBy: clerkUserId,
        reviewNote,
        now: new Date().toISOString(),
      });
      // Defense in depth: only ever flip suggested rows of this source, in scope.
      const { data: updated, error: updErr } = await client
        .from("shop_product_compatibility")
        .update(update)
        .eq("shop_ref_id", shopRefId)
        .eq("source", PROMOTE_SOURCE)
        .eq("confidence", "suggested")
        .in("id", toPromote)
        .select("id");
      if (updErr) throw new Error(updErr.message);
      promoted = Array.isArray(updated) ? updated.length : 0;
    }

    return NextResponse.json(
      {
        success: true,
        shop_ref_id: shopRefId,
        dryRun,
        applied: willWrite,
        force,
        would_promote: toPromote,
        promoted,
        skipped,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Promote failed";
    const status = /scope|not found/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
