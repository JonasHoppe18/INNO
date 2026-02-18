import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const SHOPIFY_API_VERSION = "2024-01";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeDomain(input = "") {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

function extractOrderNumber(value = "") {
  const text = String(value || "");
  const match =
    text.match(/(?:ordre|order)?\s*#?\s*(\d{3,})/i) ?? text.match(/(\d{3,})/);
  return match ? match[1] : null;
}

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const asNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

function extractAddressText(value = "") {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned
    .replace(/^updated shipping address to\s*/i, "")
    .replace(/^update shipping address to\s*/i, "")
    .replace(/^updated address to\s*/i, "")
    .trim();
}

function parseAddressFromText(value = "") {
  const addressText = extractAddressText(value);
  if (!addressText) return null;

  const segments = addressText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) return null;

  let name = null;
  let country = null;
  let zip = null;
  let city = null;
  let address1 = null;
  let address2 = null;

  const zipCityRegex = /^([a-z]{0,3}-?\d{3,10})\s+(.+)$/i;
  const working = [...segments];

  const first = working[0] || "";
  if (first && !/\d/.test(first) && working.length > 1) {
    name = first;
    working.shift();
  }

  const last = working[working.length - 1] || "";
  if (last && !/\d/.test(last) && working.length > 1) {
    country = last;
    working.pop();
  }

  for (let idx = 0; idx < working.length; idx += 1) {
    const segment = working[idx];
    const zipCityMatch = segment.match(zipCityRegex);
    if (!zipCityMatch) continue;
    zip = zipCityMatch[1].trim();
    city = zipCityMatch[2].trim();
    working.splice(idx, 1);
    break;
  }

  address1 = working[0] || null;
  address2 = working[1] || null;

  if (!name && !address1 && !zip && !city && !country) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(address1 ? { address1 } : {}),
    ...(address2 ? { address2 } : {}),
    ...(zip ? { zip } : {}),
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
  };
}

function parseLogDetail(raw = "") {
  const text = String(raw || "").trim();
  if (!text) {
    return {
      detailText: "",
      orderId: null,
      orderNumber: null,
      actionType: null,
      payload: {},
    };
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      const detailText =
        typeof parsed?.detail === "string"
          ? parsed.detail
          : typeof parsed?.message === "string"
          ? parsed.message
          : typeof parsed?.summary === "string"
          ? parsed.summary
          : typeof parsed?.text === "string"
          ? parsed.text
          : typeof parsed?.action === "string"
          ? parsed.action
          : "";
      const orderIdCandidate = parsed?.orderId ?? parsed?.order_id ?? parsed?.adminId ?? null;
      const normalizedOrderId =
        typeof orderIdCandidate === "number"
          ? String(orderIdCandidate)
          : typeof orderIdCandidate === "string"
          ? orderIdCandidate.trim()
          : null;
      const orderNumberCandidate =
        parsed?.orderNumber ?? parsed?.order_number ?? parsed?.orderNo ?? null;
      const normalizedOrderNumber =
        typeof orderNumberCandidate === "number"
          ? String(orderNumberCandidate)
          : typeof orderNumberCandidate === "string"
          ? orderNumberCandidate.trim()
          : null;
      const actionTypeCandidate =
        typeof parsed?.actionType === "string"
          ? parsed.actionType
          : typeof parsed?.action === "string"
          ? parsed.action
          : null;
      return {
        detailText,
        orderId: normalizedOrderId || null,
        orderNumber: normalizedOrderNumber || extractOrderNumber(detailText),
        actionType: actionTypeCandidate ? actionTypeCandidate.trim() : null,
        payload:
          parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {},
      };
    } catch {
      return {
        detailText: text,
        orderId: null,
        orderNumber: extractOrderNumber(text),
        actionType: null,
        payload: {},
      };
    }
  }

  return {
    detailText: text,
    orderId: null,
    orderNumber: extractOrderNumber(text),
    actionType: null,
    payload: {},
  };
}

