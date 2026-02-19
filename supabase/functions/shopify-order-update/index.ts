import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getShopCredentialsForUser } from "../_shared/shopify-credentials.ts";

const SHOPIFY_API_VERSION = "2024-07"; // Samme version som i de andre endpoints

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CLERK_JWT_ISSUER = Deno.env.get("CLERK_JWT_ISSUER");

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – shop data kan ikke hentes.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – edge function kan ikke spørge Supabase.");
if (!CLERK_JWT_ISSUER)
  console.warn("CLERK_JWT_ISSUER mangler – Clerk sessioner kan ikke verificeres.");

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const JWKS = CLERK_JWT_ISSUER
  ? createRemoteJWKSet(
      new URL(`${CLERK_JWT_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`),
    )
  : null;

type ShopRecord = {
  shop_domain: string;
  access_token: string;
};

type UpdatePayload = {
  action: string;
  orderId: number;
  payload?: Record<string, unknown>;
  clerkUserId?: string;
  supabaseUserId?: string;
};

const DEFAULT_AUTOMATION = {
  order_updates: false,
  cancel_orders: false,
  automatic_refunds: false,
  historic_inbox_access: false,
};

function readBearerToken(req: Request): string {
  // Sikrer at vi har en gyldig Clerk session fra klienten
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw Object.assign(new Error("Manglende Clerk session token"), { status: 401 });
  }
  return match[1];
}

async function requireClerkUserId(req: Request): Promise<string> {
  if (!JWKS || !CLERK_JWT_ISSUER) {
    throw Object.assign(
      new Error("CLERK_JWT_ISSUER mangler – kan ikke verificere Clerk session."),
      { status: 500 },
    );
  }
  const token = readBearerToken(req);
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: CLERK_JWT_ISSUER,
  });
  const sub = payload?.sub;
  if (!sub || typeof sub !== "string") {
    throw Object.assign(new Error("Ugyldigt Clerk token – subject mangler."), { status: 401 });
  }
  return sub;
}

// Finder Supabase bruger-id via profils-tabellen så vi kan kigge i agent_automation
async function resolveSupabaseUserId(clerkUserId: string): Promise<string> {
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw Object.assign(
      new Error(`Kunne ikke slå Supabase-bruger op: ${error.message}`),
      { status: 500 },
    );
  }

  const supabaseUserId = data?.user_id;

  if (!supabaseUserId) {
    throw Object.assign(
      new Error("Ingen Supabase-bruger er tilknyttet denne Clerk-bruger."),
      { status: 404 },
    );
  }

  return supabaseUserId;
}

// Henter butiksdomæne og dekrypteret token til den aktuelle bruger
async function getShopForUser(clerkUserId: string): Promise<ShopRecord> {
  // Slår butikken op og dekrypterer tokenet inden vi kalder Shopify
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  const supabaseUserId = await resolveSupabaseUserId(clerkUserId);
  try {
    return await getShopCredentialsForUser({
      supabase,
      userId: supabaseUserId,
    });
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      status: 500,
    });
  }
}

// Slår automationsflagene op, så vi kan blokere ulovlige handlinger
async function fetchAutomationSettings(supabaseUserId: string) {
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  const { data, error } = await supabase
    .from("agent_automation")
    .select("order_updates, cancel_orders, automatic_refunds, historic_inbox_access")
    .eq("user_id", supabaseUserId)
    .maybeSingle();

  if (error) {
    console.warn("shopify-order-update: kunne ikke hente automation settings", error);
    return DEFAULT_AUTOMATION;
  }

  return {
    order_updates:
      typeof data?.order_updates === "boolean" ? data.order_updates : DEFAULT_AUTOMATION.order_updates,
    cancel_orders:
      typeof data?.cancel_orders === "boolean" ? data.cancel_orders : DEFAULT_AUTOMATION.cancel_orders,
    automatic_refunds:
      typeof data?.automatic_refunds === "boolean"
        ? data.automatic_refunds
        : DEFAULT_AUTOMATION.automatic_refunds,
    historic_inbox_access:
      typeof data?.historic_inbox_access === "boolean"
        ? data.historic_inbox_access
        : DEFAULT_AUTOMATION.historic_inbox_access,
  };
}

