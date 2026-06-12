// List recent mail_threads for the user's shops — used by the snippet-preview
// ticket picker. Returns subject + customer email + a short preview of the
// latest customer message so the admin can pick a relevant ticket to test
// their new/edited snippet against.
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

export async function GET(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 30);
  const limit = Math.min(Math.max(requestedLimit, 5), 100);
  // Optional server-side search so the picker can find ANY ticket — not just
  // the most recent `limit`. Strip characters that would break the PostgREST
  // `or` filter syntax; keep it a simple case-insensitive contains match.
  const rawSearch = String(url.searchParams.get("search") || "").trim();
  const search = rawSearch.replace(/[,()%*\\]/g, " ").trim().slice(0, 120);

  let shops: Array<{ id: string }>;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  const shopIds = shops.map((s) => s.id).filter(Boolean);
  if (!shopIds.length) {
    return NextResponse.json({ threads: [] });
  }

  // Resolve mailbox ids for the scoped shops so we can filter threads.
  const { data: mailboxes, error: mbErr } = await supabase
    .from("mail_accounts")
    .select("id, shop_id")
    .in("shop_id", shopIds);
  if (mbErr) {
    return NextResponse.json({ error: mbErr.message }, { status: 500 });
  }
  const mailboxIds = (mailboxes || []).map((m: any) => m.id).filter(Boolean);
  if (!mailboxIds.length) {
    return NextResponse.json({ threads: [] });
  }

  let threadQuery = supabase
    .from("mail_threads")
    .select("id, subject, snippet, last_message_at, customer_email, mailbox_id")
    .in("mailbox_id", mailboxIds);
  if (search) {
    threadQuery = threadQuery.or(
      `subject.ilike.%${search}%,snippet.ilike.%${search}%,customer_email.ilike.%${search}%`,
    );
  }
  const { data: threads, error: thErr } = await threadQuery
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (thErr) {
    return NextResponse.json({ error: thErr.message }, { status: 500 });
  }

  const shopIdByMailbox = new Map(
    (mailboxes || []).map((m: any) => [m.id, m.shop_id]),
  );

  return NextResponse.json({
    threads: (threads || []).map((t: any) => ({
      thread_id: t.id,
      subject: t.subject || "(no subject)",
      preview: (t.snippet || "").replace(/\s+/g, " ").trim().slice(0, 140),
      customer_email: t.customer_email || null,
      last_message_at: t.last_message_at || null,
      shop_id: shopIdByMailbox.get(t.mailbox_id) || null,
    })),
  });
}