function normalizeActionStatus(value = "") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "applied" || status === "approved") return "applied";
  if (status === "declined" || status === "denied") return "declined";
  if (status === "failed" || status === "error") return "failed";
  return "pending";
}

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

function buildActionKey(actionType, orderId, payload = {}) {
  return `${String(actionType || "").trim().toLowerCase()}::${String(
    orderId || ""
  ).trim()}::${stableStringify(payload || {})}`;
}

function matchesOrderNumber(order = {}, orderNumber = "") {
  const candidate = String(orderNumber || "").replace(/\D/g, "");
  if (!candidate) return false;
  const orderNum = String(order?.order_number ?? "").replace(/\D/g, "");
  const nameDigits = String(order?.name ?? "").replace(/\D/g, "");
  return orderNum === candidate || nameDigits.endsWith(candidate);
}

async function shopifyRequest({ domain, token, path, method = "GET", body }) {
  const response = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path}`,
    {
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    }
  );
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function shopifyGraphql({ domain, token, query, variables = {} }) {
  const result = await shopifyRequest({
    domain,
    token,
    path: `/graphql.json`,
    method: "POST",
    body: { query, variables },
  });
  const errors = Array.isArray(result?.payload?.errors) ? result.payload.errors : [];
  if (errors.length) {
    const message = errors
      .map((item) => item?.message || "GraphQL error")
      .filter(Boolean)
      .join("; ");
    throw Object.assign(new Error(message || "Shopify GraphQL failed."), { status: 400 });
  }
  if (!result?.payload?.data) {
    throw Object.assign(new Error("Shopify GraphQL returned no data."), { status: 400 });
  }
  return result.payload.data;
}

const toShopifyGid = (type, value) => {
  if (typeof value === "string" && value.startsWith("gid://")) return value;
  const numeric = asNumber(value);
  if (!numeric) return "";
  return `gid://shopify/${type}/${Math.trunc(numeric)}`;
};

function parseLineItemOperations(payload = {}) {
  const opsRaw = Array.isArray(payload?.operations) ? payload.operations : [];
  const ops = opsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const type = asString(item.type).toLowerCase();
      if (!type) return null;
      const quantity = asNumber(item.quantity ?? item.qty);
      const lineItemId = toShopifyGid(
        "LineItem",
        item.lineItemId ?? item.line_item_id ?? item.id
      );
      const variantId = toShopifyGid(
        "ProductVariant",
        item.variantId ?? item.variant_id
      );
      if (type === "set_quantity" || type === "remove_line_item") {
        if (!lineItemId) return null;
        return {
          type,
          lineItemId,
          quantity: type === "remove_line_item" ? 0 : Math.max(0, Math.trunc(quantity ?? 0)),
        };
      }
      if (type === "add_variant") {
        if (!variantId) return null;
        return {
          type,
          variantId,
          quantity: Math.max(1, Math.trunc(quantity ?? 1)),
        };
      }
      return null;
    })
    .filter(Boolean);

  if (ops.length) return ops;

  const legacyLineItemId = toShopifyGid(
    "LineItem",
    payload?.lineItemId ?? payload?.line_item_id ?? payload?.id
  );
  const legacyVariantId = toShopifyGid(
    "ProductVariant",
    payload?.variantId ?? payload?.variant_id
  );
  const legacyQuantity = Math.max(0, Math.trunc(asNumber(payload?.quantity ?? payload?.qty) ?? 0));
  const mode = asString(payload?.mode ?? payload?.operation).toLowerCase();
  if (legacyVariantId) {
    return [
      {
        type: "add_variant",
        variantId: legacyVariantId,
        quantity: Math.max(1, legacyQuantity || 1),
      },
    ];
  }
  if (legacyLineItemId && mode === "remove") {
    return [{ type: "remove_line_item", lineItemId: legacyLineItemId, quantity: 0 }];
  }
  if (legacyLineItemId && legacyQuantity >= 0) {
    return [{ type: "set_quantity", lineItemId: legacyLineItemId, quantity: legacyQuantity }];
  }
  return [];
}

