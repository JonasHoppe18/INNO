// Single source of truth for the integrations we advertise. Both the landing
// page row (components/landing/IntegrationsSection.jsx) and the /integrations
// page render from this list, so adding one is a one-line change here.
//
// Accuracy rules:
//  - Only list what actually works as `available`. Anything not built yet is
//    `roadmap` and renders visibly as "coming soon".
//  - Gmail/Outlook are deliberately absent: per CLAUDE.md their pollers are
//    legacy and not in use — inbound email runs through Postmark forwarding,
//    which is what the generic "Email" entry covers.
//
// `name` is a proper noun and stays untranslated. The description is looked up
// in messages as `landing.integrationsPage.<id>Body`, so every entry needs that
// key in both locales (the messages parity test guards it).

export const INTEGRATION_STATUSES = ["available", "roadmap"];

export const INTEGRATIONS = [
  { id: "shopify", name: "Shopify", category: "ecommerce", status: "available" },
  { id: "webshipper", name: "Webshipper", category: "logistics", status: "available" },
  { id: "email", name: "Email", category: "email", status: "available" },
  { id: "zendesk", name: "Zendesk", category: "helpdesk", status: "available" },
  { id: "freshdesk", name: "Freshdesk", category: "helpdesk", status: "available" },
  { id: "gorgias", name: "Gorgias", category: "helpdesk", status: "available" },
  { id: "woocommerce", name: "WooCommerce", category: "ecommerce", status: "roadmap" },
  { id: "magento", name: "Magento", category: "ecommerce", status: "roadmap" },
];

export function integrationsByStatus(status) {
  return INTEGRATIONS.filter((integration) => integration.status === status);
}

export function integrationBodyKey(integration) {
  return `${integration.id}Body`;
}
