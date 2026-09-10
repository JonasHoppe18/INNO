import type { JsonObject, SensitiveAction, ToolExecutionResult } from "./types";

export type ToolSensitivity = "read_only" | "proposed_action";

export interface StrictToolDefinition {
  type: "function";
  name: string;
  description: string;
  strict: true;
  sensitivity: ToolSensitivity;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

type Property = { type: string; description: string; enum?: string[]; items?: Property; properties?: Record<string, Property> };

function readOnly(name: string, description: string, properties: Record<string, Property> = {}, required = Object.keys(properties)): StrictToolDefinition {
  return {
    type: "function",
    name,
    description,
    strict: true,
    sensitivity: "read_only",
    parameters: { type: "object", properties, required, additionalProperties: false },
  };
}

function proposed(name: string, description: string, properties: Record<string, Property>): StrictToolDefinition {
  return { ...readOnly(name, description, properties), sensitivity: "proposed_action" };
}

const stringProperty = (description: string): Property => ({ type: "string", description });

/**
 * A destination/country question is not an address-change request. Keep this
 * boundary deterministic so the model cannot turn a policy question into a
 * proposed order mutation just because the customer says "my order".
 */
export function isExplicitAddressChangeRequest(message: string): boolean {
  const text = String(message ?? "").replace(/[\u2019]/g, "'").trim();
  if (!text) return false;
  return /\b(?:change|modify|update|correct|edit|fix|replace|switch|set|move|amend)\b[\s\S]{0,100}\b(?:shipping|delivery|mailing|billing)?\s*address\b/i.test(text)
    || /\b(?:shipping|delivery|mailing|billing)?\s*address\b[\s\S]{0,100}\b(?:change|modify|update|correct|edit|fix|replace|switch|set|move|amend)\b/i.test(text)
    || /\b(?:wrong|incorrect)\s+(?:shipping|delivery|mailing|billing)?\s*address\b/i.test(text)
    || /\b(?:entered|typed|gave|provided)\b[\s\S]{0,40}\b(?:wrong|incorrect)\b[\s\S]{0,40}\b(?:shipping|delivery|mailing|billing)?\s*address\b/i.test(text);
}

export const GREENFIELD_TOOL_DEFINITIONS: StrictToolDefinition[] = [
  readOnly("search_policy", "Find authoritative tenant policy relevant to the customer question.", { query: stringProperty("The policy question in customer language.") }),
  readOnly("search_product_knowledge", "Search product and reference knowledge: specifications, features, compatibility, usage, manuals, and descriptive facts. Do not use this for troubleshooting, setup, pairing, reset, or other step-by-step support procedures; use search_procedures instead.", { query: stringProperty("The product fact, specification, compatibility, or descriptive question in customer language; exclude troubleshooting and how-to procedures.") }),
  readOnly("search_historical_cases", "Find solved support cases as examples. Results are not business policy.", { query: stringProperty("The support situation to use for examples.") }),
  readOnly("get_brand_guidance", "Find tenant-specific communication guidance for the reply.", { query: stringProperty("The communication decision needing guidance.") }),
  readOnly("search_procedures", "Search merchant-authored step-by-step procedures for troubleshooting, setup, pairing, reset, configuration, and support handling. Use this when the customer asks how to fix, configure, perform, or handle something; include the product or model when known.", { query: stringProperty("The troubleshooting, setup, how-to, or support-procedure request in customer language, including known product or model context when available.") }),
  readOnly("get_order", "Read one current order by customer-provided order number or platform order ID.", { order_id: stringProperty("The order number or order ID supplied by the customer.") }),
  readOnly("get_order_history", "Read the current customer's recent order history. Customer identity comes from trusted server context.", {}),
  readOnly("get_customer", "Read the current customer's limited support identity. Identity comes from trusted server context.", {}),
  readOnly("get_product", "Read current product information from the commerce provider.", { query: stringProperty("Product name, handle, SKU, or other customer-provided product reference.") }),
  readOnly("get_product_availability", "Read the current availability state for a product or an unambiguous variant. This returns only normalized availability, never exact inventory quantities.", { query: stringProperty("Product name, handle, SKU, or a specific variant reference supplied by the customer.") }),
  readOnly("inspect_fulfillment", "For item-level questions about which item shipped, was fulfilled, or was delivered, read current fulfillment details after verifying the order. This includes source-bound order-line-item membership and quantity for each fulfillment when Shopify provides it; get_order and get_tracking alone cannot identify the item. Fulfillment mapping does not by itself prove physical delivery.", { order_id: stringProperty("The order number or order ID.") }),
  readOnly("get_tracking", "Read current shipment tracking for a tracking number verified against the current customer's Shopify order.", { tracking_number: stringProperty("The tracking number from a verified current-customer order or an explicitly supplied customer tracking reference.") }),
  proposed("cancel_order", "Propose cancellation of an order. This capability never executes the cancellation.", { order_id: stringProperty("The order number or order ID."), reason: stringProperty("Customer's stated reason for requesting cancellation.") }),
  proposed("update_address", "Propose an address update for an existing order. Use only when the customer explicitly asks to change or correct that address; do not use this for shipping-country, destination, or delivery-policy questions. This capability never changes customer or order data.", { order_id: stringProperty("The order number or order ID."), address: stringProperty("The complete new address supplied by the customer."), reason: stringProperty("Why the address needs to change.") }),
  proposed("create_return", "Propose a return. This capability never creates a return.", { order_id: stringProperty("The order number or order ID."), item_ids: { type: "array", description: "Line item IDs to return.", items: stringProperty("A line item ID.") }, reason: stringProperty("Customer's stated return reason.") }),
  proposed("create_refund", "Propose a refund. This capability never issues money or modifies an order.", { order_id: stringProperty("The order number or order ID."), amount: stringProperty("Requested amount, if known; do not invent an amount."), reason: stringProperty("Reason for the requested refund.") }),
  proposed("send_replacement", "Propose a replacement. This capability never creates a shipment.", { order_id: stringProperty("The order number or order ID."), item_id: stringProperty("Line item ID to replace."), reason: stringProperty("Reason a replacement is requested.") }),
];

export const READ_ONLY_TOOL_NAMES = new Set(
  GREENFIELD_TOOL_DEFINITIONS.filter((tool) => tool.sensitivity === "read_only").map((tool) => tool.name),
);

export const PROPOSED_ACTION_TOOL_NAMES = new Set(
  GREENFIELD_TOOL_DEFINITIONS.filter((tool) => tool.sensitivity === "proposed_action").map((tool) => tool.name),
);

const SENSITIVE_ACTIONS = new Set<SensitiveAction>([
  "cancel_order",
  "update_address",
  "create_return",
  "create_refund",
  "send_replacement",
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateProperty(value: unknown, property: Property): boolean {
  if (property.type === "string") return typeof value === "string";
  if (property.type === "array") return Array.isArray(value) && value.every((item) => property.items && validateProperty(item, property.items));
  return true;
}

/** Runtime validation mirrors the strict model schema and rejects tenant escape hatches. */
export function parseToolArguments(toolName: string, rawArguments: string): { ok: true; value: JsonObject } | { ok: false; result: ToolExecutionResult } {
  const definition = GREENFIELD_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
  if (!definition) return { ok: false, result: { status: "invalid_arguments", error: { code: "unknown_tool", message: `Unknown capability: ${toolName}` } } };
  let value: unknown;
  try {
    value = JSON.parse(rawArguments || "{}");
  } catch {
    return { ok: false, result: { status: "invalid_arguments", error: { code: "invalid_json", message: "Tool arguments were not valid JSON." } } };
  }
  if (!isObject(value)) return { ok: false, result: { status: "invalid_arguments", error: { code: "object_required", message: "Tool arguments must be an object." } } };
  const forbiddenKeys = ["tenant_id", "workspace_id", "shop_id", "access_token", "credentials", "authorization_scope"];
  if (Object.keys(value).some((key) => forbiddenKeys.includes(key))) {
    return { ok: false, result: { status: "invalid_arguments", error: { code: "trusted_context_argument", message: "Tenant and integration scope are trusted server context, not tool arguments." } } };
  }
  const propertyNames = Object.keys(definition.parameters.properties);
  const unknown = Object.keys(value).filter((key) => !propertyNames.includes(key));
  if (unknown.length) return { ok: false, result: { status: "invalid_arguments", error: { code: "unknown_argument", message: `Unknown tool argument: ${unknown[0]}` } } };
  for (const required of definition.parameters.required) {
    if (!(required in value)) return { ok: false, result: { status: "invalid_arguments", error: { code: "missing_argument", message: `Missing required argument: ${required}` } } };
  }
  for (const [key, property] of Object.entries(definition.parameters.properties) as Array<[string, Property]>) {
    if (key in value && !validateProperty(value[key], property)) return { ok: false, result: { status: "invalid_arguments", error: { code: "wrong_argument_type", message: `Invalid argument type: ${key}` } } };
  }
  if (PROPOSED_ACTION_TOOL_NAMES.has(toolName) && !SENSITIVE_ACTIONS.has(toolName as SensitiveAction)) {
    return { ok: false, result: { status: "error", error: { code: "action_configuration", message: "Sensitive capability is not configured as a known proposed action." } } };
  }
  return { ok: true, value };
}
