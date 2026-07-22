export const MANUAL_ACTION_TYPES = [
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "initiate_return",
];

export const RETURN_REASONS = [
  "COLOR",
  "DEFECTIVE",
  "NOT_AS_DESCRIBED",
  "OTHER",
  "SIZE_TOO_LARGE",
  "SIZE_TOO_SMALL",
  "STYLE",
  "UNKNOWN",
  "UNWANTED",
  "WRONG_ITEM",
];

const asString = (value) => (typeof value === "string" ? value.trim() : "");

// Order ids from the customer-lookup payload can be numbers (Shopify's
// order_number / numeric order id), not just strings — unlike form text
// fields, which are always strings from the DOM.
const asIdString = (value) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const asPositiveNumber = (value) => {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(num) && num > 0 ? num : null;
};

export function resolveMatchedOrder(orders) {
  const list = Array.isArray(orders) ? orders : [];
  return list[0] || null;
}

export function buildManualActionInsert({ actionType, order, formPayload = {} }) {
  const type = asString(actionType);
  if (!MANUAL_ACTION_TYPES.includes(type)) {
    return { ok: false, error: `Unsupported manual action type: ${actionType}` };
  }

  const orderAdminId = asIdString(order?.adminId);
  const orderNumber = asIdString(order?.id);
  if (!orderAdminId || !orderNumber) {
    return { ok: false, error: "No matched order to act on." };
  }

  if (type === "update_shipping_address") {
    const address1 = asString(formPayload?.address1);
    const zip = asString(formPayload?.zip);
    const city = asString(formPayload?.city);
    const country = asString(formPayload?.country);
    if (!address1 || !zip || !city || !country) {
      return { ok: false, error: "Address line 1, zip, city and country are required." };
    }
    const name = asString(formPayload?.name);
    const address2 = asString(formPayload?.address2);
    return {
      ok: true,
      insert: {
        action_type: "update_shipping_address",
        order_id: orderAdminId,
        order_number: orderNumber,
        payload: {
          shipping_address: {
            ...(name ? { name } : {}),
            address1,
            ...(address2 ? { address2 } : {}),
            zip,
            city,
            country,
          },
        },
      },
    };
  }

  if (type === "cancel_order") {
    return {
      ok: true,
      insert: {
        action_type: "cancel_order",
        order_id: orderAdminId,
        order_number: orderNumber,
        payload: {},
      },
    };
  }

  if (type === "refund_order") {
    const amount = asPositiveNumber(formPayload?.amount);
    if (!amount) {
      return { ok: false, error: "A refund amount greater than 0 is required." };
    }
    const note = asString(formPayload?.note);
    return {
      ok: true,
      insert: {
        action_type: "refund_order",
        order_id: orderAdminId,
        order_number: orderNumber,
        payload: { amount, ...(note ? { note } : {}) },
      },
    };
  }

  // type === "initiate_return"
  const reason = asString(formPayload?.reason).toUpperCase();
  if (!RETURN_REASONS.includes(reason)) {
    return { ok: false, error: "A valid return reason is required." };
  }
  const note = asString(formPayload?.note);
  return {
    ok: true,
    insert: {
      // The execution route branches on the legacy literal "create_return_case",
      // not the CORE_ACTIONS alias "initiate_return" — see accept/route.js.
      action_type: "create_return_case",
      order_id: orderAdminId,
      order_number: orderNumber,
      payload: { reason, ...(note ? { note } : {}) },
    },
  };
}
