import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function normalizeZendeskUrl(input = "") {
  const trimmed = String(input || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function encodeToBytea(value) {
  const token = String(value || "").trim();
  if (!token) return null;
  return `\\x${Buffer.from(token, "utf8").toString("hex")}`;
}

async function resolveRequestContext() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { error: "You must be signed in to access Zendesk.", status: 401 };
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return { error: "Supabase configuration is missing.", status: 500 };
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return { error: "No workspace/user scope found.", status: 400 };
    }
    return { serviceClient, scope };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Workspace scope lookup failed.",
      status: 500,
    };
  }
}

function scopedZendeskQuery(serviceClient, scope, selection) {
  let query = serviceClient
    .from("integrations")
    .select(selection)
    .eq("provider", "zendesk")
    .order("updated_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope);
  return query;
}

export async function GET() {
  const context = await resolveRequestContext();
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { data, error } = await scopedZendeskQuery(
    context.serviceClient,
    context.scope,
    "id, provider, config, is_active, created_at, updated_at, credentials_enc",
  ).maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ integration: null }, { status: 200 });
  }

  return NextResponse.json({
    integration: {
      id: data.id,
      provider: data.provider,
      config: data.config || {},
      is_active: Boolean(data.is_active),
      created_at: data.created_at,
      updated_at: data.updated_at,
      has_api_token: Boolean(data.credentials_enc),
    },
  });
}

export async function PATCH(request) {
  const context = await resolveRequestContext();
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = await request.json().catch(() => ({}));
  const domain = normalizeZendeskUrl(body?.domain);
  const email = String(body?.email || "").trim();
  const apiToken = String(body?.api_token || "").trim();

  if (!domain || !email) {
    return NextResponse.json(
      { error: "Zendesk URL and agent email are required." },
      { status: 400 },
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid agent email." }, { status: 400 });
  }

  const { data: current, error: currentError } = await scopedZendeskQuery(
    context.serviceClient,
    context.scope,
    "id, config, credentials_enc",
  ).maybeSingle();

  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }
  if (!current?.id) {
    return NextResponse.json({ error: "Zendesk integration not found." }, { status: 404 });
  }
  if (!apiToken && !current.credentials_enc) {
    return NextResponse.json({ error: "Zendesk API token is required." }, { status: 400 });
  }

  const updatePayload = {
    config: {
      ...(current.config || {}),
      domain,
      email,
    },
    updated_at: new Date().toISOString(),
    ...(apiToken ? { credentials_enc: encodeToBytea(apiToken) } : {}),
  };

  let updateQuery = context.serviceClient
    .from("integrations")
    .update(updatePayload)
    .eq("id", current.id)
    .eq("provider", "zendesk");
  updateQuery = applyScope(updateQuery, context.scope);
  const { data: updated, error: updateError } = await updateQuery
    .select("id, provider, config, is_active, created_at, updated_at, credentials_enc")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Zendesk integration could not be updated." }, { status: 404 });
  }

  return NextResponse.json({
    integration: {
      id: updated.id,
      provider: updated.provider,
      config: updated.config || {},
      is_active: Boolean(updated.is_active),
      created_at: updated.created_at,
      updated_at: updated.updated_at,
      has_api_token: Boolean(updated.credentials_enc),
    },
  });
}

export async function DELETE() {
  const context = await resolveRequestContext();
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  let deleteQuery = context.serviceClient
    .from("integrations")
    .delete()
    .eq("provider", "zendesk");
  deleteQuery = applyScope(deleteQuery, context.scope);
  const { data, error } = await deleteQuery.select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { success: true, removed: Array.isArray(data) ? data.length : 0 },
    { status: 200 }
  );
}
