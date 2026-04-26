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
    throw Object.assign(new Error("Auth scope not found."), { status: 404 });
  }
  const { data: thread, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, workspace_id, classification_key, issue_summary, solution_summary, detected_product_id")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!thread?.id) throw Object.assign(new Error("Thread not found."), { status: 404 });
  return { scope, thread };
}

export async function GET(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });

  let scope, thread;
  try {
    ({ scope, thread } = await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  let detected_product = null;
  if (thread.detected_product_id) {
    const { data: product } = await serviceClient
      .from("shop_products")
      .select("id, title")
      .eq("id", thread.detected_product_id)
      .maybeSingle();
    if (product) detected_product = { id: product.id, title: product.title };
  }

  const workspaceId = scope?.workspaceId ?? thread.workspace_id;
  const { data: shop } = await serviceClient
    .from("shops")
    .select("id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let available_products = [];
  if (shop?.id) {
    const { data: products } = await serviceClient
      .from("shop_products")
      .select("id, title")
      .eq("shop_ref_id", shop.id)
      .order("title")
      .limit(100);
    available_products = products ?? [];
  }

  return NextResponse.json({
    issue_summary: thread.issue_summary ?? null,
    solution_summary: thread.solution_summary ?? null,
    classification_key: thread.classification_key ?? null,
    detected_product,
    available_products,
  });
}

const ALLOWED_PATCH_FIELDS = new Set(["issue_summary", "solution_summary", "detected_product_id"]);

export async function PATCH(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) {
      updates[key] = value === "" ? null : value;
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { error } = await serviceClient
    .from("mail_threads")
    .update(updates)
    .eq("id", threadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ...updates });
}
