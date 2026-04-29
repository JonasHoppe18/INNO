import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

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

const SUPABASE_FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") + "/functions/v1";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { thread_id, message_id } = body;
  if (!thread_id) {
    return NextResponse.json(
      { error: "thread_id is required" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database connection failed" },
      { status: 500 },
    );
  }

  // Resolve shop_id from thread (server-side — no need to pass from client)
  const { data: thread } = await supabase
    .from("mail_threads")
    .select("id, shop_id, mail_account_id")
    .eq("id", thread_id)
    .single();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  let shop_id = thread.shop_id;

  // Fallback: resolve shop from mail_account if thread has no direct shop_id
  if (!shop_id && thread.mail_account_id) {
    const { data: account } = await supabase
      .from("mail_accounts")
      .select("shop_id")
      .eq("id", thread.mail_account_id)
      .single();
    shop_id = account?.shop_id ?? null;
  }

  if (!shop_id) {
    return NextResponse.json({ error: "Could not resolve shop for this thread" }, { status: 404 });
  }

  const startTime = Date.now();

  try {
    // Call generate-draft-v2 edge function
    const edgeResp = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/generate-draft-v2`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ thread_id, message_id, shop_id }),
      },
    );

    if (!edgeResp.ok) {
      const errText = await edgeResp.text();
      console.error("[preview-v2] Edge function error:", errText);
      return NextResponse.json(
        { error: "Draft generation failed" },
        { status: 502 },
      );
    }

    const result = await edgeResp.json();
    const latency_ms = Date.now() - startTime;

    // Log preview to draft_previews table (fire and forget)
    if (result.draft_text && !result.skipped) {
      supabase
        .from("draft_previews")
        .insert({
          thread_id,
          message_id: message_id ?? null,
          shop_id,
          draft_text: result.draft_text,
          proposed_actions: result.proposed_actions ?? [],
          verifier_confidence: result.confidence ?? null,
          sources: result.sources ?? [],
          routing_hint: result.routing_hint ?? "review",
          latency_ms,
          outcome: "pending",
          pipeline_version: "v2",
        })
        .then(({ error }) => {
          if (error) console.warn("[preview-v2] Failed to log preview:", error);
        });
    }

    return NextResponse.json({
      draft_text: result.draft_text ?? null,
      proposed_actions: result.proposed_actions ?? [],
      routing_hint: result.routing_hint ?? "review",
      confidence: result.confidence ?? 0,
      sources: result.sources ?? [],
      latency_ms,
      skipped: result.skipped ?? false,
      skip_reason: result.skip_reason ?? null,
    });
  } catch (err) {
    console.error("[preview-v2] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
