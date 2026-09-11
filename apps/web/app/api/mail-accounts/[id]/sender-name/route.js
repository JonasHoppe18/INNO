import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  mailboxMatchesScope,
  validateMailboxSenderName,
} from "@/lib/server/mailbox-sender-name";

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

export async function PATCH(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const mailboxId = String(params?.id || "").trim();
  if (!mailboxId) {
    return NextResponse.json({ error: "Mailbox id is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 },
    );
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "No workspace or user scope found." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const validation = validateMailboxSenderName(body?.sender_name ?? body?.from_name);
  if (validation.error) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  let mailboxQuery = serviceClient
    .from("mail_accounts")
    .select("id, workspace_id, user_id, from_name")
    .eq("id", mailboxId);
  mailboxQuery = applyScope(mailboxQuery, scope);
  const { data: mailbox, error: mailboxError } = await mailboxQuery.maybeSingle();
  if (mailboxError || !mailbox || !mailboxMatchesScope(mailbox, scope)) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }

  let updateQuery = serviceClient
    .from("mail_accounts")
    .update({
      from_name: validation.value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mailboxId);
  updateQuery = applyScope(updateQuery, scope);
  const { data: updated, error: updateError } = await updateQuery
    .select("id, from_name")
    .maybeSingle();
  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError?.message || "Mailbox not found." },
      { status: updateError ? 500 : 404 },
    );
  }

  return NextResponse.json(
    { id: updated.id, sender_name: updated.from_name || null },
    { status: 200 },
  );
}