function assertMutationUserErrors(scope, fallback = "Shopify mutation failed.") {
  const userErrors = Array.isArray(scope?.userErrors) ? scope.userErrors : [];
  if (!userErrors.length) return;
  const message = userErrors
    .map((item) => item?.message || "")
    .filter(Boolean)
    .join("; ");
  throw Object.assign(new Error(message || fallback), { status: 400 });
}

async function resolveOrder({ domain, token, orderId, orderNumber }) {
  if (orderId) {
    const result = await shopifyRequest({
      domain,
      token,
      path: `/orders/${encodeURIComponent(String(orderId))}.json?fields=id,name,order_number,shipping_address`,
    });
    if (result.response.ok && result.payload?.order) {
      return result.payload.order;
    }
  }

  if (!orderNumber) return null;
  const result = await shopifyRequest({
    domain,
    token,
    path: `/orders.json?status=any&limit=25&fields=id,name,order_number,shipping_address&name=${encodeURIComponent(
      `#${orderNumber}`
    )}`,
  });
  if (!result.response.ok) return null;
  const orders = Array.isArray(result.payload?.orders) ? result.payload.orders : [];
  if (!orders.length) return null;
  return orders.find((order) => matchesOrderNumber(order, orderNumber)) || orders[0];
}

async function getPrimaryFulfillmentOrderId({ domain, token, orderId }) {
  const result = await shopifyRequest({
    domain,
    token,
    path: `/orders/${encodeURIComponent(String(orderId))}/fulfillment_orders.json`,
  });
  if (!result.response.ok) return null;
  const list = Array.isArray(result.payload?.fulfillment_orders)
    ? result.payload.fulfillment_orders
    : [];
  return asNumber(list[0]?.id);
}

async function executeShopifyAction({ domain, token, actionType, orderId, payload = {}, order }) {
  switch (actionType) {
    case "update_shipping_address": {
      const shippingAddress = payload?.shipping_address ?? payload?.shippingAddress;
      const inferredAddress =
        shippingAddress && typeof shippingAddress === "object"
          ? shippingAddress
          : parseAddressFromText(payload?.detailText || "") || null;
      if (!inferredAddress || typeof inferredAddress !== "object") {
        throw Object.assign(new Error("Could not parse shipping address payload."), { status: 400 });
      }
      const mergedShipping = {
        ...(order?.shipping_address || {}),
        ...inferredAddress,
      };
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, shipping_address: mergedShipping } },
      });
    }
    case "cancel_order": {
      const body = {};
      if (asString(payload?.reason)) body.reason = asString(payload.reason);
      if (asString(payload?.email)) body.email = asString(payload.email);
      if (typeof payload?.refund === "boolean") body.refund = payload.refund;
      if (typeof payload?.restock === "boolean") body.restock = payload.restock;
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}/cancel.json`,
        method: "POST",
        body,
      });
    }
    case "refund_order": {
      const amount = asNumber(payload?.amount);
      const currency = asString(payload?.currency || payload?.currency_code);
      const reason = asString(payload?.reason);
      const note = asString(payload?.note);
      const transactions = amount
        ? [
            {
              kind: "refund",
              amount: amount.toFixed(2),
              ...(currency ? { currency } : {}),
            },
          ]
        : [];
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}/refunds.json`,
        method: "POST",
        body: {
          refund: {
            notify: true,
            ...(note ? { note } : {}),
            ...(reason ? { reason } : {}),
            ...(transactions.length ? { transactions } : {}),
          },
        },
      });
    }
    case "change_shipping_method": {
      const title = asString(payload?.title ?? payload?.shipping_title);
      const price = asString(payload?.price);
      if (!title || !price) {
        throw Object.assign(new Error("Shipping method change requires title and price."), {
          status: 400,
        });
      }
      const code = asString(payload?.code ?? payload?.shipping_code);
      const source = asString(payload?.source) || "manual";
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: {
          order: {
            id: orderId,
            shipping_lines: [{ title, price, ...(code ? { code } : {}), ...(source ? { source } : {}) }],
          },
        },
      });
    }
    case "hold_or_release_fulfillment": {
      const mode = asString(payload?.mode ?? payload?.operation).toLowerCase() || "hold";
      const fulfillmentOrderId =
        asNumber(payload?.fulfillment_order_id ?? payload?.fulfillmentOrderId) ||
        (await getPrimaryFulfillmentOrderId({ domain, token, orderId }));
      if (!fulfillmentOrderId) {
        throw Object.assign(new Error("Could not resolve fulfillment order for hold/release."), {
          status: 404,
        });
      }
      if (mode === "release") {
        return await shopifyRequest({
          domain,
          token,
          path: `/fulfillment_orders/${encodeURIComponent(String(fulfillmentOrderId))}/release_hold.json`,
          method: "POST",
        });
      }
      const reason = asString(payload?.reason);
      const reasonNotes = asString(payload?.reason_notes ?? payload?.note);
      const holdPayload = {};
      if (reason) holdPayload.reason = reason;
      if (reasonNotes) holdPayload.reason_notes = reasonNotes;
      return await shopifyRequest({
        domain,
        token,
        path: `/fulfillment_orders/${encodeURIComponent(String(fulfillmentOrderId))}/hold.json`,
        method: "POST",
        body: Object.keys(holdPayload).length
          ? { fulfillment_hold: holdPayload }
          : undefined,
      });
    }
    case "edit_line_items": {
      const operations = parseLineItemOperations(payload);
      if (!operations.length) {
        throw Object.assign(
          new Error(
            "Line item edits require payload.operations with set_quantity/remove_line_item/add_variant."
          ),
          { status: 400 }
        );
      }

      const orderGid = toShopifyGid("Order", orderId);
      const beginData = await shopifyGraphql({
        domain,
        token,
        query: `mutation OrderEditBegin($id: ID!) {
          orderEditBegin(id: $id) {
            calculatedOrder { id }
            userErrors { message }
          }
        }`,
        variables: { id: orderGid },
      });
      const beginScope = beginData?.orderEditBegin || null;
      assertMutationUserErrors(beginScope, "Could not begin order edit.");
      const calculatedOrderId = beginScope?.calculatedOrder?.id;
      if (!calculatedOrderId) {
        throw Object.assign(new Error("Could not resolve calculated order id."), { status: 400 });
      }

      for (const operation of operations) {
        if (operation.type === "add_variant") {
          const addData = await shopifyGraphql({
            domain,
            token,
            query: `mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
              orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
                userErrors { message }
              }
            }`,
            variables: {
              id: calculatedOrderId,
              variantId: operation.variantId,
              quantity: operation.quantity,
            },
          });
          assertMutationUserErrors(addData?.orderEditAddVariant, "Could not add variant.");
          continue;
        }

        const setData = await shopifyGraphql({
          domain,
          token,
          query: `mutation SetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
            orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
              userErrors { message }
            }
          }`,
          variables: {
            id: calculatedOrderId,
            lineItemId: operation.lineItemId,
            quantity: operation.quantity,
          },
        });
        assertMutationUserErrors(setData?.orderEditSetQuantity, "Could not update line item quantity.");
      }

      const staffNote = asString(payload?.edit_summary ?? payload?.summary ?? payload?.requested_changes);
      const commitData = await shopifyGraphql({
        domain,
        token,
        query: `mutation CommitEdit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
          orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
            order { id }
            userErrors { message }
          }
        }`,
        variables: {
          id: calculatedOrderId,
          notifyCustomer: false,
          ...(staffNote ? { staffNote } : {}),
        },
      });
      assertMutationUserErrors(commitData?.orderEditCommit, "Could not commit order edit.");
      if (!commitData?.orderEditCommit?.order?.id) {
        throw Object.assign(new Error("Order edit commit did not return an order."), { status: 400 });
      }
      return { response: { ok: true, status: 200 }, payload: commitData };
    }
    case "update_customer_contact": {
      const email = asString(payload?.email);
      const phone = asString(payload?.phone);
      if (!email && !phone) {
        throw Object.assign(new Error("Contact update requires email or phone."), {
          status: 400,
        });
      }
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, ...(email ? { email } : {}), ...(phone ? { phone } : {}) } },
      });
    }
    case "add_note":
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, note: asString(payload?.note) } },
      });
    case "add_tag": {
      const tag = asString(payload?.tag);
      if (!tag) {
        throw Object.assign(new Error("Tag update requires tag."), { status: 400 });
      }
      const current = await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
      });
      const existingTags = String(current?.payload?.order?.tags || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!existingTags.includes(tag)) existingTags.push(tag);
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, tags: existingTags.join(", ") } },
      });
    }
    case "add_internal_note_or_tag":
      if (asString(payload?.tag)) {
        return await executeShopifyAction({
          domain,
          token,
          actionType: "add_tag",
          orderId,
          payload,
          order,
        });
      }
      return await executeShopifyAction({
        domain,
        token,
        actionType: "add_note",
        orderId,
        payload,
        order,
      });
    case "resend_confirmation_or_invoice": {
      const to = asString(payload?.to_email ?? payload?.email);
      const customMessage = asString(payload?.message);
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}/send_invoice.json`,
        method: "POST",
        body: {
          invoice: {
            ...(to ? { to } : {}),
            ...(customMessage ? { custom_message: customMessage } : {}),
          },
        },
      });
    }
    default:
      throw Object.assign(new Error(`Unsupported action type: ${actionType}`), { status: 400 });
  }
}

