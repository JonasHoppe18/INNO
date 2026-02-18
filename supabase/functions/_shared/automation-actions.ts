import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getShopCredentialsForUser } from "./shopify-credentials.ts";

type AutomationSettings = {
  order_updates: boolean;
  cancel_orders: boolean;
  automatic_refunds: boolean;
  historic_inbox_access: boolean;
};

type ShopCredentials = {
  shop_domain: string;
  access_token: string;
};

export type AutomationAction = {
  type: string;
  orderId?: number;
  payload?: Record<string, unknown>;
};

export type AutomationResult = {
  type: string;
  ok: boolean;
  status?: "success" | "pending_approval" | "error";
  orderId?: number;
  payload?: Record<string, unknown>;
  detail?: string;
  error?: string;
};

type ExecuteOptions = {
  supabase: SupabaseClient | null;
  supabaseUserId: string | null;
  actions: AutomationAction[];
  automation: AutomationSettings;
  tokenSecret?: string | null;
  apiVersion: string;
  orderIdMap?: Record<string | number, number>;
};

// Henter Shopify domæne og token fra shops-tabellen og dekrypterer via ENCRYPTION_KEY
async function getShopCredentials(
  supabase: SupabaseClient,
  userId: string,
): Promise<ShopCredentials> {
  return await getShopCredentialsForUser({
    supabase,
    userId,
  });
}

// Returnerer begrundelse hvis handlingen kræver manuel godkendelse.
function getApprovalRequirement(action: string, automation: AutomationSettings): string | null {
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
        return "ordreopdateringer er deaktiveret.";
      }
      break;
    case "cancel_order":
      if (!automation.cancel_orders) {
        return "annulleringer er deaktiveret.";
      }
      break;
    case "refund_order":
      if (!automation.automatic_refunds) {
        return "automatiske refunds er deaktiveret.";
      }
      break;
    default:
      break;
  }
  return null;
}

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

// Normaliserer Shopify URL med korrekt versionering
function shopifyUrl(shop: ShopCredentials, path: string, apiVersion: string) {
  const domain = shop.shop_domain.replace(/^https?:\/\//, "");
  return `https://${domain}/admin/api/${apiVersion}/${path.replace(/^\/+/, "")}`;
}

// Wrapper fetch mod Shopify API med JSON parsing og fejlhåndtering
async function shopifyRequest<T>(
  shop: ShopCredentials,
  apiVersion: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(shopifyUrl(shop, path, apiVersion), {
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
  shop: ShopCredentials,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const payload = await shopifyRequest<{
    data?: T;
    errors?: Array<{ message?: string }>;
  }>(shop, apiVersion, "graphql.json", {
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

// Opdaterer shipping-adressen på en ordre i Shopify
async function updateShippingAddress(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const shippingAddress = payload?.shipping_address ?? payload?.shippingAddress;
  if (!shippingAddress || typeof shippingAddress !== "object") {
    throw Object.assign(new Error("shippingAddress skal angives."), { status: 400 });
  }

  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        order: {
          id: orderId,
          shipping_address: shippingAddress,
        },
      }),
    },
  );
}

// Annullerer en ordre og accepterer valgfrie refund/restock felter
async function cancelOrder(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const body: Record<string, unknown> = {};
  if ("reason" in payload) body.reason = payload.reason;
  if ("email" in payload) body.email = payload.email;
  if ("refund" in payload) body.refund = payload.refund;
  if ("restock" in payload) body.restock = payload.restock;

  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}/cancel.json`,
    {
      method: "POST",
      body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    },
  );
}

// Tilføjer en note til en ordre (ikke aktiveret i execute flowet)
async function addNote(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const note = typeof payload?.note === "string" ? payload.note : "";
  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        order: {
          id: orderId,
          note,
        },
      }),
    },
  );
}

// Tilføjer et tag til ordre (henter eksisterende tags først)
async function addTag(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const tag = typeof payload?.tag === "string" ? payload.tag.trim() : "";
  if (!tag) {
    throw Object.assign(new Error("tag skal udfyldes."), { status: 400 });
  }

  const current = await shopifyRequest<{ order?: { tags?: string } }>(
    shop,
    apiVersion,
    `orders/${orderId}.json`,
    { method: "GET" },
  );

  const existingTags = (current.order?.tags ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!existingTags.includes(tag)) existingTags.push(tag);

  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        order: {
          id: orderId,
          tags: existingTags.join(", "),
        },
      }),
    },
  );
}

async function updateCustomerContact(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const email = asString(payload?.email);
  const phone = asString(payload?.phone);
  if (!email && !phone) {
    throw Object.assign(new Error("email eller phone skal angives."), { status: 400 });
  }
  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        order: {
          id: orderId,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
      }),
    },
  );
}

async function resendConfirmationOrInvoice(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const to = asString(payload?.to_email ?? payload?.email);
  const customMessage = asString(payload?.message);
  const body: Record<string, unknown> = {
    invoice: {
      ...(to ? { to } : {}),
      ...(customMessage ? { custom_message: customMessage } : {}),
    },
  };
  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}/send_invoice.json`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

async function changeShippingMethod(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const title = asString(payload?.title ?? payload?.shipping_title);
  const code = asString(payload?.code ?? payload?.shipping_code);
  const source = asString(payload?.source) || "manual";
  const priceValue = payload?.price;
  const price =
    typeof priceValue === "number"
      ? String(priceValue)
      : typeof priceValue === "string"
      ? priceValue.trim()
      : "";
  if (!title || !price) {
    throw Object.assign(new Error("shipping method kræver title og price."), { status: 400 });
  }
  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        order: {
          id: orderId,
          shipping_lines: [
            {
              title,
              price,
              ...(code ? { code } : {}),
              ...(source ? { source } : {}),
            },
          ],
        },
      }),
    },
  );
}

