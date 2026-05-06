import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

const INTENT_LABELS: Record<string, string> = {
  tracking: "Order tracking",
  refund: "Refunds",
  return: "Returns",
  exchange: "Exchanges & warranty",
  complaint: "Complaints",
  warranty: "Warranty claims",
  technical_support: "Technical support",
  cancel: "Order cancellations",
  address_change: "Address changes",
  product_question: "Product questions",
  other: "General inquiries",
};

// Minimum tickets before we consider a category "ready" to suggest
const MIN_TICKETS_FOR_SUGGESTION = 5;
const READY_CONFIDENCE_THRESHOLD = 0.78;
const LEARNING_CONFIDENCE_THRESHOLD = 0.65;

// GET — aggregate confidence per intent from agent_logs (last 30 days)
export async function GET() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = createServiceClient();
    if (!serviceClient) return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });

    const scope = await resolveAuthScope(serviceClient, { clerkUserId: userId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ categories: [], auto_send_intents: [] });
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch auto_send_intents from agent_automation
    let autoSendIntents: string[] = [];
    {
      let q = serviceClient.from("agent_automation").select("auto_send_intents");
      if (scope.workspaceId) {
        q = q.eq("workspace_id", scope.workspaceId).order("updated_at", { ascending: false }).limit(1);
      } else {
        q = q.eq("user_id", scope.supabaseUserId);
      }
      const { data } = await q.maybeSingle();
      autoSendIntents = Array.isArray(data?.auto_send_intents) ? data.auto_send_intents : [];
    }

    // Read draft_created logs that include intent
    const { data: logs, error } = await serviceClient
      .from("agent_logs")
      .select("step_detail, created_at")
      .eq("step_name", "draft_created")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) throw error;

    // Aggregate per intent
    const intentStats = new Map<string, { confidences: number[]; count: number }>();

    for (const log of logs ?? []) {
      let detail: Record<string, unknown>;
      try {
        detail = typeof log.step_detail === "string" ? JSON.parse(log.step_detail) : log.step_detail ?? {};
      } catch {
        continue;
      }

      const intent = typeof detail.intent === "string" ? detail.intent : null;
      const confidence = typeof detail.confidence === "number" ? detail.confidence : null;
      if (!intent || confidence === null || intent === "thanks") continue;

      if (!intentStats.has(intent)) intentStats.set(intent, { confidences: [], count: 0 });
      const s = intentStats.get(intent)!;
      s.confidences.push(confidence);
      s.count++;
    }

    const categories = Object.entries(INTENT_LABELS)
      .filter(([intent]) => intent !== "other")
      .map(([intent, label]) => {
        const stats = intentStats.get(intent);
        const avgConfidence = stats && stats.confidences.length > 0
          ? stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length
          : null;
        const ticketCount = stats?.count ?? 0;

        let readiness: "ready" | "learning" | "insufficient_data" | "not_ready";
        let sonaRecommends = false;

        if (ticketCount < MIN_TICKETS_FOR_SUGGESTION) {
          readiness = "insufficient_data";
        } else if (avgConfidence !== null && avgConfidence >= READY_CONFIDENCE_THRESHOLD) {
          readiness = "ready";
          sonaRecommends = true;
        } else if (avgConfidence !== null && avgConfidence >= LEARNING_CONFIDENCE_THRESHOLD) {
          readiness = "learning";
        } else {
          readiness = "not_ready";
        }

        return {
          intent,
          label,
          avg_confidence: avgConfidence !== null ? Math.round(avgConfidence * 100) / 100 : null,
          ticket_count: ticketCount,
          readiness,
          sona_recommends: sonaRecommends,
          auto_send_enabled: autoSendIntents.includes(intent),
        };
      })
      .sort((a, b) => {
        // Sort: ready first, then learning, then insufficient_data, then not_ready
        const order = { ready: 0, learning: 1, insufficient_data: 2, not_ready: 3 };
        return order[a.readiness] - order[b.readiness];
      });

    return NextResponse.json({ categories, auto_send_intents: autoSendIntents });
  } catch (err) {
    console.error("[api/settings/autopilot-readiness] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PUT — update auto_send_intents for this shop
export async function PUT(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const intents: string[] = Array.isArray(body.auto_send_intents) ? body.auto_send_intents : [];

    const serviceClient = createServiceClient();
    if (!serviceClient) return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });

    const scope = await resolveAuthScope(serviceClient, { clerkUserId: userId, orgId });

    const payload = {
      auto_send_intents: intents,
      updated_at: new Date().toISOString(),
    };

    if (scope.workspaceId) {
      const { data: existing } = await serviceClient
        .from("agent_automation")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.user_id) {
        await serviceClient
          .from("agent_automation")
          .update({ ...payload, workspace_id: scope.workspaceId })
          .eq("user_id", existing.user_id);
      } else {
        await serviceClient
          .from("agent_automation")
          .insert({ ...payload, user_id: scope.supabaseUserId, workspace_id: scope.workspaceId });
      }
    } else {
      await serviceClient
        .from("agent_automation")
        .upsert(
          { ...payload, user_id: scope.supabaseUserId, workspace_id: null },
          { onConflict: "user_id" },
        );
    }

    return NextResponse.json({ auto_send_intents: intents });
  } catch (err) {
    console.error("[api/settings/autopilot-readiness] PUT error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
