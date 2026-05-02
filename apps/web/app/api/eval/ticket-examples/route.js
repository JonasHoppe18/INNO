import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";

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

export async function GET(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  let shops;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err) {
    return NextResponse.json({ error: `Shop lookup failed: ${err.message}` }, { status: 500 });
  }

  const shopIds = shops.map((shop) => shop.id).filter(Boolean);
  if (shopIds.length === 0) {
    return NextResponse.json({ examples: [] });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || "120"), 200);

  const { data, error } = await supabase
    .from("ticket_examples")
    .select("id, external_ticket_id, source_provider, subject, customer_msg, agent_reply, intent, language, csat_score, tags, imported_at")
    .in("shop_id", shopIds)
    .order("imported_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const examples = (data ?? [])
    .filter((row) => String(row.customer_msg || "").trim() && String(row.agent_reply || "").trim())
    .map((row) => ({
      id: `ticket-example-${row.id}`,
      ticket_example_id: row.id,
      external_ticket_id: row.external_ticket_id,
      source_provider: row.source_provider,
      subject: row.subject || "(no subject)",
      customer_body: String(row.customer_msg || "").slice(0, 3000),
      human_reply: String(row.agent_reply || "").slice(0, 3000),
      intent: row.intent,
      language: row.language,
      csat_score: row.csat_score,
      tags: row.tags ?? [],
      created_at: row.imported_at,
    }));

  return NextResponse.json({ examples, fetched: examples.length, requested: limit });
}
