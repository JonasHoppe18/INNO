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

  const { thread_id, message_id, customer_context } = body;
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

  // Resolve shop_id via mail_accounts (mail_threads.mailbox_id = mail_accounts.id)
  const { data: thread } = await supabase
    .from("mail_threads")
    .select("id, mailbox_id")
    .eq("id", thread_id)
    .single();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  let shop_id = null;
  if (thread.mailbox_id) {
    const { data: account } = await supabase
      .from("mail_accounts")
      .select("shop_id")
      .eq("id", thread.mailbox_id)
      .single();
    shop_id = account?.shop_id ?? null;
  }

  if (!shop_id) {
    return NextResponse.json(
      { error: "Could not resolve shop for this thread" },
      { status: 404 },
    );
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
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          thread_id,
          message_id,
          shop_id,
          customer_context,
        }),
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

    let previewId = null;

    // Log preview to draft_previews table so adoption/edit feedback can be tied
    // back to the exact v2 output shown to the agent.
    if (result.draft_text && !result.skipped) {
      const { data: previewRow, error: previewError } = await supabase
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
          is_test_mode: result.is_test_mode ?? false,
          latency_ms,
          outcome: "pending",
          pipeline_version: "v2",
        })
        .select("id")
        .maybeSingle();
      if (previewError) {
        console.warn("[preview-v2] Failed to log preview:", previewError);
      } else {
        previewId = previewRow?.id || null;
      }
    }

    return NextResponse.json({
      preview_id: previewId,
      draft_text: result.draft_text ?? null,
      proposed_actions: result.proposed_actions ?? [],
      routing_hint: result.routing_hint ?? "review",
      is_test_mode: result.is_test_mode ?? false,
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

export async function PATCH(request) {
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

  const previewId =
    typeof body?.preview_id === "string" ? body.preview_id.trim() : "";
  const threadId =
    typeof body?.thread_id === "string" ? body.thread_id.trim() : "";
  const outcome = typeof body?.outcome === "string" ? body.outcome.trim() : "";
  if (!previewId || !threadId || !["rejected"].includes(outcome)) {
    return NextResponse.json(
      { error: "Invalid feedback payload" },
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

  const { data: thread } = await supabase
    .from("mail_threads")
    .select("id, mailbox_id")
    .eq("id", threadId)
    .single();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  let shopId = null;
  if (thread.mailbox_id) {
    const { data: account } = await supabase
      .from("mail_accounts")
      .select("shop_id")
      .eq("id", thread.mailbox_id)
      .single();
    shopId = account?.shop_id ?? null;
  }

  if (!shopId) {
    return NextResponse.json(
      { error: "Could not resolve shop for this thread" },
      { status: 404 },
    );
  }

  const { error } = await supabase
    .from("draft_previews")
    .update({
      outcome,
      rejected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", previewId)
    .eq("thread_id", threadId)
    .eq("shop_id", shopId)
    .eq("pipeline_version", "v2");

  if (error) {
    console.warn("[preview-v2] Failed to update preview feedback:", error);
    return NextResponse.json(
      { error: "Could not update feedback" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
