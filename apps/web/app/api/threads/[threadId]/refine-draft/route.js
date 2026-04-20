import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

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
const INTERNAL_AGENT_SECRET = process.env.INTERNAL_AGENT_SECRET || "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const currentDraft = String(body?.currentDraft || "").trim();
  const userPrompt = String(body?.userPrompt || "").trim();

  if (!currentDraft || !userPrompt) {
    return NextResponse.json(
      { error: "currentDraft and userPrompt are required." },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Workspace scope lookup failed." },
      { status: 500 }
    );
  }

  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, subject, mailbox_id, user_id, workspace_id")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const { data: mailbox, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select("shop_id")
    .eq("id", thread.mailbox_id)
    .maybeSingle();
  if (mailboxError || !mailbox?.shop_id) {
    return NextResponse.json(
      { error: "This mailbox is not connected to a Shopify shop." },
      { status: 400 }
    );
  }

  const endpoint = `${SUPABASE_URL}/functions/v1/refine-draft`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(INTERNAL_AGENT_SECRET ? { "x-internal-secret": INTERNAL_AGENT_SECRET } : {}),
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      shopId: mailbox.shop_id,
      workspaceId: thread.workspace_id || null,
      userId: thread.user_id || null,
      threadSubject: thread.subject || "",
      currentDraft,
      userPrompt,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.error || `Refinement failed with status ${response.status}.` },
      { status: response.status }
    );
  }

  return NextResponse.json({ ok: true, draft: payload.draft }, { status: 200 });
}
