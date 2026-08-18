import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const shop = await resolveScopedShop(serviceClient, scope, undefined, {
      allowSingleScopedFallback: true,
    }).catch(() => null);
    if (!shop) return NextResponse.json({ gaps: [] });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let logsQuery = serviceClient
      .from("agent_logs")
      .select("step_detail, created_at, workspace_id")
      .eq("step_name", "knowledge_gap_detected")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (scope.workspaceId) {
      logsQuery = logsQuery.eq("workspace_id", scope.workspaceId);
    }
    const { data: logs, error } = await logsQuery;

    if (error) throw error;

    // Aggregate gaps: count how many tickets were affected per unique gap
    const gapMap = new Map<
      string,
      {
        gap: Record<string, unknown>;
        occurrences: number;
        threadIds: Set<string>;
        latest: string;
        latestThreadId: string | null;
      }
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

      // Service-role reads are always narrowed again to the resolved shop.
      if (detail.shop_id !== shop.id) continue;

      const gaps = Array.isArray(detail.gaps) ? detail.gaps : [];
      for (const gap of gaps) {
        const threadId = typeof detail.thread_id === "string"
          ? detail.thread_id
          : "";
        const key = [
          gap.gap_type,
          gap.intent,
          gap.fact_type,
          gap.product,
          gap.variant,
          gap.reason,
        ].map((value) => String(value ?? "").trim().toLowerCase()).join("__");
        const existing = gapMap.get(key);
        if (existing) {
          existing.occurrences++;
          if (threadId) existing.threadIds.add(threadId);
          if (log.created_at > existing.latest) {
            existing.latest = log.created_at;
            existing.latestThreadId = threadId || null;
          }
        } else {
          gapMap.set(key, {
            gap,
            occurrences: 1,
            threadIds: new Set(threadId ? [threadId] : []),
            latest: log.created_at ?? "",
            latestThreadId: threadId || null,
          });
        }
      }
    }

    const aggregated = Array.from(gapMap.values())
      .sort((a, b) =>
        (b.threadIds.size || b.occurrences) -
        (a.threadIds.size || a.occurrences)
      )
      .map(({ gap, occurrences, threadIds, latest, latestThreadId }) => ({
        ...gap,
        tickets_affected: threadIds.size || occurrences,
        latest_seen: latest,
        latest_thread_id: latestThreadId,
      }));

    return NextResponse.json({ gaps: aggregated });
  } catch (err) {
    console.error("[api/knowledge/gaps] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