async function getPrimaryFulfillmentOrderId(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
) {
  const payload = await shopifyRequest<{ fulfillment_orders?: Array<{ id?: number }> }>(
    shop,
    apiVersion,
    `orders/${orderId}/fulfillment_orders.json`,
    { method: "GET" },
  );
  const fulfillmentOrders = Array.isArray(payload?.fulfillment_orders)
    ? payload.fulfillment_orders
    : [];
  const firstId = asNumber(fulfillmentOrders[0]?.id);
  if (!firstId) {
    throw Object.assign(new Error("Ingen fulfillment order fundet for ordren."), { status: 404 });
  }
  return firstId;
}

async function holdOrReleaseFulfillment(
  shop: ShopCredentials,
  apiVersion: string,
  orderId: number,
  payload: Record<string, unknown> = {},
) {
  const mode = asString(payload?.mode ?? payload?.operation).toLowerCase() || "hold";
  const fulfillmentOrderId =
    asNumber(payload?.fulfillment_order_id ?? payload?.fulfillmentOrderId) ??
    (await getPrimaryFulfillmentOrderId(shop, apiVersion, orderId));
  if (mode === "release") {
    return shopifyRequest(
      shop,
      apiVersion,
      `fulfillment_orders/${fulfillmentOrderId}/release_hold.json`,
      { method: "POST" },
    );
  }
  const holdBody: Record<string, unknown> = {};
  const reason = asString(payload?.reason);
  const reasonNotes = asString(payload?.reason_notes ?? payload?.note);
  if (reason) holdBody.reason = reason;
  if (reasonNotes) holdBody.reason_notes = reasonNotes;
  return shopifyRequest(
    shop,
    apiVersion,
    `fulfillment_orders/${fulfillmentOrderId}/hold.json`,
    {
      method: "POST",
      body: Object.keys(holdBody).length ? JSON.stringify({ fulfillment_hold: holdBody }) : undefined,
    },
  );
}

async function editLineItems(
  shop: ShopCredentials,
  apiVersion: string,
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
    apiVersion,
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
        apiVersion,
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
      apiVersion,
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
    apiVersion,
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
  shop: ShopCredentials,
  apiVersion: string,
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

  return shopifyRequest(
    shop,
    apiVersion,
    `orders/${orderId}/refunds.json`,
    {
      method: "POST",
      body: JSON.stringify({
        refund: {
          notify: true,
          ...(note ? { note } : {}),
          ...(reason ? { reason } : {}),
          ...(transactions.length ? { transactions } : {}),
        },
      }),
    },
  );
}

