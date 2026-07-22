import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { CORE_ACTIONS } from "@/lib/action-modes";
import { buildManualActionInsert } from "@/lib/inbox/manual-actions";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const asString = (value) => (typeof value === "string" ? value.trim() : "");

function actionLabel(actionType) {
  return CORE_ACTIONS.find((action) => action.type === actionType)?.label || actionType;
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = asString(params?.threadId);
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // validated below
  }
  const actionType = asString(body?.actionType);
  const order = body?.order && typeof body.order === "object" ? body.order : null;
  const formPayload = body?.formPayload && typeof body.formPayload === "object" ? body.formPayload : {};

  const built = buildManualActionInsert({ actionType, order, formPayload });
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId) {
    return NextResponse.json(
      { error: "Manual actions require a workspace-scoped account." },
      { status: 400 }
    );
  }
  if (!scope?.supabaseUserId) {
    return NextResponse.json(
      { error: "Manual actions require a resolvable user account." },
      { status: 400 }
    );
  }

  let threadQuery = serviceClient.from("mail_threads").select("id").eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) {
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }
  if (!thread?.id) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await serviceClient
    .from("thread_actions")
    .insert({
      workspace_id: scope.workspaceId,
      user_id: scope.supabaseUserId,
      thread_id: thread.id,
      action_type: built.insert.action_type,
      action_key: `manual_${built.insert.action_type}_${thread.id}_${Date.now()}`,
      status: "pending",
      source: "manual",
      detail: `Manually triggered by agent: ${actionLabel(actionType)}`,
      payload: built.insert.payload,
      order_id: built.insert.order_id,
      order_number: built.insert.order_number,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, action_type, detail, payload, created_at")
    .maybeSingle();
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      action: {
        id: String(inserted.id),
        actionType: inserted.action_type,
        detail: inserted.detail,
        payload: inserted.payload,
        createdAt: inserted.created_at,
      },
    },
    { status: 201 }
  );
}
