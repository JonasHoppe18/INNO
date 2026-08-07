import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import {
  dispatchDueCustomerSatisfactionSurveys,
  resolveCustomerSatisfactionOrigin,
  scheduleRecentResolvedCustomerSatisfactionSurveys,
} from "@/lib/server/customer-satisfaction-surveys";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

const { url: SUPABASE_URL, serviceKey: SERVICE_KEY } = resolveSupabaseServerConfig();
const WORKER_SECRET = String(process.env.CSAT_WORKER_SECRET || process.env.CRON_SECRET || "").trim();

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function hasWorkerSecret(request) {
  const provided = String(
    request.headers.get("x-csat-worker-secret") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "",
  ).trim();
  return Boolean(WORKER_SECRET) && provided === WORKER_SECRET;
}

export async function POST(request) {
  const client = serviceClient();
  if (!client) return NextResponse.json({ error: "CSAT service is unavailable." }, { status: 503 });

  let body = {};
  try { body = await request.json(); } catch { /* empty body is valid for a full worker run */ }

  let workspaceId = String(body?.workspaceId || "").trim() || null;
  if (!hasWorkerSecret(request)) {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const scope = await resolveAuthScope(client, { clerkUserId, orgId });
    if (!scope?.workspaceId) return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    workspaceId = scope.workspaceId;
  }

  try {
    const origin = resolveCustomerSatisfactionOrigin(request);
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const scheduled = await scheduleRecentResolvedCustomerSatisfactionSurveys(client, { workspaceId, since });
    const dispatched = await dispatchDueCustomerSatisfactionSurveys(client, { workspaceId, origin });
    return NextResponse.json({ scheduled: scheduled.length, dispatched }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not dispatch CSAT surveys." }, { status: 500 });
  }
}
