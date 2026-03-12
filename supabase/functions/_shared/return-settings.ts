import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ReturnShippingMode = "customer_paid" | "merchant_label" | "pre_printed";

export type WorkspaceReturnSettings = {
  workspace_id: string;
  return_window_days: number;
  return_shipping_mode: ReturnShippingMode;
  return_address: string | null;
  require_original_packaging: boolean;
  require_unused: boolean;
  exchange_allowed: boolean;
};

const DEFAULT_SETTINGS = {
  return_window_days: 30,
  return_shipping_mode: "customer_paid" as ReturnShippingMode,
  return_address: null as string | null,
  require_original_packaging: true,
  require_unused: true,
  exchange_allowed: true,
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const asPositiveIntOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const int = Math.trunc(parsed);
  if (int <= 0) return null;
  return int;
};

function mapPolicyShippingToMode(value: unknown): ReturnShippingMode {
  const normalized = asString(value).toLowerCase();
  if (normalized === "customer") return "customer_paid";
  if (normalized === "merchant") return "merchant_label";
  if (normalized === "pre_printed") return "pre_printed";
  return DEFAULT_SETTINGS.return_shipping_mode;
}

function normalizeSettingsRow(
  workspaceId: string,
  row: Record<string, unknown> | null,
): WorkspaceReturnSettings {
  const returnWindowDays =
    asPositiveIntOrNull(row?.return_window_days) ?? DEFAULT_SETTINGS.return_window_days;
  const shippingModeRaw = asString(row?.return_shipping_mode).toLowerCase();
  const returnShippingMode: ReturnShippingMode =
    shippingModeRaw === "customer_paid" ||
    shippingModeRaw === "merchant_label" ||
    shippingModeRaw === "pre_printed"
      ? shippingModeRaw
      : DEFAULT_SETTINGS.return_shipping_mode;
  const returnAddress = asString(row?.return_address) || null;
  return {
    workspace_id: workspaceId,
    return_window_days: returnWindowDays,
    return_shipping_mode: returnShippingMode,
    return_address: returnAddress,
    require_original_packaging:
      typeof row?.require_original_packaging === "boolean"
        ? row.require_original_packaging
        : DEFAULT_SETTINGS.require_original_packaging,
    require_unused:
      typeof row?.require_unused === "boolean"
        ? row.require_unused
        : DEFAULT_SETTINGS.require_unused,
    exchange_allowed:
      typeof row?.exchange_allowed === "boolean"
        ? row.exchange_allowed
        : DEFAULT_SETTINGS.exchange_allowed,
  };
}

export function buildSettingsFromPolicySummary(
  workspaceId: string,
  policySummary: Record<string, unknown> | null,
): WorkspaceReturnSettings {
  const summary = policySummary && typeof policySummary === "object" ? policySummary : {};
  const returnWindowDays =
    asPositiveIntOrNull(summary.return_window_days) ?? DEFAULT_SETTINGS.return_window_days;
  const returnShippingMode = mapPolicyShippingToMode(summary.return_shipping_paid_by);
  const returnAddress = asString(summary.return_address) || null;
  return {
    workspace_id: workspaceId,
    return_window_days: returnWindowDays,
    return_shipping_mode: returnShippingMode,
    return_address: returnAddress,
    require_original_packaging: DEFAULT_SETTINGS.require_original_packaging,
    require_unused: DEFAULT_SETTINGS.require_unused,
    exchange_allowed: DEFAULT_SETTINGS.exchange_allowed,
  };
}

export async function ensureWorkspaceReturnSettings(options: {
  supabase: SupabaseClient | null;
  workspaceId: string | null;
}): Promise<WorkspaceReturnSettings | null> {
  const { supabase, workspaceId } = options;
  if (!supabase || !workspaceId) return null;

  const { data: existing, error: existingError } = await supabase
    .from("workspace_return_settings")
    .select(
      "workspace_id, return_window_days, return_shipping_mode, return_address, require_original_packaging, require_unused, exchange_allowed",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existingError) {
    console.warn("return-settings: failed loading workspace_return_settings", existingError.message);
    return null;
  }
  if (existing) {
    return normalizeSettingsRow(workspaceId, existing as Record<string, unknown>);
  }

  const { data: shopRow, error: shopError } = await supabase
    .from("shops")
    .select("policy_summary_json")
    .eq("workspace_id", workspaceId)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shopError) {
    console.warn("return-settings: failed loading policy summary", shopError.message);
  }

  const settings = buildSettingsFromPolicySummary(
    workspaceId,
    shopRow?.policy_summary_json && typeof shopRow.policy_summary_json === "object"
      ? (shopRow.policy_summary_json as Record<string, unknown>)
      : null,
  );

  const nowIso = new Date().toISOString();
  const insertRow = {
    workspace_id: workspaceId,
    return_window_days: settings.return_window_days,
    return_shipping_mode: settings.return_shipping_mode,
    return_address: settings.return_address,
    require_original_packaging: settings.require_original_packaging,
    require_unused: settings.require_unused,
    exchange_allowed: settings.exchange_allowed,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("workspace_return_settings")
    .insert(insertRow)
    .select(
      "workspace_id, return_window_days, return_shipping_mode, return_address, require_original_packaging, require_unused, exchange_allowed",
    )
    .maybeSingle();
  if (insertError) {
    console.warn("return-settings: insert failed", insertError.message);
    return settings;
  }
  return normalizeSettingsRow(workspaceId, (inserted as Record<string, unknown>) || insertRow);
}