// Dispatcher der mapper action.type til korrekt Shopify-kald
async function handleAction(
  shop: ShopCredentials,
  apiVersion: string,
  action: AutomationAction,
) {
  if (!action?.type) {
    throw Object.assign(new Error("Handling mangler type."), { status: 400 });
  }
  if (!action.orderId || Number.isNaN(Number(action.orderId))) {
    throw Object.assign(new Error("orderId skal angives."), { status: 400 });
  }
  const orderId = Number(action.orderId);
  switch (action.type) {
    case "update_shipping_address":
      return updateShippingAddress(shop, apiVersion, orderId, action.payload);
    case "change_shipping_method":
      return changeShippingMethod(shop, apiVersion, orderId, action.payload);
    case "cancel_order":
      return cancelOrder(shop, apiVersion, orderId, action.payload);
    case "refund_order":
      return refundOrder(shop, apiVersion, orderId, action.payload);
    case "hold_or_release_fulfillment":
      return holdOrReleaseFulfillment(shop, apiVersion, orderId, action.payload);
    case "edit_line_items":
      return editLineItems(shop, apiVersion, orderId, action.payload);
    case "update_customer_contact":
      return updateCustomerContact(shop, apiVersion, orderId, action.payload);
    case "resend_confirmation_or_invoice":
      return resendConfirmationOrInvoice(shop, apiVersion, orderId, action.payload);
    case "add_note":
      return addNote(shop, apiVersion, orderId, action.payload);
    case "add_tag":
      return addTag(shop, apiVersion, orderId, action.payload);
    case "add_internal_note_or_tag":
      if (asString(action.payload?.tag)) {
        return addTag(shop, apiVersion, orderId, action.payload);
      }
      return addNote(shop, apiVersion, orderId, action.payload);
    default:
      throw Object.assign(new Error(`Uunderstøttet handling: ${action.type}`), {
        status: 400,
      });
  }
}

