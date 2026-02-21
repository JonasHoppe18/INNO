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

  let mailboxQuery = applyScope(
    serviceClient.from("mail_accounts").select("id"),
    scope
  );

  if (mailboxId) {
    mailboxQuery = mailboxQuery.eq("id", mailboxId);
  }

  const { data: mailboxes, error: mailboxError } = await mailboxQuery;
  if (mailboxError) {
    return NextResponse.json({ error: mailboxError.message }, { status: 500 });
  }

  const scopedMailboxIds = (mailboxes ?? []).map((row) => row.id).filter(Boolean);
  if (!scopedMailboxIds.length) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  let query = serviceClient
    .from("mail_learning_profiles")
    .update({ style_rules: null, updated_at: new Date().toISOString() })
    .eq("user_id", scope.supabaseUserId)
    .in("mailbox_id", scopedMailboxIds);

  const { error, data } = await query.select("mailbox_id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: (data ?? []).length });
}
