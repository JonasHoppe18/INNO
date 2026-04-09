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

export async function GET() {
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

  // Resolve all shop IDs belonging to this workspace/user
  let shops;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch {
    shops = [];
  }
  const shopIds = shops.map((s) => s.id).filter(Boolean);

  if (shopIds.length === 0) {
    return NextResponse.json({ runs: [] });
  }

  // Fetch results strictly scoped to this workspace's shops only
  const { data: rows } = await supabase
    .from("eval_results")
    .select("*")
    .in("shop_id", shopIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ runs: [] });
  }

  // Group by run_label
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.run_label]) {
      grouped[row.run_label] = {
        run_label: row.run_label,
        model: row.model,
        created_at: row.created_at,
        results: [],
      };
    }
    grouped[row.run_label].results.push(row);
  }

  // Compute averages per run
  const runs = Object.values(grouped).map((run) => {
    const n = run.results.length;
    const avg = (key) =>
      Math.round((run.results.reduce((s, r) => s + (r[key] || 0), 0) / n) * 10) / 10;
    return {
      ...run,
      count: n,
      averages: {
        correctness: avg("correctness"),
        completeness: avg("completeness"),
        tone: avg("tone"),
        actionability: avg("actionability"),
        overall: avg("overall"),
      },
    };
  });

  return NextResponse.json({ runs });
}

export async function DELETE(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { run_label } = await req.json().catch(() => ({}));
  if (!run_label) {
    return NextResponse.json({ error: "run_label required" }, { status: 400 });
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

  // Resolve workspace shop IDs to ensure we only delete our own runs
  let deleteShops;
  try {
    deleteShops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch {
    deleteShops = [];
  }
  const shopIds = deleteShops.map((s) => s.id).filter(Boolean);
  if (shopIds.length === 0) {
    return NextResponse.json({ error: "No shops found" }, { status: 403 });
  }

  const { error } = await supabase
    .from("eval_results")
    .delete()
    .eq("run_label", run_label)
    .in("shop_id", shopIds); // scoping guard — can only delete own workspace rows

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
