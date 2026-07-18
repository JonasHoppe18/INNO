export const ACTION_MODES = ["off", "approve", "auto"];

export const CORE_ACTIONS = [
  {
    type: "update_shipping_address",
    label: "Update shipping address",
    description: "Change the delivery address while the order is still unfulfilled.",
    autoAvailable: true,
  },
  {
    type: "cancel_order",
    label: "Cancel unfulfilled order",
    description: "Cancel an order only when Shopify confirms it has not been fulfilled.",
    autoAvailable: true,
  },
  {
    type: "refund_order",
    label: "Refund order",
    description: "Prepare a refund for the confirmed order and payment.",
    autoAvailable: false,
  },
  {
    type: "initiate_return",
    label: "Start return",
    description: "Create the return flow and prepare the store's return instructions.",
    autoAvailable: false,
  },
  {
    type: "create_exchange_request",
    label: "Exchange or replacement",
    description: "Create an exchange request for the confirmed product and order.",
    autoAvailable: false,
  },
];

export const DEFAULT_ACTION_MODES = {
  update_shipping_address: "approve",
  cancel_order: "approve",
  refund_order: "off",
  initiate_return: "off",
  create_exchange_request: "off",
};

const ACTION_ALIASES = {
  update_shipping_address: "update_shipping_address",
  cancel_order: "cancel_order",
  refund_order: "refund_order",
  initiate_return: "initiate_return",
  create_return_case: "initiate_return",
  send_return_instructions: "initiate_return",
  create_exchange_request: "create_exchange_request",
};

export function normalizeCoreActionType(type) {
  return ACTION_ALIASES[String(type || "").trim().toLowerCase()] || null;
}

export function canAutoExecuteAction(type) {
  const normalized = normalizeCoreActionType(type);
  return Boolean(CORE_ACTIONS.find((action) => action.type === normalized)?.autoAvailable);
}

export function isActionMode(value) {
  return ACTION_MODES.includes(value);
}

export function normalizeActionModes(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    CORE_ACTIONS.map((action) => {
      const requested = input[action.type];
      if (!isActionMode(requested)) {
        return [action.type, DEFAULT_ACTION_MODES[action.type]];
      }
      return [
        action.type,
        requested === "auto" && !action.autoAvailable ? "approve" : requested,
      ];
    })
  );
}

export function resolveActionMode(type, actionModes) {
  const normalized = normalizeCoreActionType(type);
  if (!normalized) return null;
  return normalizeActionModes(actionModes)[normalized];
}

export function validateActionModes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "action_modes must be an object." };
  }

  const known = new Set(CORE_ACTIONS.map((action) => action.type));
  for (const [type, mode] of Object.entries(value)) {
    if (!known.has(type)) {
      return { ok: false, error: `Unknown action type: ${type}.` };
    }
    if (!isActionMode(mode)) {
      return { ok: false, error: `Invalid mode for ${type}.` };
    }
    if (mode === "auto" && !canAutoExecuteAction(type)) {
      return { ok: false, error: `${type} cannot run automatically yet.` };
    }
  }

  return { ok: true, value: normalizeActionModes(value) };
}