// Kører automation-handlinger sekventielt og returnerer resultat pr. handling
export async function executeAutomationActions({
  supabase,
  supabaseUserId,
  actions,
  automation,
  tokenSecret,
  apiVersion,
  orderIdMap = {},
}: ExecuteOptions): Promise<AutomationResult[]> {
  const results: AutomationResult[] = [];
  if (!actions?.length) return results;
  if (!supabase || !supabaseUserId) {
    return actions.map((action) => ({
      type: action?.type ?? "ukendt",
      ok: false,
      error: "Shopify konfiguration mangler (supabase connection/user).",
    }));
  }

  let shop: ShopCredentials | null = null;
  try {
    void tokenSecret;
    shop = await getShopCredentials(supabase, supabaseUserId);
    console.log("automation: shop credentials resolved", {
      shop_domain: shop?.shop_domain,
      supabaseUserId,
    });
    console.log("automation: orderId map", orderIdMap);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return actions.map((action) => ({
      type: action?.type ?? "ukendt",
      ok: false,
      error: message,
    }));
  }

  for (const action of actions) {
    if (!action || typeof action.type !== "string") continue;
    try {
      const normalizedKey = String(action.orderId ?? "").replace("#", "");
      const resolvedId =
        orderIdMap[normalizedKey] ?? orderIdMap[String(action.orderId ?? "")];
      const orderIdToUse = resolvedId ?? action.orderId;

      if (!orderIdToUse || Number.isNaN(Number(orderIdToUse))) {
        console.warn("automation: missing order id mapping", {
          action,
          normalizedKey,
          availableKeys: Object.keys(orderIdMap),
        });
        throw new Error(
          `Order id mangler eller er ugyldigt for handlingen ${action.type}.`,
        );
      }

      console.log("automation: executing action", {
        type: action.type,
        orderId: orderIdToUse,
        shop_domain: shop?.shop_domain,
      });
      const approvalReason = getApprovalRequirement(action.type, automation);
      if (approvalReason) {
        let pendingDetail = "";
        if (action.type === "update_shipping_address") {
          const address = (action.payload?.shipping_address ?? action.payload?.shippingAddress) as Record<
            string,
            unknown
          >;
          const parts = [
            address?.address1,
            address?.address2,
            address?.zip || address?.postal_code,
            address?.city,
            address?.country,
          ]
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean);
          if (parts.length > 4) {
            parts.pop();
          }
          const name =
            typeof address?.name === "string" && address.name.trim() ? `${address.name.trim()}, ` : "";
          pendingDetail = parts.length
            ? `Updated shipping address to ${name}${parts.join(", ")}.`
            : "Updated shipping address.";
        } else if (action.type === "cancel_order") {
          pendingDetail = "Cancelled order.";
        } else if (action.type === "refund_order") {
          pendingDetail = "Refunded order.";
        } else if (action.type === "change_shipping_method") {
          pendingDetail = "Changed shipping method.";
        } else if (action.type === "hold_or_release_fulfillment") {
          const mode = asString(action.payload?.mode ?? action.payload?.operation).toLowerCase();
          pendingDetail = mode === "release" ? "Released fulfillment hold." : "Placed fulfillment on hold.";
        } else if (action.type === "edit_line_items") {
          pendingDetail = "Edited order line items.";
        } else if (action.type === "update_customer_contact") {
          pendingDetail = "Updated customer contact information.";
        } else if (action.type === "resend_confirmation_or_invoice") {
          pendingDetail = "Resent order confirmation/invoice.";
        } else if (action.type === "add_tag") {
          const tag = typeof action.payload?.tag === "string" ? action.payload.tag.trim() : "";
          pendingDetail = tag ? `Added tag "${tag}".` : "Added tag.";
        } else if (action.type === "add_note" || action.type === "add_internal_note_or_tag") {
          pendingDetail = "Updated order note.";
        }

        results.push({
          type: action.type,
          ok: false,
          status: "pending_approval",
          orderId: Number(orderIdToUse),
          payload: action.payload ?? {},
          detail: pendingDetail || `Pending approval for ${action.type.replace(/_/g, " ")}.`,
          error: `Automatiseringen tillader ikke denne handling: ${approvalReason}`,
        });
        continue;
      }
      await handleAction(shop, apiVersion, {
        ...action,
        orderId: Number(orderIdToUse),
      });
      let detail = "";
      if (action.type === "update_shipping_address") {
        const address = (action.payload?.shipping_address ?? action.payload?.shippingAddress) as Record<
          string,
          unknown
        >;
        const parts = [
          address?.address1,
          address?.address2,
          address?.zip || address?.postal_code,
          address?.city,
          address?.country,
        ]
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean);
        if (parts.length > 4) {
          parts.pop();
        }
        const name =
          typeof address?.name === "string" && address.name.trim() ? `${address.name.trim()}, ` : "";
        if (parts.length) {
          detail = `Updated shipping address to ${name}${parts.join(", ")}.`;
        }
      } else if (action.type === "add_tag") {
        const tag = typeof action.payload?.tag === "string" ? action.payload.tag.trim() : "";
        if (tag) detail = `Added tag "${tag}".`;
      } else if (action.type === "cancel_order") {
        const reason = typeof action.payload?.reason === "string" ? action.payload.reason.trim() : "";
        detail = reason ? `Cancelled order (reason: ${reason}).` : "Cancelled order.";
      } else if (action.type === "refund_order") {
        const amount = asNumber(action.payload?.amount);
        detail = amount ? `Refunded ${amount.toFixed(2)}.` : "Refunded order.";
      } else if (action.type === "change_shipping_method") {
        const title = asString(action.payload?.title ?? action.payload?.shipping_title);
        detail = title ? `Changed shipping method to "${title}".` : "Changed shipping method.";
      } else if (action.type === "hold_or_release_fulfillment") {
        const mode = asString(action.payload?.mode ?? action.payload?.operation).toLowerCase();
        detail = mode === "release" ? "Released fulfillment hold." : "Placed fulfillment on hold.";
      } else if (action.type === "edit_line_items") {
        detail = "Edited order line items.";
      } else if (action.type === "update_customer_contact") {
        detail = "Updated customer contact information.";
      } else if (action.type === "resend_confirmation_or_invoice") {
        detail = "Resent order confirmation/invoice.";
      } else if (action.type === "add_note" || action.type === "add_internal_note_or_tag") {
        detail = "Updated order note.";
      }

      results.push({
        type: action.type,
        ok: true,
        status: "success",
        orderId: Number(orderIdToUse),
        detail: detail || undefined,
      });
    } catch (err) {
      results.push({
        type: action.type,
        ok: false,
        status: "error",
        orderId: Number(action.orderId ?? 0) || undefined,
        detail: undefined,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
