import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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

function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

function buildActionKey(actionType, orderId, payload = {}) {
  return `${String(actionType || "").trim().toLowerCase()}::${String(orderId || "").trim()}::${stableStringify(payload || {})}`;
}

/**
 * POST /api/threads/[threadId]/exchange/mark-received
 *
 * Called when the CS agent clicks "Markér modtaget".
 * Looks up the applied send_return_instructions (is_exchange) action for this thread
 * to get the exchange payload, then creates a pending fulfill_exchange action
 * which the agent must approve to trigger the Shopify calls.
 */
export async function POST(request, { params }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
  }

  const scope = await resolveAuthScope(clerkUserId, serviceClient);
  if (!scope) {
    return NextResponse.json({ error: "Could not resolve workspace scope" }, { status: 403 });
  }

  // Load the thread to verify access
  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, tags")
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  // Find the applied send_return_instructions action with is_exchange: true
  // to recover the exchange payload (variant IDs, line item, etc.)
  let returnInstructionsQuery = serviceClient
    .from("thread_actions")
    .select("id, payload, order_id, order_number, action_key")
    .eq("thread_id", threadId)
    .eq("action_type", "send_return_instructions")
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(5);
  returnInstructionsQuery = applyScope(returnInstructionsQuery, scope);
  const { data: returnInstructionsRows } = await returnInstructionsQuery;

  const returnInstructionsAction = (returnInstructionsRows || []).find(
    (row) => row?.payload?.is_exchange === true
  );

  // Check if fulfill_exchange action already exists (pending or applied) to avoid duplicates
  let existingFulfillQuery = serviceClient
    .from("thread_actions")
    .select("id, status")
    .eq("thread_id", threadId)
    .eq("action_type", "fulfill_exchange")
    .in("status", ["pending", "applied"])
    .limit(1);
  existingFulfillQuery = applyScope(existingFulfillQuery, scope);
  const { data: existingFulfill } = await existingFulfillQuery.maybeSingle();
  if (existingFulfill?.id) {
    return NextResponse.json(
      {
        ok: true,
        alreadyExists: true,
        action: {
          id: String(existingFulfill.id),
          actionType: "fulfill_exchange",
          status: asString(existingFulfill.status),
        },
      },
      { status: 200 }
    );
  }

  // Build the fulfill_exchange payload from the return instructions action payload
  const sourcePayload =
    returnInstructionsAction?.payload && typeof returnInstructionsAction.payload === "object"
      ? returnInstructionsAction.payload
      : {};

  const fulfillPayload = {
    return_line_item_id: asString(sourcePayload.return_line_item_id || ""),
    exchange_variant_id: asString(sourcePayload.exchange_variant_id || ""),
    exchange_product_title: asString(sourcePayload.exchange_product_title || ""),
    exchange_variant_title: asString(sourcePayload.exchange_variant_title || ""),
    return_reason: asString(sourcePayload.return_reason || ""),
    return_quantity: sourcePayload.return_quantity || 1,
    exchange_quantity: sourcePayload.exchange_quantity || 1,
    return_case_id: asString(sourcePayload.return_case_id || ""),
    marked_received_at: nowIso,
  };

  const orderId = asString(
    returnInstructionsAction?.order_id ||
    sourcePayload.order_id ||
    sourcePayload.shopify_order_id ||
    ""
  );
  const orderNumber = asString(
    returnInstructionsAction?.order_number ||
    sourcePayload.order_number ||
    ""
  );

  const actionKey = buildActionKey("fulfill_exchange", orderId || threadId, {
    return_line_item_id: fulfillPayload.return_line_item_id,
    exchange_variant_id: fulfillPayload.exchange_variant_id,
  });

  // Resolve Supabase user ID from Clerk ID
  const { data: memberRow } = await serviceClient
    .from("workspace_members")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  const supabaseUserId = asString(memberRow?.user_id || clerkUserId);

  const productLabel = fulfillPayload.exchange_product_title
    ? fulfillPayload.exchange_variant_title
      ? `${fulfillPayload.exchange_product_title} (${fulfillPayload.exchange_variant_title})`
      : fulfillPayload.exchange_product_title
    : "erstatningsvaren";

  const { data: insertedAction, error: insertError } = await serviceClient
    .from("thread_actions")
    .insert({
      user_id: supabaseUserId,
      workspace_id: scope.workspaceId ?? null,
      thread_id: threadId,
      action_type: "fulfill_exchange",
      action_key: actionKey,
      status: "pending",
      detail: `Gennemfør ombytning: send ${productLabel} til kunden. Den returnerede vare er modtaget.`,
      payload: fulfillPayload,
      ...(orderId ? { order_id: orderId } : {}),
      ...(orderNumber ? { order_number: orderNumber } : {}),
      source: "manual_approval",
      decided_at: null,
      applied_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      error: null,
    })
    .select("id, action_type, status, detail, payload, order_id, order_number, created_at")
    .maybeSingle();

  if (insertError || !insertedAction?.id) {
    console.error("mark-received: failed to insert fulfill_exchange action", insertError);
    return NextResponse.json({ error: "Failed to create exchange action" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      action: {
        id: String(insertedAction.id),
        actionType: "fulfill_exchange",
        status: "pending",
        detail: asString(insertedAction.detail),
        payload: insertedAction.payload || {},
        orderId: asString(insertedAction.order_id || ""),
        orderNumber: asString(insertedAction.order_number || ""),
        createdAt: insertedAction.created_at,
      },
    },
    { status: 200 }
  );
}
