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
const INTERNAL_SECRET =
  process.env.INTERNAL_AGENT_SECRET ||
  process.env.GMAIL_POLL_SECRET ||
  process.env.OUTLOOK_POLL_SECRET ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function triggerFunction(functionName, supabaseUserId) {
  const endpoint = `${SUPABASE_URL}/functions/v1/${functionName}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({ userId: supabaseUserId, userLimit: 1 }),
  });
  const payloadText = await res.text();
  let payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = payloadText;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: payload || "Unknown error" };
  }
  return { ok: true, status: res.status, data: payload };
}

export async function POST() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  if (!INTERNAL_SECRET) {
    return NextResponse.json(
      { error: "Internal poll secret is missing." },
      { status: 500 }
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service client could not be created." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let usersQuery = applyScope(
    serviceClient.from("mail_accounts").select("user_id"),
    scope
  )
    .not("user_id", "is", null)
    .in("provider", ["gmail", "outlook"]);

  const { data: accountRows, error: accountError } = await usersQuery;
  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }

  const userIds = Array.from(
    new Set((Array.isArray(accountRows) ? accountRows : []).map((row) => row?.user_id).filter(Boolean))
  );
  if (!userIds.length && scope?.supabaseUserId) {
    userIds.push(scope.supabaseUserId);
  }
  if (!userIds.length) {
    return NextResponse.json({ error: "No eligible mailbox owners found to sync." }, { status: 404 });
  }

  const syncResults = await Promise.all(
    userIds.map(async (supabaseUserId) => {
      const [gmailResult, outlookResult] = await Promise.all([
        triggerFunction("gmail-poll", supabaseUserId),
        triggerFunction("outlook-poll", supabaseUserId),
      ]);
      return {
        user_id: supabaseUserId,
        gmail: gmailResult,
        outlook: outlookResult,
      };
    })
  );

  const ok = syncResults.some((row) => row.gmail?.ok || row.outlook?.ok);
  return NextResponse.json(
    {
      success: ok,
      results: syncResults,
    },
    { status: ok ? 200 : 500 }
  );
}
