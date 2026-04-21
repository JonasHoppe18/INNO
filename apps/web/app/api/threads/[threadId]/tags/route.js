import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId) {
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    throw Object.assign(new Error("Auth scope ikke fundet."), { status: 404 });
  }
  const { data: thread, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, workspace_id")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!thread?.id) throw Object.assign(new Error("Tråd ikke fundet."), { status: 404 });
  return { scope, thread };
}

export async function GET(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId er påkrævet." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  try {
    await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { data, error } = await serviceClient
    .from("thread_tag_assignments")
    .select("id, source, assigned_at, workspace_tags(id, name, color, category)")
    .eq("thread_id", threadId)
    .order("assigned_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tags = (data ?? []).map((row) => ({
    assignmentId: row.id,
    source: row.source,
    assignedAt: row.assigned_at,
    ...row.workspace_tags,
  }));

  return NextResponse.json({ tags });
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId er påkrævet." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tagId = asString(body?.tag_id);
  if (!tagId) return NextResponse.json({ error: "tag_id er påkrævet." }, { status: 400 });

  let scope, thread;
  try {
    ({ scope, thread } = await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  // Verificer at tag tilhører samme workspace
  const workspaceId = scope?.workspaceId ?? thread.workspace_id;
  const { data: tag } = await serviceClient
    .from("workspace_tags")
    .select("id")
    .eq("id", tagId)
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .maybeSingle();

  if (!tag) return NextResponse.json({ error: "Tag ikke fundet eller ikke aktivt." }, { status: 404 });

  const { data, error } = await serviceClient
    .from("thread_tag_assignments")
    .upsert({ thread_id: threadId, tag_id: tagId, source: "manual" }, { onConflict: "thread_id,tag_id" })
    .select("id, source, assigned_at, workspace_tags(id, name, color, category)")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = {
    assignmentId: data.id,
    source: data.source,
    assignedAt: data.assigned_at,
    ...data.workspace_tags,
  };

  return NextResponse.json({ tag: result }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId er påkrævet." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tagId = asString(body?.tag_id);
  if (!tagId) return NextResponse.json({ error: "tag_id er påkrævet." }, { status: 400 });

  try {
    await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { error } = await serviceClient
    .from("thread_tag_assignments")
    .delete()
    .eq("thread_id", threadId)
    .eq("tag_id", tagId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
