// POST /api/knowledge/simulate
//
// Stateless multi-turn simulator. Takes a full conversation history and
// invokes the AI draft pipeline against the latest customer message — with
// all prior turns as context. Used by the conversation simulator page so
// admins can stress-test how Sona behaves as a thread gets longer (does it
// repeat itself? lose track of decisions? change tone over turns?).
//
// Nothing is persisted. Each call is a fresh pipeline run with `email_data`
// constructed from the supplied conversation.
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

const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

type ConversationTurn = { role: "customer" | "agent"; text: string };

export async function POST(request: Request) {
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

  const payload = (await request.json().catch(() => null)) as any;
  const rawConversation = Array.isArray(payload?.conversation) ? payload.conversation : [];
  const conversation: ConversationTurn[] = rawConversation
    .map((t: any) => ({
      role: t?.role === "agent" ? "agent" : "customer",
      text: String(t?.text || "").trim(),
    }))
    .filter((t: ConversationTurn) => t.text.length > 0) as ConversationTurn[];

  if (!conversation.length) {
    return NextResponse.json({ error: "conversation must contain at least one turn." }, { status: 400 });
  }

  const subject = String(payload?.subject || "").trim() || "(simulated ticket)";
  const requestedShopId = String(payload?.shop_id || "").trim();
  const customerEmail = String(payload?.customer_email || "").trim() || null;
  let orderNumber = String(payload?.order_number || "").trim() || null;
  // When the client loaded a real ticket and hasn't diverged from it yet,
  // it passes thread_id + message_id so we can invoke the pipeline in real
  // (production-equivalent) mode. This is the only way to get the same
  // fact-resolver behavior prod gets — accumulated case_state, real customer
  // lookups, the works. As soon as the user adds new synthetic turns, the
  // client stops passing these and we fall back to eval mode.
  const realThreadId = String(payload?.thread_id || "").trim() || null;
  const realMessageId = String(payload?.message_id || "").trim() || null;

  // If the admin didn't explicitly provide an order number, try to extract one
  // from the subject — most real tickets have it there ("Order 1048", "#1048"
  // etc.). Avoids the common mistake of typing the order in the subject but
  // forgetting the dedicated field, which leaves fact-resolver blind.
  if (!orderNumber) {
    const m = subject.match(/(?:order|ordre|#)\s*#?\s*(\d{3,10})/i);
    if (m && m[1]) orderNumber = m[1];
  }
  // Optional: an action the agent accepted on the previous turn. This lets the
  // simulator test the "post-action" follow-up path — e.g. user accepts a
  // refund action on turn 1 → on turn 2 the AI knows the refund was executed
  // and adjusts its reply to past-tense / acknowledges the action.
  const rawActionResult = payload?.action_result;
  const actionResult =
    rawActionResult && typeof rawActionResult === "object" && typeof rawActionResult.action_type === "string"
      ? rawActionResult
      : null;

  // Last turn validation — must be a customer message UNLESS we have an
  // action_result, in which case the action itself is the trigger for the
  // post-action follow-up draft (no new customer reply needed).
  const lastTurn = conversation[conversation.length - 1];
  if (lastTurn.role !== "customer" && !actionResult) {
    return NextResponse.json(
      {
        error:
          "The last turn must be a customer message (or an accepted action) — the AI needs something to reply to.",
      },
      { status: 400 },
    );
  }

  // Resolve shop_id — either explicit or fall back to workspace's single shop.
  let shops: Array<{ id: string }>;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  const shopIds = shops.map((s) => s.id);
  let shopId: string | undefined;
  if (requestedShopId && shopIds.includes(requestedShopId)) {
    shopId = requestedShopId;
  } else if (shopIds.length) {
    shopId = shopIds[0];
  }
  if (!shopId) {
    return NextResponse.json({ error: "No shop in scope." }, { status: 403 });
  }

  // Find the latest customer message — that's the "body" the AI is replying
  // to. In post-action mode (last turn = agent), we re-use the most recent
  // customer message and treat everything after it as agent context.
  let latestCustomerIdx = -1;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    if (conversation[i].role === "customer") {
      latestCustomerIdx = i;
      break;
    }
  }
  if (latestCustomerIdx === -1) {
    return NextResponse.json(
      { error: "Conversation has no customer message to reply to." },
      { status: 400 },
    );
  }
  const latestCustomerMessage = conversation[latestCustomerIdx].text;
  const history = conversation.slice(0, latestCustomerIdx);

  // If the admin provided an order number, prepend it as a clearly-marked
  // header so the case-state-updater LLM extracts it reliably (a suffix
  // parenthetical was easy to miss). This drives fact-resolver's direct
  // Shopify lookup, bypassing the "newest order by email" fallback that
  // otherwise picks the wrong order when the customer has multiple.
  const bodyWithOrderHint =
    orderNumber && !new RegExp(`#?${orderNumber}\\b`).test(latestCustomerMessage)
      ? `Vedrørende ordre #${orderNumber}\n\n${latestCustomerMessage}`
      : latestCustomerMessage;

  const emailData: Record<string, unknown> = {
    subject,
    body: bodyWithOrderHint,
    source_thread_id: null,
    conversation_history: history,
  };
  // Setting from_email enables fact-resolver's email-based order lookup
  // (the secondary path when no order number is mentioned in the body).
  if (customerEmail) emailData.from_email = customerEmail;

  // Choose the pipeline mode. Real thread_id mode gives prod-equivalent
  // behavior (accumulated case_state, real fact-resolver context). Eval mode
  // is used for synthetic / multi-turn-after-load scenarios.
  const useRealMode = Boolean(realThreadId && realMessageId);
  const edgeBody = useRealMode
    ? {
        shop_id: shopId,
        thread_id: realThreadId,
        message_id: realMessageId,
        ...(actionResult ? { action_result: actionResult } : {}),
      }
    : {
        shop_id: shopId,
        email_data: emailData,
        ...(actionResult ? { action_result: actionResult } : {}),
      };

  const start = Date.now();
  let edgeResp: Response;
  try {
    edgeResp = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-draft-v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(edgeBody),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Edge function call failed: ${err?.message || err}` },
      { status: 502 },
    );
  }

  const latency = Date.now() - start;
  const text = await edgeResp.text();
  if (!edgeResp.ok) {
    return NextResponse.json(
      { error: text.slice(0, 500) || `HTTP ${edgeResp.status}`, latency_ms: latency },
      { status: 502 },
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid response from edge function" }, { status: 502 });
  }

  return NextResponse.json({
    turn_index: conversation.length - 1,
    draft_text: data.draft_text ?? data.reply_draft ?? null,
    proposed_actions: Array.isArray(data.proposed_actions) ? data.proposed_actions : [],
    routing_hint: data.routing_hint ?? null,
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    sources: Array.isArray(data.sources) ? data.sources : [],
    intent: data.intent ?? null,
    latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : latency,
  });
}
