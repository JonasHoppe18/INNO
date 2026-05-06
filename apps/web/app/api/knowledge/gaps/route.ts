import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

// GET /api/knowledge/gaps — returns aggregated knowledge gaps from the last 30 days
export async function GET() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId: userId, orgId });
    const shop = await resolveScopedShop(serviceClient, scope);
    if (!shop) return NextResponse.json({ gaps: [] });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: logs, error } = await serviceClient
      .from("agent_logs")
      .select("step_detail, created_at")
      .eq("step_name", "knowledge_gap_detected")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    // Aggregate gaps: count how many tickets were affected per unique gap
    const gapMap = new Map<
      string,
      { gap: Record<string, unknown>; count: number; latest: string }
    >();

    for (const log of logs ?? []) {
      let detail: Record<string, unknown>;
      try {
        detail = typeof log.step_detail === "string"
          ? JSON.parse(log.step_detail)
          : log.step_detail ?? {};
      } catch {
        continue;
      }

      // Filter to this shop
      if (detail.shop_id && detail.shop_id !== shop.id) continue;

      const gaps = Array.isArray(detail.gaps) ? detail.gaps : [];
      for (const gap of gaps) {
        const key = `${gap.gap_type}__${gap.intent}`;
        const existing = gapMap.get(key);
        if (existing) {
          existing.count++;
          if (log.created_at > existing.latest) existing.latest = log.created_at;
        } else {
          gapMap.set(key, { gap, count: 1, latest: log.created_at ?? "" });
        }
      }
    }

    const aggregated = Array.from(gapMap.values())
      .sort((a, b) => b.count - a.count)
      .map(({ gap, count, latest }) => ({ ...gap, tickets_affected: count, latest_seen: latest }));

    return NextResponse.json({ gaps: aggregated });
  } catch (err) {
    console.error("[api/knowledge/gaps] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
