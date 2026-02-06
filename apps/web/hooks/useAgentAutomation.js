import { useAuth, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const base64UrlToBase64 = (input) => {
  if (typeof input !== "string" || !input.length) {
    return "";
  }
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized.padEnd(normalized.length + padding, "=");
};

const decodeBase64 = (input) => {
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    if (char === "=") break;
    const value = base64Alphabet.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      result += String.fromCharCode(byte);
    }
  }
  return result;
};

const decodeJwtPayload = (token) => {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [, payloadPart] = token.split(".");
  if (!payloadPart) return null;
  try {
    const normalized = base64UrlToBase64(payloadPart);
    const decoded = decodeBase64(normalized);
    return JSON.parse(decoded);
  } catch (_err) {
    return null;
  }
};

const DEFAULT_AUTOMATION = {
  orderUpdates: true,
  cancelOrders: true,
  automaticRefunds: false,
  historicInboxAccess: false,
  learnFromEdits: false,
  autoDraftEnabled: false,
  draftDestination: "email_provider",
};

const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() || "supabase";

export function useAgentAutomation(options = {}) {
  const { lazy = false, userId: providedUserId } = options;
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [settings, setSettings] = useState(DEFAULT_AUTOMATION);
  const [loading, setLoading] = useState(!lazy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const resolveUserIdFromToken = useCallback(async () => {
    if (typeof getToken !== "function") return null;
    try {
      const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
      const payload = decodeJwtPayload(templateToken);
      if (!payload) return null;
      const claim = payload?.supabase_user_id;
      if (isValidUuid(claim)) return claim;
      const sub = payload?.sub;
      if (isValidUuid(sub)) return sub;
    } catch (_err) {
      return null;
    }
    return null;
  }, [getToken]);

  const ensureUserId = useCallback(async () => {
    if (providedUserId) return providedUserId;

    const metadataId = user?.publicMetadata?.supabase_uuid;
    if (isValidUuid(metadataId)) {
      return metadataId;
    }

    const tokenId = await resolveUserIdFromToken();
    if (tokenId) return tokenId;

    if (!supabase || !user?.id) {
      throw new Error("Supabase user ID is not ready yet.");
    }

    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (isValidUuid(data?.user_id)) {
      return data.user_id;
    }

    throw new Error("Supabase user ID is not ready yet.");
  }, [providedUserId, user?.publicMetadata?.supabase_uuid, resolveUserIdFromToken, supabase, user?.id]);

  const mapAutomation = useCallback((row) => {
    if (!row) return DEFAULT_AUTOMATION;
    return {
      orderUpdates: row.order_updates ?? DEFAULT_AUTOMATION.orderUpdates,
      cancelOrders: row.cancel_orders ?? DEFAULT_AUTOMATION.cancelOrders,
      automaticRefunds: row.automatic_refunds ?? DEFAULT_AUTOMATION.automaticRefunds,
      historicInboxAccess: row.historic_inbox_access ?? DEFAULT_AUTOMATION.historicInboxAccess,
      learnFromEdits: row.learn_from_edits ?? DEFAULT_AUTOMATION.learnFromEdits,
      autoDraftEnabled: row.auto_draft_enabled ?? DEFAULT_AUTOMATION.autoDraftEnabled,
      draftDestination:
        row.draft_destination === "sona_inbox"
          ? "sona_inbox"
          : DEFAULT_AUTOMATION.draftDestination,
    };
  }, []);

  const loadAutomation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const userId = await ensureUserId().catch(() => null);
      if (!userId) {
        setSettings(DEFAULT_AUTOMATION);
        return DEFAULT_AUTOMATION;
      }

      const { data, error: queryError } = await supabase
        .from("agent_automation")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (queryError) throw queryError;
      const mapped = mapAutomation(data);
      setSettings(mapped);
      return mapped;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load automation settings."));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [supabase, ensureUserId, mapAutomation]);

  const saveAutomation = useCallback(
    async (updates) => {
      setSaving(true);
      setError(null);
      try {
        const userId = await ensureUserId().catch(() => null);
        if (!isValidUuid(userId)) {
          throw new Error("Supabase user ID is not ready yet.");
        }
        const payload = {
          user_id: userId,
          order_updates: updates.orderUpdates ?? settings.orderUpdates,
          cancel_orders: updates.cancelOrders ?? settings.cancelOrders,
          automatic_refunds: updates.automaticRefunds ?? settings.automaticRefunds,
          historic_inbox_access: updates.historicInboxAccess ?? settings.historicInboxAccess,
          learn_from_edits: updates.learnFromEdits ?? settings.learnFromEdits,
          auto_draft_enabled: updates.autoDraftEnabled ?? settings.autoDraftEnabled,
          draft_destination: updates.draftDestination ?? settings.draftDestination,
        };

        const { data, error: upsertError } = await supabase
          .from("agent_automation")
          .upsert(payload, { onConflict: "user_id" })
          .select()
          .maybeSingle();

        if (upsertError) throw upsertError;

        if (Object.prototype.hasOwnProperty.call(updates, "autoDraftEnabled")) {
          const res = await fetch("/api/agent/auto-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: Boolean(updates.autoDraftEnabled) }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(payload?.error || "Could not update mail account status.");
          }
        }

        setSettings(mapAutomation(data));
        return data;
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("Could not save automation settings.")
        );
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [ensureUserId, settings, supabase, mapAutomation]
  );

  useEffect(() => {
    if (!lazy) {
      loadAutomation().catch(() => null);
    }
  }, [lazy, loadAutomation]);

  return useMemo(
    () => ({
      settings,
      loading,
      saving,
      error,
      refresh: loadAutomation,
      save: saveAutomation,
      defaults: DEFAULT_AUTOMATION,
    }),
    [settings, loading, saving, error, loadAutomation, saveAutomation]
  );
}