function shopifyUrl(shop: ShopRecord, path: string): string {
  // Bygger fuld URL til Shopify Admin API
  const domain = shop.shop_domain.replace(/^https?:\/\//, "");
  return `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/${path.replace(/^\/+/, "")}`;
}

async function shopifyRequest<T>(
  shop: ShopRecord,
  path: string,
  init: RequestInit,
): Promise<T> {
  // Generisk helper der kalder Shopify og returnerer JSON eller kaster fejl
  const response = await fetch(shopifyUrl(shop, path), {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shop.access_token,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    json = null;
  }

  if (!response.ok) {
    const message =
      (json as any)?.errors ??
      (json as any)?.error ??
      text ??
      `Shopify svarede med status ${response.status}.`;
    throw Object.assign(
      new Error(typeof message === "string" ? message : JSON.stringify(message)),
      { status: response.status },
    );
  }

  return json as T;
}

async function shopifyGraphql<T>(
  shop: ShopRecord,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const payload = await shopifyRequest<{
    data?: T;
    errors?: Array<{ message?: string }>;
  }>(shop, "graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw Object.assign(
      new Error(
        payload.errors
          .map((item) => item?.message || "GraphQL error")
          .filter(Boolean)
          .join("; "),
      ),
      { status: 400 },
    );
  }
  if (!payload?.data) {
    throw Object.assign(new Error("Shopify GraphQL returnerede ingen data."), { status: 400 });
  }
  return payload.data;
}

const toShopifyGid = (type: string, value: unknown) => {
  if (typeof value === "string" && value.startsWith("gid://")) return value;
  const numeric = asNumber(value);
  if (!numeric) return "";
  return `gid://shopify/${type}/${Math.trunc(numeric)}`;
};

function parseLineItemOperations(payload: Record<string, unknown> = {}) {
  const operationsRaw = Array.isArray(payload?.operations) ? payload.operations : [];
  const operations = operationsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const op = item as Record<string, unknown>;
      const type = asString(op.type).toLowerCase();
      if (!type) return null;
      const quantity = asNumber(op.quantity ?? op.qty);
      const lineItemId = toShopifyGid(
        "LineItem",
        op.lineItemId ?? op.line_item_id ?? op.id,
      );
      const variantId = toShopifyGid(
        "ProductVariant",
        op.variantId ?? op.variant_id,
      );
      if (type === "set_quantity" || type === "remove_line_item") {
        if (!lineItemId) return null;
        return {
          type,
          lineItemId,
          quantity:
            type === "remove_line_item"
              ? 0
              : Math.max(0, Math.trunc(quantity ?? 0)),
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
    .filter(Boolean) as Array<
    | { type: "set_quantity" | "remove_line_item"; lineItemId: string; quantity: number }
    | { type: "add_variant"; variantId: string; quantity: number }
  >;

  if (operations.length) return operations;

  const legacyLineItemId = toShopifyGid(
    "LineItem",
    payload?.lineItemId ?? payload?.line_item_id ?? payload?.id,
  );
  const legacyVariantId = toShopifyGid(
    "ProductVariant",
    payload?.variantId ?? payload?.variant_id,
  );
  const legacyQuantity = Math.max(
    0,
    Math.trunc(asNumber(payload?.quantity ?? payload?.qty) ?? 0),
  );
  const mode = asString(payload?.mode ?? payload?.operation).toLowerCase();
  if (legacyVariantId) {
    return [
      {
        type: "add_variant" as const,
        variantId: legacyVariantId,
        quantity: Math.max(1, legacyQuantity || 1),
      },
    ];
  }
  if (legacyLineItemId && mode === "remove") {
    return [{ type: "remove_line_item" as const, lineItemId: legacyLineItemId, quantity: 0 }];
  }
  if (legacyLineItemId && legacyQuantity >= 0) {
    return [
      {
        type: "set_quantity" as const,
        lineItemId: legacyLineItemId,
        quantity: legacyQuantity,
      },
    ];
  }
  return [];
}

function getMutationUserErrors(
  result: Record<string, unknown> | null | undefined,
  key: string,
) {
  const scope = result?.[key] as
    | { userErrors?: Array<{ message?: string }> }
    | undefined;
  const userErrors = Array.isArray(scope?.userErrors) ? scope.userErrors : [];
  if (!userErrors.length) return;
  throw Object.assign(
    new Error(
      userErrors
        .map((item) => item?.message || "Shopify user error")
        .filter(Boolean)
        .join("; "),
    ),
    { status: 400 },
  );
}

async function updateShippingAddress(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const shippingAddress = payload?.shipping_address ?? payload?.shippingAddress;
  if (!shippingAddress || typeof shippingAddress !== "object") {
    throw Object.assign(new Error("shippingAddress skal angives."), { status: 400 });
  }

  return shopifyRequest(shop, `orders/${orderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: orderId,
        shipping_address: shippingAddress,
      },
    }),
  });
}

async function cancelOrder(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const body: Record<string, unknown> = {};
  if ("reason" in payload) body.reason = payload.reason;
  if ("email" in payload) body.email = payload.email;
  if ("refund" in payload) body.refund = payload.refund;
  if ("restock" in payload) body.restock = payload.restock;

  return shopifyRequest(shop, `orders/${orderId}/cancel.json`, {
    method: "POST",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
}

async function addNote(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const note = typeof payload?.note === "string" ? payload.note : "";
  return shopifyRequest(shop, `orders/${orderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: orderId,
        note,
      },
    }),
  });
}

