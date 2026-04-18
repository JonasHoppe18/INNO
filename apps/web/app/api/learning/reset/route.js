import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const mailboxId =
    typeof body?.mailbox_id === "string" ? body.mailbox_id.trim() : null;

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.supabaseUserId) {
    return NextResponse.json({ error: "Supabase profile was not found." }, { status: 404 });
  }

  // Resolve shop_id for the current user/workspace
  let shopQuery = applyScope(
    serviceClient.from("mail_accounts").select("shop_id").not("shop_id", "is", null).limit(1),
    scope
  );
  const { data: accountRow } = await shopQuery.maybeSingle();
  const shopId = accountRow?.shop_id || null;

  if (!shopId) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const { error, count } = await serviceClient
    .from("agent_knowledge")
    .delete({ count: "exact" })
    .eq("shop_id", shopId)
    .eq("source_type", "ticket")
    .eq("source_provider", "sent_reply");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
