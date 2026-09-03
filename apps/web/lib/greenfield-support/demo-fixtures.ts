import { InMemoryCommerceProvider, InMemoryTrackingProvider } from "./providers";
import { InMemoryKnowledgeStore } from "./knowledge";

export const DEMO_TENANT = {
  workspaceId: "greenfield-demo-workspace",
  shopId: "greenfield-demo-shop",
  customerEmail: "customer@example.test",
  customerName: "Alex Customer",
};

export async function createDemoDependencies() {
  const knowledge = new InMemoryKnowledgeStore();
  const sources = [
    {
      sourceKind: "return_policy",
      sourceId: "policy-returns-v1",
      title: "Returns and exchanges",
      content: "Customers may request a return within 30 days of delivery. Items should be unused and in their original packaging. Start a return by sharing the order number and the item to return; support will provide the next steps. Return shipping is covered when the item is defective or the wrong item was sent.",
      structuredData: { return_window_days: 30, return_condition: "unused_original_packaging" },
      publishedAt: "2026-08-01T00:00:00.000Z",
      sourceLabel: "Merchant returns policy",
    },
    {
      sourceKind: "warranty_policy",
      sourceId: "policy-warranty-v1",
      title: "Warranty coverage",
      content: "The merchant provides a 24-month warranty for manufacturing defects from the delivery date. Accidental damage and ordinary wear are reviewed separately. Ask for the order number, a short description, and clear photos before proposing a replacement or repair.",
      structuredData: { warranty_months: 24 },
      publishedAt: "2026-08-01T00:00:00.000Z",
      sourceLabel: "Merchant warranty policy",
    },
    {
      sourceKind: "policy",
      sourceId: "policy-refunds-v1",
      title: "Refund timing",
      content: "After an eligible returned item is received and approved, the refund is normally processed within 5 business days. The customer's bank or payment provider may take additional time to display the funds. Do not promise an exact bank posting date.",
      structuredData: { refund_processing_business_days: 5 },
      publishedAt: "2026-08-01T00:00:00.000Z",
      sourceLabel: "Merchant refund policy",
    },
    {
      sourceKind: "shipping_policy",
      sourceId: "policy-shipping-v1",
      title: "Shipping and dispatch",
      content: "Orders normally leave the warehouse within 1–2 business days. Carrier delivery estimates begin after dispatch and can change when a shipment has an exception. The current order and carrier status must be checked live before giving a shipment update.",
      structuredData: { dispatch_window_business_days: 2 },
      publishedAt: "2026-08-01T00:00:00.000Z",
      sourceLabel: "Merchant shipping policy",
    },
    {
      sourceKind: "procedure",
      sourceId: "procedure-damaged-item-v1",
      title: "Damaged item procedure",
      content: "For a damaged item, collect the order number, the affected item, and clear photos of the product and packaging. Check warranty and return policy before proposing a replacement. Do not promise a replacement until the support team confirms eligibility.",
      sourceLabel: "Support operations procedure",
    },
    {
      sourceKind: "procedure",
      sourceId: "procedure-cancellation-v1",
      title: "Cancellation procedure",
      content: "A cancellation can be reviewed before fulfillment. Look up the live order first. If the order has already shipped, explain that cancellation may no longer be possible and provide the return path instead.",
      sourceLabel: "Support operations procedure",
    },
    {
      sourceKind: "product_manual",
      sourceId: "product-orion-wireless-v1",
      title: "Orion Wireless headset",
      content: "The Orion Wireless headset supports Bluetooth and the included USB receiver. The receiver is intended for computers with a USB-A port; a compatible USB-C adapter may be used. Pairing, charging, and reset steps are documented in the setup guide. The headset is not compatible with arbitrary third-party receivers.",
      structuredData: { product: "Orion Wireless", receiver: "included USB receiver", usb_c_adapter: true },
      sourceLabel: "Orion Wireless setup guide",
    },
    {
      sourceKind: "product_catalog",
      sourceId: "product-orion-pads-v1",
      title: "Orion replacement ear pads",
      content: "Replacement ear pads are compatible with Orion Wireless and Orion Wired headsets. They are not compatible with the Nova speaker series.",
      structuredData: { compatible_with: ["Orion Wireless", "Orion Wired"], incompatible_with: ["Nova speaker"] },
      sourceLabel: "Product catalog",
    },
    {
      sourceKind: "brand_guidance",
      sourceId: "brand-tone-v1",
      title: "Customer communication guidance",
      content: "Use warm, direct language. Acknowledge inconvenience briefly, answer the question first, and avoid promising an outcome that still needs review. Prefer short paragraphs and a clear next step.",
      sourceLabel: "Brand voice guide",
    },
    {
      sourceKind: "historic_support",
      sourceId: "case-example-delayed-shipment-1",
      title: "Example: delayed shipment",
      content: "A previous customer with a delayed shipment was told that the carrier scan would be monitored and that support would investigate if the status did not move. This is an example of helpful phrasing, not a shipping policy or a current shipment fact.",
      sourceLabel: "Anonymized historical support example",
    },
  ];
  for (const source of sources) await knowledge.ingest(DEMO_TENANT.workspaceId, source);

  const orders = [
    { id: "shopify-10231", orderNumber: "10231", status: "fulfilled", financialStatus: "paid", fulfillmentStatus: "fulfilled", total: "149.00", currency: "EUR", items: [{ id: "line-10231", title: "Orion Wireless", quantity: 1 }], fulfillments: [{ id: "fulfillment-10231", status: "in_transit", carrier: "ParcelCo", trackingNumber: "PC10231", trackingUrl: "https://tracking.example.test/PC10231", shipmentStatus: "in_transit" }] },
    { id: "shopify-10232", orderNumber: "10232", status: "processing", financialStatus: "paid", fulfillmentStatus: null, total: "89.00", currency: "EUR", items: [{ id: "line-10232", title: "Orion Wired", quantity: 1 }], fulfillments: [] },
    { id: "shopify-10233", orderNumber: "10233", status: "fulfilled", financialStatus: "paid", fulfillmentStatus: "fulfilled", total: "149.00", currency: "EUR", items: [{ id: "line-10233", title: "Orion Wireless", quantity: 1 }], fulfillments: [{ id: "fulfillment-10233", status: "exception", carrier: "ParcelCo", trackingNumber: "PC10233", trackingUrl: "https://tracking.example.test/PC10233", shipmentStatus: "exception" }] },
    { id: "shopify-10234", orderNumber: "10234", status: "delivered", financialStatus: "paid", fulfillmentStatus: "fulfilled", total: "49.00", currency: "EUR", items: [{ id: "line-10234", title: "Orion replacement ear pads", quantity: 1 }], fulfillments: [{ id: "fulfillment-10234", status: "delivered", carrier: "ParcelCo", trackingNumber: "PC10234", trackingUrl: "https://tracking.example.test/PC10234", shipmentStatus: "delivered" }] },
  ];
  const tracking = orders.filter((order) => order.fulfillments.length).map((order) => ({ orderId: order.id, carrier: order.fulfillments[0].carrier, trackingNumber: order.fulfillments[0].trackingNumber, trackingUrl: order.fulfillments[0].trackingUrl, status: order.fulfillments[0].shipmentStatus, statusText: order.fulfillments[0].shipmentStatus, observedAt: "2026-09-03T08:00:00.000Z" }));
  const commerce = new InMemoryCommerceProvider({
    customer: { name: DEMO_TENANT.customerName, email: DEMO_TENANT.customerEmail },
    orders,
    tracking,
    products: [
      { query: "Orion Wireless", value: { product: "Orion Wireless", compatibility: "Bluetooth and included USB receiver; USB-C adapter supported", status: "active" } },
      { query: "Orion Wired", value: { product: "Orion Wired", compatibility: "Wired USB connection", status: "active" } },
      { query: "Orion replacement ear pads", value: { product: "Orion replacement ear pads", compatibility: "Orion Wireless and Orion Wired", status: "active" } },
    ],
  });
  return { tenant: DEMO_TENANT, knowledge, commerce, tracking: new InMemoryTrackingProvider(tracking) };
}
