import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  AUTOPILOT_READINESS_POLICY,
  evaluateAutopilotReadiness,
  validateRequestedAutoSendIntents,
} from "@/lib/server/autopilot-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_BASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

const MAX_EVIDENCE_ROWS = 5000;
const GENERATION_LOOKBACK_GRACE_DAYS = 7;

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function loadStoredAutoSendIntents(
  serviceClient: ServiceClient,
  scope: { workspaceId: string | null; supabaseUserId: string | null },
) {
  let query = serviceClient.from("agent_automation").select("auto_send_intents");
  if (scope.workspaceId) {
    query = query
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1);
  } else if (scope.supabaseUserId) {
    query = query.eq("user_id", scope.supabaseUserId).limit(1);
  } else {
    return [];
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { auto_send_intents?: unknown } | null;
  return Array.isArray(row?.auto_send_intents) ? row.auto_send_intents : [];
}

async function loadHumanOutcomeEvidence(
  serviceClient: ServiceClient,
  workspaceId: string | null,
) {
  if (!workspaceId) {
    return { sentEvents: [], generatedEvents: [], generationRows: [] };
  }

  const evidenceSince = daysAgoIso(AUTOPILOT_READINESS_POLICY.evidenceWindowDays);
  const generationSince = daysAgoIso(
    AUTOPILOT_READINESS_POLICY.evidenceWindowDays + GENERATION_LOOKBACK_GRACE_DAYS,
  );

  // Every service-role read is explicitly workspace-scoped. The sent subtype
  // is the only event that carries the authoritative final human edit outcome;
  // the umbrella draft_sent event is intentionally excluded.
  const [sentResult, generatedResult, generationResult] = await Promise.all([
    serviceClient
      .from("draft_feedback_events")
      .select("id, draft_id, generation_id, edit_classification, payload_json, created_at")
      .eq("workspace_id", workspaceId)
      .in("event_type", ["draft_sent_without_edit", "draft_sent_with_edit"])
      .not("edit_classification", "is", null)
      .gte("created_at", evidenceSince)
      .order("created_at", { ascending: false })
      .limit(MAX_EVIDENCE_ROWS),
    serviceClient
      .from("draft_feedback_events")
      .select("generation_id, draft_id, payload_json, created_at")
      .eq("workspace_id", workspaceId)
      .eq("event_type", "draft_generated")
      .gte("created_at", generationSince)
      .order("created_at", { ascending: false })
      .limit(MAX_EVIDENCE_ROWS),
    serviceClient
      .from("draft_generations")
      .select(
        "id, draft_id, planner_output_json, resolution_plan_json, case_state_json, created_at",
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", generationSince)
      .order("created_at", { ascending: false })
      .limit(MAX_EVIDENCE_ROWS),
  ]);

  if (sentResult.error) throw new Error(sentResult.error.message);
  if (generatedResult.error) throw new Error(generatedResult.error.message);
  if (generationResult.error) throw new Error(generationResult.error.message);

  return {
    sentEvents: sentResult.data ?? [],
    generatedEvents: generatedResult.data ?? [],
    generationRows: generationResult.data ?? [],
  };
}

async function loadReadiness(
  serviceClient: ServiceClient,
  scope: { workspaceId: string | null; supabaseUserId: string | null },
) {
  const [storedAutoSendIntents, evidence] = await Promise.all([
    loadStoredAutoSendIntents(serviceClient, scope),
    loadHumanOutcomeEvidence(serviceClient, scope.workspaceId),
  ]);
  return evaluateAutopilotReadiness({
    ...evidence,
    storedAutoSendIntents,
  });
}

async function persistAutoSendIntents(
  serviceClient: ServiceClient,
  scope: { workspaceId: string | null; supabaseUserId: string | null },
  intents: string[],
) {
  const payload = {
    auto_send_intents: intents,
    updated_at: new Date().toISOString(),
  };

  if (scope.workspaceId) {
    const { data: existing, error: lookupError } = await serviceClient
      .from("agent_automation")
      .select("user_id")
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    const existingRow = existing as { user_id?: string } | null;
    if (existingRow?.user_id) {
      const { error } = await serviceClient
        .from("agent_automation")
        .update({ ...payload, workspace_id: scope.workspaceId })
        .eq("user_id", existingRow.user_id)
        .eq("workspace_id", scope.workspaceId);
      if (error) throw new Error(error.message);
      return;
    }

    if (!scope.supabaseUserId) {
      throw new Error("No Supabase user is available for this workspace.");
    }
    const { error } = await serviceClient.from("agent_automation").insert({
      ...payload,
      user_id: scope.supabaseUserId,
      workspace_id: scope.workspaceId,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (!scope.supabaseUserId) {
    throw new Error("No authenticated workspace or user scope is available.");
  }
  const { error } = await serviceClient
    .from("agent_automation")
    .upsert(
      { ...payload, user_id: scope.supabaseUserId, workspace_id: null },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

// GET — workspace-scoped human send outcomes from the last 90 days.
export async function GET() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId: userId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ categories: [], auto_send_intents: [] });
    }

    const result = await loadReadiness(serviceClient, scope);
    return NextResponse.json({
      categories: result.categories,
      // Stored legacy choices that no longer meet the evidence gate are not
      // reported as enabled. A subsequent PUT persists only this effective set.
      auto_send_intents: result.effectiveAutoSendIntents,
      blocked_auto_send_intents: result.blockedStoredIntents,
      evidence: result.evidence,
    });
  } catch (err) {
    console.error("[api/settings/autopilot-readiness] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PUT — fail closed: only intents that currently pass the same human-outcome
// policy used by GET may be persisted. Clearing the list is always allowed.
export async function PUT(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.auto_send_intents)) {
      return NextResponse.json(
        { error: "auto_send_intents must be an array." },
        { status: 400 },
      );
    }

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId: userId, orgId });
    const readiness = await loadReadiness(serviceClient, scope);
    const validation = validateRequestedAutoSendIntents(
      body.auto_send_intents,
      readiness.readyIntents,
    );

    if (validation.invalidIntents.length > 0) {
      return NextResponse.json(
        {
          error: "One or more ticket types are invalid.",
          invalid_intents: validation.invalidIntents,
        },
        { status: 400 },
      );
    }
    if (validation.blockedIntents.length > 0) {
      return NextResponse.json(
        {
          error: "Autopilot cannot be enabled without sufficient recent human outcome evidence.",
          blocked_intents: validation.blockedIntents,
          evidence_policy: readiness.evidence.policy,
        },
        { status: 422 },
      );
    }

    await persistAutoSendIntents(serviceClient, scope, validation.intents);
    return NextResponse.json({ auto_send_intents: validation.intents });
  } catch (err) {
    console.error("[api/settings/autopilot-readiness] PUT error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
