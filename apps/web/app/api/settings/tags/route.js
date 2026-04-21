import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isValidColor(value) {
  return HEX_COLOR_RE.test(String(value || ""));
}

async function resolveWorkspaceId(serviceClient, clerkUserId, orgId) {
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope?.workspaceId) throw Object.assign(new Error("Workspace ikke fundet."), { status: 404 });
  return scope.workspaceId;
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  let workspaceId;
  try {
    workspaceId = await resolveWorkspaceId(serviceClient, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { data, error } = await serviceClient
    .from("workspace_tags")
    .select("id, name, color, category, is_active, created_at")
    .eq("workspace_id", workspaceId)
    .order("category", { nullsFirst: true })
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tags: data ?? [] });
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const name = asString(body?.name);
  if (!name) return NextResponse.json({ error: "Navn er påkrævet." }, { status: 400 });
  if (name.length > 50) return NextResponse.json({ error: "Navn må maks. være 50 tegn." }, { status: 400 });

  const color = asString(body?.color, "#6366f1");
  if (!isValidColor(color)) return NextResponse.json({ error: "Ugyldig farve — brug hex-format (#rrggbb)." }, { status: 400 });

  const category = asString(body?.category) || null;

  let workspaceId;
  try {
    workspaceId = await resolveWorkspaceId(serviceClient, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { data, error } = await serviceClient
    .from("workspace_tags")
    .insert({ workspace_id: workspaceId, name, color, category, is_active: true })
    .select("id, name, color, category, is_active, created_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Et tag med dette navn eksisterer allerede." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tag: data }, { status: 201 });
}

export async function PUT(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tagId = asString(body?.id);
  if (!tagId) return NextResponse.json({ error: "id er påkrævet." }, { status: 400 });

  let workspaceId;
  try {
    workspaceId = await resolveWorkspaceId(serviceClient, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const updates = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Navn må ikke være tomt." }, { status: 400 });
    if (name.length > 50) return NextResponse.json({ error: "Navn må maks. være 50 tegn." }, { status: 400 });
    updates.name = name;
  }
  if (typeof body.color === "string") {
    if (!isValidColor(body.color)) return NextResponse.json({ error: "Ugyldig farve." }, { status: 400 });
    updates.color = body.color;
  }
  if ("category" in body) {
    updates.category = asString(body.category) || null;
  }
  if (typeof body.is_active === "boolean") {
    updates.is_active = body.is_active;
  }

  if (!Object.keys(updates).length) return NextResponse.json({ error: "Ingen ændringer." }, { status: 400 });

  const { data, error } = await serviceClient
    .from("workspace_tags")
    .update(updates)
    .eq("id", tagId)
    .eq("workspace_id", workspaceId)
    .select("id, name, color, category, is_active, created_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Et tag med dette navn eksisterer allerede." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Tag ikke fundet." }, { status: 404 });

  return NextResponse.json({ tag: data });
}

export async function DELETE(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tagId = asString(body?.id);
  if (!tagId) return NextResponse.json({ error: "id er påkrævet." }, { status: 400 });

  let workspaceId;
  try {
    workspaceId = await resolveWorkspaceId(serviceClient, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  // Tjek om tag er i brug — deaktiver i så fald i stedet for at slette
  const { count } = await serviceClient
    .from("thread_tag_assignments")
    .select("id", { count: "exact", head: true })
    .eq("tag_id", tagId);

  if (count > 0) {
    const { data, error } = await serviceClient
      .from("workspace_tags")
      .update({ is_active: false })
      .eq("id", tagId)
      .eq("workspace_id", workspaceId)
      .select("id, name, color, category, is_active, created_at")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tag: data, deactivated: true });
  }

  const { error } = await serviceClient
    .from("workspace_tags")
    .delete()
    .eq("id", tagId)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