export async function POST(request, { params }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const decisionRaw = String(body?.decision || "accepted").trim().toLowerCase();
  const decision = decisionRaw === "denied" || decisionRaw === "declined" ? "declined" : "accepted";
  const actionId = body?.actionId ? String(body.actionId).trim() : "";
  const proposalLogId = body?.proposalLogId ? String(body.proposalLogId) : "";
  const proposalText = body?.proposalText ? String(body.proposalText) : "";
  if (!actionId && !proposalLogId && !proposalText) {
    return NextResponse.json(
      { error: "actionId, proposalLogId or proposalText is required." },
      { status: 400 }
    );
  }

  let supabaseUserId = null;
  try {
    supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user." }, { status: 401 });
  }

  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .select("id, provider_thread_id, subject, snippet")
    .eq("id", threadId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  let actionRecord = null;
  if (actionId) {
    const { data: actionRow, error: actionError } = await serviceClient
      .from("thread_actions")
      .select(
        "id, user_id, thread_id, action_type, status, detail, payload, order_id, order_number, action_key"
      )
      .eq("id", actionId)
      .eq("user_id", supabaseUserId)
      .eq("thread_id", thread.id)
      .maybeSingle();
    if (actionError) {
      return NextResponse.json({ error: actionError.message }, { status: 500 });
    }
    if (!actionRow) {
      return NextResponse.json({ error: "Action not found for this thread." }, { status: 404 });
    }
    actionRecord = actionRow;
  } else {
    const { data: latestPending } = await serviceClient
      .from("thread_actions")
      .select(
        "id, user_id, thread_id, action_type, status, detail, payload, order_id, order_number, action_key"
      )
      .eq("user_id", supabaseUserId)
      .eq("thread_id", thread.id)
      .eq("status", "pending")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestPending) {
      actionRecord = latestPending;
    }
  }

  if (decision === "declined") {
    const nowIso = new Date().toISOString();
    if (actionRecord?.id) {
      const { error: updateActionError } = await serviceClient
        .from("thread_actions")
        .update({
          status: "declined",
          declined_at: nowIso,
          decided_at: nowIso,
          updated_at: nowIso,
          error: null,
        })
        .eq("id", actionRecord.id);
      if (updateActionError) {
        return NextResponse.json({ error: updateActionError.message }, { status: 500 });
      }
    }

    await serviceClient.from("agent_logs").insert({
      draft_id: null,
      step_name: "shopify_action_declined",
      step_detail: JSON.stringify({
        thread_id: threadId,
        action: actionRecord?.action_type || null,
        detail: actionRecord?.detail || proposalText || null,
      }),
      status: "info",
      created_at: nowIso,
    });

    return NextResponse.json(
      {
        ok: true,
        decision: "declined",
        actionId: actionRecord?.id || null,
      },
      { status: 200 }
    );
  }

  let parsed = parseLogDetail(proposalText);
  let proposalStepName = "shopify_action";
  if (proposalLogId) {
    const { data: logRow } = await serviceClient
      .from("agent_logs")
      .select("id, draft_id, step_name, step_detail")
      .eq("id", proposalLogId)
      .maybeSingle();
    if (!logRow) {
      return NextResponse.json({ error: "Proposal log not found." }, { status: 404 });
    }
    if (logRow?.draft_id) {
      const { data: draftRow } = await serviceClient
        .from("drafts")
        .select("id, thread_id")
        .eq("id", logRow.draft_id)
        .maybeSingle();
      const validThread =
        draftRow?.thread_id &&
        [thread.id, thread.provider_thread_id].filter(Boolean).includes(draftRow.thread_id);
      if (!validThread) {
        return NextResponse.json(
          { error: "Proposal does not belong to this thread." },
          { status: 403 }
        );
      }
    }
    proposalStepName = String(logRow?.step_name || proposalStepName).toLowerCase();
    parsed = parseLogDetail(logRow?.step_detail || proposalText);
  }

  if (actionRecord?.detail || actionRecord?.action_type || actionRecord?.payload) {
    parsed = {
      ...parsed,
      detailText: asString(actionRecord.detail) || parsed.detailText,
      actionType: asString(actionRecord.action_type) || parsed.actionType,
      payload:
        actionRecord?.payload && typeof actionRecord.payload === "object"
          ? actionRecord.payload
          : parsed.payload,
      orderId: asString(actionRecord?.order_id) || parsed.orderId,
      orderNumber: asString(actionRecord?.order_number) || parsed.orderNumber,
    };
  }

  const detailText = String(parsed?.detailText || proposalText || "").trim();
  const inferredActionFromText = detailText.toLowerCase().startsWith("cancel")
    ? "cancel_order"
    : detailText.toLowerCase().startsWith("refund")
    ? "refund_order"
    : detailText.toLowerCase().includes("tag")
    ? "add_tag"
    : detailText.toLowerCase().includes("invoice")
    ? "resend_confirmation_or_invoice"
    : detailText.toLowerCase().includes("contact")
    ? "update_customer_contact"
    : detailText.toLowerCase().includes("shipping method")
    ? "change_shipping_method"
    : detailText.toLowerCase().includes("fulfillment hold")
    ? "hold_or_release_fulfillment"
    : detailText.toLowerCase().includes("line item")
    ? "edit_line_items"
    : "update_shipping_address";
  const actionType =
    asString(parsed?.actionType) || asString(parsed?.payload?.actionType) || inferredActionFromText;
  const normalizedActionType = actionType.trim();
  if (actionRecord?.status && normalizeActionStatus(actionRecord.status) === "applied") {
    return NextResponse.json(
      {
        ok: true,
        action: normalizedActionType,
        orderId: parsed?.orderId || actionRecord?.order_id || null,
        orderNumber: parsed?.orderNumber || actionRecord?.order_number || null,
        detail: detailText || null,
        sourceStep: proposalStepName,
        alreadyApplied: true,
      },
      { status: 200 }
    );
  }

  const fallbackOrderNumber =
    extractOrderNumber(detailText) ||
    extractOrderNumber(thread.subject) ||
    extractOrderNumber(thread.snippet);
  const orderNumber = parsed?.orderNumber || fallbackOrderNumber || null;

  const { data: shopRow, error: shopError } = await serviceClient
    .from("shops")
    .select("shop_domain, access_token_encrypted")
    .eq("owner_user_id", supabaseUserId)
    .eq("platform", "shopify")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shopError || !shopRow) {
    return NextResponse.json({ error: "Shopify is not connected." }, { status: 400 });
  }

  const domain = normalizeDomain(shopRow?.shop_domain || "");
  if (!domain || !shopRow?.access_token_encrypted) {
    return NextResponse.json(
      { error: "Shopify credentials are incomplete. Reconnect Shopify." },
      { status: 400 }
    );
  }

  let accessToken = "";
  try {
    accessToken = decryptString(shopRow.access_token_encrypted);
  } catch (error) {
    return NextResponse.json(
      { error: `Could not decrypt Shopify token: ${error.message}` },
      { status: 500 }
    );
  }

  const order = await resolveOrder({
    domain,
    token: accessToken,
    orderId: parsed?.orderId,
    orderNumber,
  });
  if (!order?.id) {
    return NextResponse.json(
      { error: "Could not resolve Shopify order for this request." },
      { status: 404 }
    );
  }

  let payloadForExecution =
    parsed?.payload && typeof parsed.payload === "object" ? { ...parsed.payload } : {};
  if (
    normalizedActionType === "update_shipping_address" &&
    !payloadForExecution?.shipping_address &&
    !payloadForExecution?.shippingAddress
  ) {
    const proposedAddress = parseAddressFromText(detailText);
    if (proposedAddress) {
      payloadForExecution = {
        ...payloadForExecution,
        shipping_address: {
          ...(order.shipping_address || {}),
          ...proposedAddress,
        },
      };
    }
  }

  const updateResult = await executeShopifyAction({
    domain,
    token: accessToken,
    actionType: normalizedActionType,
    orderId: Number(order.id),
    payload: payloadForExecution,
    order,
  });

  if (!updateResult.response.ok) {
    const payload = updateResult.payload || {};
    const message =
      payload?.errors ||
      payload?.error ||
      payload?.message ||
      `Shopify returned ${updateResult.response.status}.`;
    return NextResponse.json({ error: String(message) }, { status: updateResult.response.status });
  }

  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: "shopify_action_applied",
    step_detail: JSON.stringify({
      thread_id: threadId,
      action: normalizedActionType,
      order_id: String(order.id),
      order_number: order.order_number ?? null,
      detail: detailText || null,
    }),
    status: "success",
    created_at: new Date().toISOString(),
  });

  const nowIso = new Date().toISOString();
  const actionKey = actionRecord?.action_key
    ? String(actionRecord.action_key)
    : buildActionKey(normalizedActionType, order.id, payloadForExecution);
  const actionRowPayload =
    payloadForExecution && typeof payloadForExecution === "object"
      ? payloadForExecution
      : parsed?.payload && typeof parsed.payload === "object"
      ? parsed.payload
      : {};

  if (actionRecord?.id) {
    await serviceClient
      .from("thread_actions")
      .update({
        status: "applied",
        detail: detailText || actionRecord?.detail || null,
        payload: actionRowPayload,
        action_type: normalizedActionType,
        action_key: actionKey,
        order_id: String(order.id),
        order_number: order.order_number ? String(order.order_number) : null,
        decided_at: nowIso,
        applied_at: nowIso,
        updated_at: nowIso,
        error: null,
      })
      .eq("id", actionRecord.id);
  } else {
    await serviceClient.from("thread_actions").insert({
      user_id: supabaseUserId,
      thread_id: thread.id,
      action_type: normalizedActionType,
      action_key: actionKey,
      status: "applied",
      detail: detailText || null,
      payload: actionRowPayload,
      order_id: String(order.id),
      order_number: order.order_number ? String(order.order_number) : null,
      decided_at: nowIso,
      applied_at: nowIso,
      updated_at: nowIso,
      created_at: nowIso,
      source: "manual_approval",
      error: null,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      decision: "accepted",
      action: normalizedActionType,
      orderId: String(order.id),
      orderNumber: order.order_number ?? null,
      detail: detailText || null,
      sourceStep: proposalStepName,
    },
    { status: 200 }
  );
}
