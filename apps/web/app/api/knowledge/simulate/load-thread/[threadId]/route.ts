// GET /api/knowledge/simulate/load-thread/[threadId]
//
// Returns the conversation history for a thread as a simulator-friendly array
// so the admin can pre-populate the simulator with a real ticket and continue
// hypothetical turns from there.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

export async function GET(_request: Request, { params }: { params: { threadId: string } }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const threadId = String(params?.threadId || "").trim();
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  let shops: Array<{ id: string }>;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  const shopIds = new Set(shops.map((s) => s.id));

  const { data: thread, error: threadErr } = await supabase
    .from("mail_threads")
    .select("id, subject, mailbox_id, customer_email")
    .eq("id", threadId)
    .maybeSingle();
  if (threadErr || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  // Verify the thread belongs to one of the user's shops via mailbox.
  const { data: mailbox } = await supabase
    .from("mail_accounts")
    .select("shop_id")
    .eq("id", thread.mailbox_id)
    .maybeSingle();
  const shopId = mailbox?.shop_id as string | undefined;
  if (!shopId || !shopIds.has(shopId)) {
    return NextResponse.json({ error: "Thread is outside your scope." }, { status: 403 });
  }

  const { data: rows, error: msgErr } = await supabase
    .from("mail_messages")
    .select("id, from_me, clean_body_text, body_text, snippet, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const conversation = (rows || [])
    .map((m: any) => ({
      role: m.from_me ? "agent" : "customer",
      text: String(m.clean_body_text || m.body_text || m.snippet || "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((t: any) => t.text.length > 0);

  // Latest customer message_id — used when running the simulator's first turn
  // in real thread_id mode (so the pipeline uses the same path as production).
  const latestCustomerMessageId =
    [...(rows || [])]
      .reverse()
      .find((m: any) => !m.from_me)?.id || null;

  // Also surface the latest customer message's from_email as a fallback when
  // the thread-level customer_email isn't set (older threads sometimes lack it).
  let fallbackEmail: string | null = null;
  if (!thread.customer_email) {
    const { data: latestInbound } = await supabase
      .from("mail_messages")
      .select("from_email, extracted_customer_email")
      .eq("thread_id", threadId)
      .eq("from_me", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    fallbackEmail =
      (latestInbound?.extracted_customer_email as string) ||
      (latestInbound?.from_email as string) ||
      null;
  }

  return NextResponse.json({
    thread_id: threadId,
    shop_id: shopId,
    subject: thread.subject || null,
    customer_email: thread.customer_email || fallbackEmail || null,
    latest_customer_message_id: latestCustomerMessageId,
    conversation,
  });
}
