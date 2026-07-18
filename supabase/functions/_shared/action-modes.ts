export type ActionMode = "off" | "approve" | "auto";

export type CoreActionType =
  | "update_shipping_address"
  | "cancel_order"
  | "refund_order"
  | "initiate_return"
  | "create_exchange_request";

export type ActionModeConfig = {
  action_modes?: Partial<Record<CoreActionType, ActionMode>>;
  disabled_actions?: string[];
  address_change_auto?: boolean;
};

export type LegacyAutomationFlags = {
  order_updates?: boolean;
  cancel_orders?: boolean;
  automatic_refunds?: boolean;
};

export const DEFAULT_ACTION_MODES: Readonly<
  Record<CoreActionType, ActionMode>
> = {
  update_shipping_address: "approve",
  cancel_order: "approve",
  refund_order: "off",
  initiate_return: "off",
  create_exchange_request: "off",
};

// Only actions with a complete, deterministic executor and a live-state guard
// may run without a person. Refunds need amount/line-item limits, while returns
// and exchanges still rely on the approval workflow.
export const AUTO_EXECUTABLE_ACTIONS: ReadonlySet<CoreActionType> = new Set([
  "update_shipping_address",
  "cancel_order",
]);

const CORE_ACTION_ALIASES: Readonly<Record<string, CoreActionType>> = {
  update_shipping_address: "update_shipping_address",
  cancel_order: "cancel_order",
  refund_order: "refund_order",
  initiate_return: "initiate_return",
  create_return_case: "initiate_return",
  send_return_instructions: "initiate_return",
  create_exchange_request: "create_exchange_request",
};

export function normalizeCoreActionType(type: string): CoreActionType | null {
  return CORE_ACTION_ALIASES[String(type || "").trim().toLowerCase()] ?? null;
}

export function isActionMode(value: unknown): value is ActionMode {
  return value === "off" || value === "approve" || value === "auto";
}

export function canAutoExecuteAction(type: string): boolean {
  const coreType = normalizeCoreActionType(type);
  return coreType ? AUTO_EXECUTABLE_ACTIONS.has(coreType) : false;
}

export function resolveActionMode(
  type: string,
  config: ActionModeConfig = {},
  _legacyAutomation: LegacyAutomationFlags = {},
): ActionMode | null {
  const coreType = normalizeCoreActionType(type);
  if (!coreType) return null;

  if (
    Array.isArray(config.disabled_actions) &&
    config.disabled_actions.some((item) =>
      normalizeCoreActionType(item) === coreType
    )
  ) {
    return "off";
  }

  const configuredMode = config.action_modes?.[coreType];
  if (isActionMode(configuredMode)) {
    return configuredMode === "auto" && !AUTO_EXECUTABLE_ACTIONS.has(coreType)
      ? "approve"
      : configuredMode;
  }

  // Legacy booleans only controlled proposal routing; they never executed the
  // external mutation. Promoting them to real Auto would silently broaden
  // existing permissions, so every shop must opt in through action_modes.
  return DEFAULT_ACTION_MODES[coreType];
}

export function normalizeActionModes(
  value: unknown,
): Record<CoreActionType, ActionMode> {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return Object.fromEntries(
    (Object.keys(DEFAULT_ACTION_MODES) as CoreActionType[]).map((type) => {
      const mode = input[type];
      if (!isActionMode(mode)) return [type, DEFAULT_ACTION_MODES[type]];
      return [
        type,
        mode === "auto" && !AUTO_EXECUTABLE_ACTIONS.has(type)
          ? "approve"
          : mode,
      ];
    }),
  ) as Record<CoreActionType, ActionMode>;
}
