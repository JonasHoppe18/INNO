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
  const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
  const mailboxId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!provider && !mailboxId) {
    return NextResponse.json(
      { error: "provider or id is required." },
      { status: 400 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Auth scope lookup failed.",
        debug: {
          clerkUserId,
          supabaseUrlHost: SUPABASE_BASE_URL ? new URL(SUPABASE_BASE_URL).host : null,
        },
      },
      { status: 500 }
    );
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "No workspace or user scope found." }, { status: 403 });
  }

  let query = serviceClient.from("mail_accounts").delete();
  query = applyScope(query, scope);
  const { error } = mailboxId
    ? await query.eq("id", mailboxId)
    : await query.eq("provider", provider);

  if (error) {
    const isFkError = /mail_threads_mailbox_id_fkey/i.test(error.message || "");
    if (isFkError) {
      const updateQuery = serviceClient
        .from("mail_accounts")
        .update({
          status: "disconnected",
          updated_at: new Date().toISOString(),
        });
      const scopedUpdateQuery = applyScope(updateQuery, scope);
      const { error: updateError } = mailboxId
        ? await scopedUpdateQuery.eq("id", mailboxId)
        : await scopedUpdateQuery.eq("provider", provider);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, softDeleted: true }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
