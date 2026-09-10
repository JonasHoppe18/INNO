function asId(value) {
  if (value == null) return null;
  const id = String(value).trim();
  return id || null;
}

function asAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function asCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function humanizeReturnReason(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return raw ? raw.replace(/\b\w/g, (character) => character.toUpperCase()) : null;
}

export function shopifyGidToId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/\/([^/]+)$/);
  return asId(match?.[1] || raw);
}

export function mapShopifyOrderFact(payload, { workspaceId, shopId, syncedAt = new Date().toISOString() }) {
  const externalOrderId = asId(payload?.id);
  const orderCreatedAt = payload?.created_at || payload?.processed_at;
  if (!workspaceId || !shopId || !externalOrderId || !orderCreatedAt) return null;

  return {
    workspace_id: workspaceId,
    shop_id: shopId,
    external_order_id: externalOrderId,
    order_number: asId(payload?.order_number ?? payload?.name),
    order_created_at: orderCreatedAt,
    total_amount: asAmount(payload?.current_total_price ?? payload?.total_price),
    currency: asCurrency(payload?.presentment_currency ?? payload?.currency),
    financial_status: String(payload?.financial_status || "").trim() || null,
    cancelled_at: payload?.cancelled_at || null,
    synced_at: syncedAt,
  };
}

export function mapShopifyRefundFact(payload, { workspaceId, shopId, syncedAt = new Date().toISOString() }) {
  const externalRefundId = asId(payload?.id);
  const externalOrderId = asId(payload?.order_id);
  const refundedAt = payload?.processed_at || payload?.created_at;
  if (!workspaceId || !shopId || !externalRefundId || !externalOrderId || !refundedAt) return null;

  const transactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
  const successfulRefunds = transactions.filter((transaction) => {
    const kind = String(transaction?.kind || "refund").toLowerCase();
    const status = String(transaction?.status || "success").toLowerCase();
    return kind === "refund" && status === "success";
  });
  const transactionAmounts = successfulRefunds
    .map((transaction) => asAmount(transaction?.amount))
    .filter((amount) => amount != null);

  const refundLines = Array.isArray(payload?.refund_line_items) ? payload.refund_line_items : [];
  const items = refundLines.map((row) => {
    const subtotal = asAmount(row?.subtotal) ?? 0;
    const tax = asAmount(row?.total_tax) ?? 0;
    return {
      external_line_item_id: asId(row?.line_item_id ?? row?.line_item?.id),
      external_product_id: asId(row?.line_item?.product_id),
      quantity: Math.max(1, Number.parseInt(row?.quantity, 10) || 1),
      amount: Number((subtotal + tax).toFixed(2)),
    };
  });

  const itemTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  const amount = transactionAmounts.length
    ? transactionAmounts.reduce((sum, value) => sum + value, 0)
    : itemTotal || null;
  const currency = asCurrency(
    successfulRefunds[0]?.currency
      ?? refundLines[0]?.subtotal_set?.shop_money?.currency_code
      ?? payload?.currency,
  );

  return {
    refund: {
      workspace_id: workspaceId,
      shop_id: shopId,
      external_refund_id: externalRefundId,
      external_order_id: externalOrderId,
      refunded_at: refundedAt,
      amount: amount == null ? null : Number(amount.toFixed(2)),
      currency,
      synced_at: syncedAt,
    },
    items,
  };
}

/**
 * Map the small subset of a Shopify GraphQL Return that is useful for
 * analytics. Return notes and the raw GraphQL payload are intentionally not
 * persisted.
 */
export function mapShopifyReturnFact(payload, { workspaceId, shopId, externalOrderId, syncedAt = new Date().toISOString() }) {
  const externalReturnId = shopifyGidToId(payload?.id);
  const orderId = asId(externalOrderId ?? shopifyGidToId(payload?.orderId));
  const returnedAt = payload?.createdAt || payload?.updatedAt;
  if (!workspaceId || !shopId || !externalReturnId || !orderId || !returnedAt) return null;

  const lineItems = Array.isArray(payload?.returnLineItems)
    ? payload.returnLineItems
    : Array.isArray(payload?.returnLineItems?.edges)
      ? payload.returnLineItems.edges.map((edge) => edge?.node)
      : [];
  const items = lineItems
    .map((item) => {
      const reasonHandle = String(item?.returnReasonDefinition?.handle || item?.returnReason || "").trim().toLowerCase() || null;
      const reason = String(item?.returnReasonDefinition?.name || "").trim() || humanizeReturnReason(item?.returnReason);
      return {
        external_line_item_id: shopifyGidToId(item?.id),
        quantity: Math.max(1, Number.parseInt(item?.quantity, 10) || 1),
        reason_handle: reasonHandle,
        reason,
      };
    })
    .filter((item) => item.external_line_item_id || item.reason || item.reason_handle);

  return {
    return: {
      workspace_id: workspaceId,
      shop_id: shopId,
      external_return_id: externalReturnId,
      external_order_id: orderId,
      returned_at: returnedAt,
      status: String(payload?.status || "").trim().toLowerCase() || null,
      synced_at: syncedAt,
    },
    items,
  };
}