async function addTag(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const tag = typeof payload?.tag === "string" ? payload.tag.trim() : "";
  if (!tag) {
    throw Object.assign(new Error("tag skal udfyldes."), { status: 400 });
  }

  const current = await shopifyRequest<{ order?: { tags?: string } }>(
    shop,
    `orders/${orderId}.json`,
    { method: "GET" },
  );
  const existingTags = (current.order?.tags ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!existingTags.includes(tag)) existingTags.push(tag);

  return shopifyRequest(shop, `orders/${orderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: orderId,
        tags: existingTags.join(", "),
      },
    }),
  });
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function updateCustomerContact(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const email = asString(payload?.email);
  const phone = asString(payload?.phone);
  if (!email && !phone) {
    throw Object.assign(new Error("email eller phone skal angives."), { status: 400 });
  }
  return shopifyRequest(shop, `orders/${orderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: orderId,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      },
    }),
  });
}

async function resendConfirmationOrInvoice(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const to = asString(payload?.to_email ?? payload?.email);
  const customMessage = asString(payload?.message);
  return shopifyRequest(shop, `orders/${orderId}/send_invoice.json`, {
    method: "POST",
    body: JSON.stringify({
      invoice: {
        ...(to ? { to } : {}),
        ...(customMessage ? { custom_message: customMessage } : {}),
      },
    }),
  });
}

