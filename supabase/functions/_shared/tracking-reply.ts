import type { TrackingDetail, TrackingSnapshot } from "./tracking.ts";

export const detectTrackingIntent = (subject: string, body: string) => {
  const input = `${subject || ""}\n${body || ""}`.toLowerCase();
  const hints = [
    "hvor er min ordre",
    "status på ordre",
    "tracking",
    "track and trace",
    "where is my order",
    "where's my order",
    "when will i receive",
    "delivery status",
    "not received",
    "out for delivery",
    "delivered but not received",
    "hvornår modtager jeg",
    "ikke modtaget",
    "leveret men ikke modtaget",
  ];
  if (hints.some((hint) => input.includes(hint))) return true;
  return /(receive|delivery|track)\s+my\s+order/i.test(input);
};

export const pickOrderTrackingKey = (order: any): string | null =>
  (order?.id ? String(order.id) : null) ||
  (order?.order_number ? String(order.order_number) : null) ||
  (order?.name ? String(order.name) : null);

export const buildTrackingReplyFallback = (options: {
  customerFirstName: string;
  order: any;
  tracking: TrackingDetail | null;
  threadKey?: string;
}) => {
  const customer = options.customerFirstName || "there";
  const orderLabel = options.order?.name || `#${options.order?.order_number || ""}` || "order";
  const tracking = options.tracking;
  const seed = hashString(
    `${options.threadKey || ""}|${options.order?.id || options.order?.order_number || ""}|${orderLabel}`,
  );

  if (!tracking) {
    return [
      `Hi ${customer},`,
      "",
      `I've checked your order ${orderLabel}, but I can't see a new tracking update yet.`,
      "As soon as tracking updates, I can share a more precise status.",
      "",
      "If the parcel has not arrived within a couple of days, we'll gladly investigate with the carrier.",
      "",
      "God dag.",
    ].join("\n");
  }

  const composed = composeTrackingReplyBody({
    customer,
    orderLabel,
    tracking,
    seed,
  });

  const trackLine = tracking.trackingUrl
    ? tracking.trackingUrl
    : "Tracking link is not available yet.";

  return [
    `Hi ${customer},`,
    "",
    composed.mainLine,
    composed.optionalStatusLine,
    composed.pickupPointLine,
    "",
    `Tracking number: ${tracking.trackingNumber}`,
    "",
    `You can follow the parcel here: ${trackLine}`,
    "",
    composed.reassuranceLine,
    "",
    "God dag.",
  ]
    .filter(Boolean)
    .join("\n");
};

export async function buildTrackingReplySameLanguage(options: {
  customerMessage: string;
  customerFirstName?: string;
  order: any;
  tracking: TrackingDetail | null;
  threadKey?: string;
}): Promise<string | null> {
  const customer = String(options.customerFirstName || "").trim() || "there";
  const orderLabel = options.order?.name || `#${options.order?.order_number || ""}` || "order";
  const seed = hashString(
    `${options.threadKey || ""}|${options.customerMessage || ""}|${options.order?.id || orderLabel}`,
  );

  if (!options.tracking) {
    return buildTrackingReplyFallback({
      customerFirstName: customer,
      order: options.order,
      tracking: null,
      threadKey: options.threadKey,
    });
  }

  const composed = composeTrackingReplyBody({
    customer,
    orderLabel,
    tracking: options.tracking,
    seed,
  });
  const trackLine = options.tracking.trackingUrl
    ? options.tracking.trackingUrl
    : "Tracking link is not available yet.";
  return [
    `Hi ${customer},`,
    "",
    composed.mainLine,
    composed.optionalStatusLine,
    composed.pickupPointLine,
    "",
    `Tracking number: ${options.tracking.trackingNumber}`,
    "",
    `You can follow the parcel here: ${trackLine}`,
    "",
    composed.reassuranceLine,
    "",
    "God dag.",
  ]
    .filter(Boolean)
    .join("\n");
}

