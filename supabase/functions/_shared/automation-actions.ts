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
  orderId?: number;
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

// Sikrer at handlingen er tilladt ud fra automation-settings
function ensureActionAllowed(action: string, automation: AutomationSettings) {
  const deny = (reason: string) =>
    Object.assign(new Error(`Automatiseringen tillader ikke denne handling: ${reason}`), {
      status: 403,
    });
  switch (action) {
    case "update_shipping_address":
    case "add_tag":
      if (!automation.order_updates) {
        throw deny("ordreopdateringer er deaktiveret.");
      }
      break;
    case "cancel_order":
      if (!automation.cancel_orders) {
        throw deny("annulleringer er deaktiveret.");
      }
      break;
    default:
      break;
  }
}

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
    case "cancel_order":
      return cancelOrder(shop, apiVersion, orderId, action.payload);
    case "add_tag":
      return addTag(shop, apiVersion, orderId, action.payload);
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
    if (action.type === "add_note") {
      console.log("automation: skipping add_note action indtil funktionen aktiveres");
      continue;
    }
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
      ensureActionAllowed(action.type, automation);
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
      }

      results.push({
        type: action.type,
        ok: true,
        orderId: Number(orderIdToUse),
        detail: detail || undefined,
      });
    } catch (err) {
      results.push({
        type: action.type,
        ok: false,
        orderId: Number(action.orderId ?? 0) || undefined,
        detail: undefined,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
