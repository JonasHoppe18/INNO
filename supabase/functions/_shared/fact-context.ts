import type { Automation } from "./agent-context.ts";

export type FactContext = {
  version: 1;
  selected_order: {
    id: number | null;
    name: string | null;
    order_number: string | null;
    fulfillment_status: string | null;
    financial_status: string | null;
    cancelled_at: string | null;
    closed_at: string | null;
  } | null;
  order_count: number;
  matched_subject_number: string | null;
  capabilities: {
    order_updates_enabled: boolean;
    cancel_orders_enabled: boolean;
    automatic_refunds_enabled: boolean;
    historic_inbox_access_enabled: boolean;
  };
  order_match_confidence: "high" | "medium" | "low";
  summary: string;
};

type RetrieveFactContextInput = {
  selectedOrder?: Record<string, unknown> | null;
  orders?: Array<Record<string, unknown>>;
  matchedSubjectNumber?: string | null;
  automation?: Automation | null;
};

function asOrderIdentifier(order: Record<string, unknown> | null | undefined) {
  if (!order) return null;
  return String(order.name || order.order_number || order.id || "").trim() || null;
}

export function retrieveFactContext(input: RetrieveFactContextInput): FactContext {
  const selectedOrder = input.selectedOrder || null;
  const orderIdentifier = asOrderIdentifier(selectedOrder);
  const matchedSubjectNumber = String(input.matchedSubjectNumber || "").trim() || null;
  const orderNumber = selectedOrder?.order_number != null
    ? String(selectedOrder.order_number)
    : selectedOrder?.name != null
    ? String(selectedOrder.name).replace(/^#/, "")
    : null;
  const orderMatchConfidence =
    selectedOrder && matchedSubjectNumber && orderNumber === matchedSubjectNumber
      ? "high"
      : selectedOrder
      ? "medium"
      : "low";

  return {
    version: 1,
    selected_order: selectedOrder
      ? {
          id: Number(selectedOrder.id ?? 0) || null,
          name: String(selectedOrder.name || "").trim() || null,
          order_number: orderNumber,
          fulfillment_status: String(selectedOrder.fulfillment_status || "").trim() || null,
          financial_status: String(selectedOrder.financial_status || "").trim() || null,
          cancelled_at: String(selectedOrder.cancelled_at || "").trim() || null,
          closed_at: String(selectedOrder.closed_at || "").trim() || null,
        }
      : null,
    order_count: Array.isArray(input.orders) ? input.orders.length : 0,
    matched_subject_number: matchedSubjectNumber,
    capabilities: {
      order_updates_enabled: Boolean(input.automation?.order_updates),
      cancel_orders_enabled: Boolean(input.automation?.cancel_orders),
      automatic_refunds_enabled: Boolean(input.automation?.automatic_refunds),
      historic_inbox_access_enabled: Boolean(input.automation?.historic_inbox_access),
    },
    order_match_confidence: orderMatchConfidence,
    summary: orderIdentifier ? `Selected order ${orderIdentifier}` : "No selected order",
  };
}
