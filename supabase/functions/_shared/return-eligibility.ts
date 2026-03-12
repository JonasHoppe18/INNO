import type { ShopifyOrder } from "./shopify.ts";
import type { WorkspaceReturnSettings } from "./return-settings.ts";

export type ReturnEligibilityReason =
  | "within_return_window"
  | "outside_return_window"
  | "missing_delivery_date"
  | "missing_order_date"
  | "manual_review_required";

export type ReturnEligibilityResult = {
  eligible: boolean | null;
  reason: ReturnEligibilityReason;
  used_date_source: "delivery_date" | "order_date" | null;
  reference_date: string | null;
  days_since_reference: number | null;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function parseIsoDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function resolveDeliveryDate(order: ShopifyOrder | null): Date | null {
  if (!order || typeof order !== "object") return null;

  const directCandidates = [
    order.delivered_at,
    order.delivery_date,
    order.deliveryDate,
    order.webshipper_tracking?.delivered_at,
    order.webshipper_tracking?.last_event?.occurred_at,
  ];
  for (const candidate of directCandidates) {
    const parsed = parseIsoDate(candidate);
    if (parsed) return parsed;
  }

  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  for (const fulfillment of fulfillments) {
    const parsed = parseIsoDate(
      fulfillment?.delivered_at || fulfillment?.deliveredAt || fulfillment?.delivery_date,
    );
    if (parsed) return parsed;
  }

  return null;
}

function resolveOrderDate(order: ShopifyOrder | null): Date | null {
  if (!order || typeof order !== "object") return null;
  const candidates = [order.created_at, order.processed_at, order.updated_at, order.closed_at];
  for (const candidate of candidates) {
    const parsed = parseIsoDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function floorDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function evaluateReturnEligibility(options: {
  settings: WorkspaceReturnSettings | null;
  order: ShopifyOrder | null;
  now?: Date;
}): ReturnEligibilityResult {
  const now = options.now instanceof Date ? options.now : new Date();
  const settings = options.settings;
  if (!settings || !Number.isFinite(Number(settings.return_window_days))) {
    return {
      eligible: null,
      reason: "manual_review_required",
      used_date_source: null,
      reference_date: null,
      days_since_reference: null,
    };
  }
  const windowDays = Math.max(1, Math.trunc(Number(settings.return_window_days)));

  const deliveryDate = resolveDeliveryDate(options.order);
  if (deliveryDate) {
    const ageDays = floorDaysBetween(deliveryDate, now);
    return {
      eligible: ageDays <= windowDays,
      reason: ageDays <= windowDays ? "within_return_window" : "outside_return_window",
      used_date_source: "delivery_date",
      reference_date: deliveryDate.toISOString(),
      days_since_reference: ageDays,
    };
  }

  const orderDate = resolveOrderDate(options.order);
  if (orderDate) {
    const ageDays = floorDaysBetween(orderDate, now);
    return {
      eligible: ageDays <= windowDays,
      reason: ageDays <= windowDays ? "within_return_window" : "outside_return_window",
      used_date_source: "order_date",
      reference_date: orderDate.toISOString(),
      days_since_reference: ageDays,
    };
  }

  return {
    eligible: null,
    reason: options.order ? "missing_order_date" : "manual_review_required",
    used_date_source: null,
    reference_date: null,
    days_since_reference: null,
  };
}