function hashString(value: string): number {
  let hash = 0;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickVariant(seed: number, variants: string[]) {
  if (!variants.length) return "";
  return variants[seed % variants.length];
}

function formatIsoForReply(value?: string | null): { text: string; isToday: boolean } | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { text: raw, isToday: false };
  try {
    const datePart = date.toLocaleDateString("en-CA", {
      timeZone: "Europe/Copenhagen",
    });
    const nowPart = new Date().toLocaleDateString("en-CA", {
      timeZone: "Europe/Copenhagen",
    });
    const timePart = date.toLocaleTimeString("en-GB", {
      timeZone: "Europe/Copenhagen",
      hour: "2-digit",
      minute: "2-digit",
    });
    if (datePart === nowPart) {
      return { text: `today at ${timePart}`, isToday: true };
    }
    const full = date.toLocaleString("en-GB", {
      timeZone: "Europe/Copenhagen",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    return { text: full, isToday: false };
  } catch {
    return { text: date.toISOString(), isToday: false };
  }
}

function inferState(snapshot: TrackingSnapshot | null, statusText: string) {
  const code = String(snapshot?.statusCode || "").toLowerCase();
  const lower = String(statusText || "").toLowerCase();
  if (
    code.includes("delivered") ||
    lower.includes("delivered") ||
    lower.includes("leveret")
  ) {
    return "delivered";
  }
  if (
    code.includes("out_for_delivery") ||
    lower.includes("out for delivery") ||
    lower.includes("ude til levering")
  ) {
    return "out_for_delivery";
  }
  if (
    code.includes("pickup") ||
    code.includes("collect") ||
    lower.includes("pickup") ||
    lower.includes("pakkeshop") ||
    lower.includes("afhent")
  ) {
    return "pickup_ready";
  }
  if (
    code.includes("exception") ||
    code.includes("delay") ||
    lower.includes("delay") ||
    lower.includes("forsink") ||
    lower.includes("exception")
  ) {
    return "exception";
  }
  return "in_transit";
}

function formatPickupPoint(snapshot: TrackingSnapshot | null): string {
  const point = snapshot?.pickupPoint;
  if (!point) return "";
  const name = String(point?.name || "").trim();
  const address = [point?.address, point?.postalCode, point?.city, point?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  if (name && address) return `${name} (${address})`;
  return name || address || "";
}

function composeTrackingReplyBody(options: {
  customer: string;
  orderLabel: string;
  tracking: TrackingDetail;
  seed: number;
}) {
  const { orderLabel, tracking, seed } = options;
  const snapshot = tracking?.snapshot || null;
  const state = inferState(snapshot, tracking?.statusText || "");
  const deliveredAt = formatIsoForReply(snapshot?.deliveredAt || tracking?.lastEventAt || "");
  const outForDeliveryAt = formatIsoForReply(snapshot?.outForDeliveryAt || tracking?.lastEventAt || "");
  const pickupReadyAt = formatIsoForReply(snapshot?.pickupReadyAt || tracking?.lastEventAt || "");
  const pickupPoint = formatPickupPoint(snapshot);

  const inTransitLines = [
    `Your order ${orderLabel} has been shipped and is on the way.`,
    `Your order ${orderLabel} is on its way to you.`,
    `Your order ${orderLabel} is in transit.`,
  ];
  const deliveredLines = [
    `Your order ${orderLabel} has been delivered.`,
    `Tracking shows your order ${orderLabel} is delivered.`,
    `Your order ${orderLabel} is marked as delivered.`,
  ];
  const outForDeliveryLines = [
    `Your order ${orderLabel} is out for delivery today.`,
    `Your order ${orderLabel} is currently out for delivery.`,
    `Good news - your order ${orderLabel} is out for delivery.`,
  ];
  const pickupReadyLines = [
    `Your order ${orderLabel} is ready for pickup.`,
    `Your order ${orderLabel} can now be collected.`,
    `Your order ${orderLabel} is waiting for pickup.`,
  ];
  const exceptionLines = [
    `Your order ${orderLabel} has a delivery delay.`,
    `There is a temporary delivery issue on order ${orderLabel}.`,
    `Your order ${orderLabel} has an exception in transit.`,
  ];

  let mainLine = pickVariant(seed, inTransitLines);
  let optionalStatusLine = "";
  let pickupPointLine = "";
  let reassuranceLine =
    "If it does not move within 2 business days, we can investigate it with the carrier.";

  if (state === "delivered") {
    mainLine = pickVariant(seed, deliveredLines);
    if (deliveredAt) {
      optionalStatusLine = deliveredAt.isToday
        ? `Delivered today at ${deliveredAt.text.replace(/^today at\s*/i, "")}.`
        : `Delivered at: ${deliveredAt.text}.`;
    }
    reassuranceLine =
      "If you have not received it, let us know and we will start an investigation right away.";
  } else if (state === "out_for_delivery") {
    mainLine = pickVariant(seed, outForDeliveryLines);
    if (outForDeliveryAt) {
      optionalStatusLine = outForDeliveryAt.isToday
        ? `Latest scan today at ${outForDeliveryAt.text.replace(/^today at\s*/i, "")}.`
        : `Latest scan: ${outForDeliveryAt.text}.`;
    }
    reassuranceLine = "If it is not delivered by end of day, we can investigate with the carrier.";
  } else if (state === "pickup_ready") {
    mainLine = pickVariant(seed, pickupReadyLines);
    if (pickupReadyAt) {
      optionalStatusLine = pickupReadyAt.isToday
        ? `Ready for pickup today at ${pickupReadyAt.text.replace(/^today at\s*/i, "")}.`
        : `Ready since: ${pickupReadyAt.text}.`;
    }
    if (pickupPoint) pickupPointLine = `Pickup point: ${pickupPoint}.`;
    reassuranceLine =
      "If pickup details look incorrect, tell us and we will investigate with the carrier.";
  } else if (state === "exception") {
    mainLine = pickVariant(seed, exceptionLines);
    const statusText = String(tracking?.statusText || "").trim();
    if (statusText) optionalStatusLine = `Latest update: ${statusText.replace(/\.$/, "")}.`;
  }

  return {
    mainLine,
    optionalStatusLine,
    pickupPointLine,
    reassuranceLine,
  };
}