async function changeShippingMethod(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const title = asString(payload?.title ?? payload?.shipping_title);
  const price = asString(payload?.price);
  if (!title || !price) {
    throw Object.assign(new Error("shipping method kræver title og price."), { status: 400 });
  }
  const code = asString(payload?.code ?? payload?.shipping_code);
  const source = asString(payload?.source) || "manual";
  return shopifyRequest(shop, `orders/${orderId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      order: {
        id: orderId,
        shipping_lines: [{ title, price, ...(code ? { code } : {}), ...(source ? { source } : {}) }],
      },
    }),
  });
}

async function getPrimaryFulfillmentOrderId(shop: ShopRecord, orderId: number) {
  const payload = await shopifyRequest<{ fulfillment_orders?: Array<{ id?: number }> }>(
    shop,
    `orders/${orderId}/fulfillment_orders.json`,
    { method: "GET" },
  );
  const list = Array.isArray(payload?.fulfillment_orders) ? payload.fulfillment_orders : [];
  const firstId = asNumber(list[0]?.id);
  if (!firstId) {
    throw Object.assign(new Error("Ingen fulfillment order fundet for ordren."), { status: 404 });
  }
  return firstId;
}

async function holdOrReleaseFulfillment(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const mode = asString(payload?.mode ?? payload?.operation).toLowerCase() || "hold";
  const fulfillmentOrderId =
    asNumber(payload?.fulfillment_order_id ?? payload?.fulfillmentOrderId) ??
    (await getPrimaryFulfillmentOrderId(shop, orderId));
  if (mode === "release") {
    return shopifyRequest(shop, `fulfillment_orders/${fulfillmentOrderId}/release_hold.json`, {
      method: "POST",
    });
  }
  const reason = asString(payload?.reason);
  const reasonNotes = asString(payload?.reason_notes ?? payload?.note);
  const holdBody: Record<string, unknown> = {};
  if (reason) holdBody.reason = reason;
  if (reasonNotes) holdBody.reason_notes = reasonNotes;
  return shopifyRequest(shop, `fulfillment_orders/${fulfillmentOrderId}/hold.json`, {
    method: "POST",
    body: Object.keys(holdBody).length ? JSON.stringify({ fulfillment_hold: holdBody }) : undefined,
  });
}

async function editLineItems(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const operations = parseLineItemOperations(payload);
  if (!operations.length) {
    throw Object.assign(
      new Error(
        "Line item edits kræver payload.operations med set_quantity/remove_line_item/add_variant.",
      ),
      { status: 400 },
    );
  }

  const orderGid = toShopifyGid("Order", orderId);
  if (!orderGid) {
    throw Object.assign(new Error("Kunne ikke lave Shopify order gid."), { status: 400 });
  }

  const beginResult = await shopifyGraphql<{
    orderEditBegin?: {
      calculatedOrder?: { id?: string };
      userErrors?: Array<{ message?: string }>;
    };
  }>(
    shop,
    `mutation OrderEditBegin($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder { id }
        userErrors { message }
      }
    }`,
    { id: orderGid },
  );
  getMutationUserErrors(beginResult as unknown as Record<string, unknown>, "orderEditBegin");
  const calculatedOrderId = beginResult?.orderEditBegin?.calculatedOrder?.id;
  if (!calculatedOrderId) {
    throw Object.assign(new Error("orderEditBegin returnerede ikke calculatedOrder id."), {
      status: 400,
    });
  }

  for (const operation of operations) {
    if (operation.type === "add_variant") {
      const mutationResult = await shopifyGraphql<{
        orderEditAddVariant?: { userErrors?: Array<{ message?: string }> };
      }>(
        shop,
        `mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
          orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
            userErrors { message }
          }
        }`,
        {
          id: calculatedOrderId,
          variantId: operation.variantId,
          quantity: operation.quantity,
        },
      );
      getMutationUserErrors(mutationResult as unknown as Record<string, unknown>, "orderEditAddVariant");
      continue;
    }

    const mutationResult = await shopifyGraphql<{
      orderEditSetQuantity?: { userErrors?: Array<{ message?: string }> };
    }>(
      shop,
      `mutation SetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
          userErrors { message }
        }
      }`,
      {
        id: calculatedOrderId,
        lineItemId: operation.lineItemId,
        quantity: operation.quantity,
      },
    );
    getMutationUserErrors(mutationResult as unknown as Record<string, unknown>, "orderEditSetQuantity");
  }

  const staffNote = asString(payload?.edit_summary ?? payload?.summary ?? payload?.requested_changes);
  const commitResult = await shopifyGraphql<{
    orderEditCommit?: { order?: { id?: string }; userErrors?: Array<{ message?: string }> };
  }>(
    shop,
    `mutation CommitEdit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
        order { id }
        userErrors { message }
      }
    }`,
    {
      id: calculatedOrderId,
      notifyCustomer: false,
      ...(staffNote ? { staffNote } : {}),
    },
  );
  getMutationUserErrors(commitResult as unknown as Record<string, unknown>, "orderEditCommit");
  if (!commitResult?.orderEditCommit?.order?.id) {
    throw Object.assign(new Error("orderEditCommit returnerede ikke en opdateret ordre."), {
      status: 400,
    });
  }
  return commitResult;
}

async function refundOrder(
  shop: ShopRecord,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
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

  return shopifyRequest(shop, `orders/${orderId}/refunds.json`, {
    method: "POST",
    body: JSON.stringify({
      refund: {
        notify: true,
        ...(note ? { note } : {}),
        ...(reason ? { reason } : {}),
        ...(transactions.length ? { transactions } : {}),
      },
    }),
  });
}

async function handleAction(shop: ShopRecord, payload: UpdatePayload) {
  if (!payload.orderId || Number.isNaN(Number(payload.orderId))) {
    throw Object.assign(new Error("orderId skal angives."), { status: 400 });
  }

  switch (payload.action) {
    case "update_shipping_address":
      return updateShippingAddress(shop, Number(payload.orderId), payload.payload);
    case "change_shipping_method":
      return changeShippingMethod(shop, Number(payload.orderId), payload.payload);
    case "cancel_order":
      return cancelOrder(shop, Number(payload.orderId), payload.payload);
    case "refund_order":
      return refundOrder(shop, Number(payload.orderId), payload.payload);
    case "hold_or_release_fulfillment":
      return holdOrReleaseFulfillment(shop, Number(payload.orderId), payload.payload);
    case "edit_line_items":
      return editLineItems(shop, Number(payload.orderId), payload.payload);
    case "update_customer_contact":
      return updateCustomerContact(shop, Number(payload.orderId), payload.payload);
    case "resend_confirmation_or_invoice":
      return resendConfirmationOrInvoice(shop, Number(payload.orderId), payload.payload);
    case "add_note":
      return addNote(shop, Number(payload.orderId), payload.payload);
    case "add_tag":
      return addTag(shop, Number(payload.orderId), payload.payload);
    case "add_internal_note_or_tag":
      if (asString(payload?.payload?.tag)) {
        return addTag(shop, Number(payload.orderId), payload.payload);
      }
      return addNote(shop, Number(payload.orderId), payload.payload);
    default:
      throw Object.assign(
        new Error(`Uunderstøttet handling: ${payload.action ?? "ukendt"}`),
        { status: 400 },
      );
  }
}

// Simpel guard der sørger for at handlinger matcher automation-indstillingerne
function ensureActionAllowed(
  action: string,
  automation: {
    order_updates: boolean;
    cancel_orders: boolean;
    automatic_refunds: boolean;
    historic_inbox_access: boolean;
  },
) {
  const notAllowed = (reason: string) =>
    Object.assign(new Error(`Automatiseringen tillader ikke denne handling: ${reason}`), {
      status: 403,
    });

  switch (action) {
    case "update_shipping_address":
    case "change_shipping_method":
    case "hold_or_release_fulfillment":
    case "edit_line_items":
    case "update_customer_contact":
    case "resend_confirmation_or_invoice":
    case "add_note":
    case "add_tag":
    case "add_internal_note_or_tag":
      if (!automation.order_updates) {
        throw notAllowed("ordreopdateringer er deaktiveret.");
      }
      break;
    case "cancel_order":
      if (!automation.cancel_orders) {
        throw notAllowed("annulleringer er deaktiveret.");
      }
      break;
    case "refund_order":
      if (!automation.automatic_refunds) {
        throw notAllowed("automatiske refunds er deaktiveret.");
      }
      break;
    default:
      break;
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const callerClerkUserId = await requireClerkUserId(req);
    const payload = (await req.json().catch(() => ({}))) as UpdatePayload;

    if (!payload || typeof payload !== "object") {
      throw Object.assign(new Error("Body skal være JSON objekt."), { status: 400 });
    }

    const targetClerkUserId =
      typeof payload?.clerkUserId === "string" && payload.clerkUserId.length
        ? payload.clerkUserId
        : callerClerkUserId;

    const shop = await getShopForUser(targetClerkUserId);
    const supabaseUserId =
      typeof payload?.supabaseUserId === "string" && payload.supabaseUserId.length
        ? payload.supabaseUserId
        : await resolveSupabaseUserId(targetClerkUserId);
    const automation = await fetchAutomationSettings(supabaseUserId);

    ensureActionAllowed(payload.action, automation);
    const result = await handleAction(shop, payload);
    return Response.json({ ok: true, result });
  } catch (error) {
    const status = (error as any)?.status ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
});
