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
  orderUpdates: false,
  cancelOrders: false,
  automaticRefunds: false,
  historicInboxAccess: false,
  learnFromEdits: false,
  autoDraftEnabled: false,
  draftDestination: "provider_inbox",
  minConfidence: 0.6,
};

const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() || "supabase";

export function useAgentAutomation(options = {}) {
  const { lazy = false, userId: providedUserId } = options;
  const supabase = useClerkSupabase();
  const { getToken, orgId } = useAuth();
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

  const ensureWorkspaceId = useCallback(async () => {
    if (!supabase || !user?.id) return null;

    if (orgId) {
      const { data: workspaceByOrg, error: orgError } = await supabase
        .from("workspaces")
        .select("id")
        .eq("clerk_org_id", orgId)
        .maybeSingle();
      if (!orgError && workspaceByOrg?.id) {
        return workspaceByOrg.id;
      }
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }
    return membership?.workspace_id ?? null;
  }, [supabase, user?.id, orgId]);

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
          : row.draft_destination === "provider_inbox" || row.draft_destination === "email_provider"
            ? "provider_inbox"
            : DEFAULT_AUTOMATION.draftDestination,
      minConfidence: row.min_confidence ?? DEFAULT_AUTOMATION.minConfidence,
    };
  }, []);

  const loadAutomation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const userId = await ensureUserId().catch(() => null);
      const workspaceId = await ensureWorkspaceId().catch(() => null);
      if (!userId && !workspaceId) {
        setSettings(DEFAULT_AUTOMATION);
        return DEFAULT_AUTOMATION;
      }

      let query = supabase.from("agent_automation").select("*");
      if (workspaceId) {
        query = query.eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1);
      } else if (userId) {
        query = query.eq("user_id", userId);
      }
      const { data, error: queryError } = await query.maybeSingle();
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
  }, [supabase, ensureUserId, ensureWorkspaceId, mapAutomation]);

  const saveAutomation = useCallback(
    async (updates) => {
      setSaving(true);
      setError(null);
      try {
        const userId = await ensureUserId().catch(() => null);
        const workspaceId = await ensureWorkspaceId().catch(() => null);
        if (!isValidUuid(userId)) {
          throw new Error("Supabase user ID is not ready yet.");
        }
        const basePayload = {
          order_updates: updates.orderUpdates ?? settings.orderUpdates,
          cancel_orders: updates.cancelOrders ?? settings.cancelOrders,
          automatic_refunds: updates.automaticRefunds ?? settings.automaticRefunds,
          historic_inbox_access: updates.historicInboxAccess ?? settings.historicInboxAccess,
          learn_from_edits: updates.learnFromEdits ?? settings.learnFromEdits,
          auto_draft_enabled: updates.autoDraftEnabled ?? settings.autoDraftEnabled,
          draft_destination: updates.draftDestination ?? settings.draftDestination,
          min_confidence: updates.minConfidence ?? settings.minConfidence,
          updated_at: new Date().toISOString(),
        };

        let persisted = null;

        // Workspace mode: keep one shared row per workspace.
        if (workspaceId) {
          const { data: existingWorkspaceRow, error: existingWorkspaceError } = await supabase
            .from("agent_automation")
            .select("user_id")
            .eq("workspace_id", workspaceId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existingWorkspaceError) throw existingWorkspaceError;

          const { data: existingUserRow, error: existingUserError } = await supabase
            .from("agent_automation")
            .select("user_id")
            .eq("user_id", userId)
            .maybeSingle();
          if (existingUserError) throw existingUserError;

          if (existingWorkspaceRow?.user_id) {
            const { data, error: updateError } = await supabase
              .from("agent_automation")
              .update({ ...basePayload, workspace_id: workspaceId })
              .eq("user_id", existingWorkspaceRow.user_id)
              .select()
              .maybeSingle();
            if (updateError) throw updateError;
            persisted = data;
          } else if (existingUserRow?.user_id) {
            // Legacy row already exists for this user_id; convert it into the workspace row.
            const { data, error: updateError } = await supabase
              .from("agent_automation")
              .update({ ...basePayload, workspace_id: workspaceId })
              .eq("user_id", userId)
              .select()
              .maybeSingle();
            if (updateError) throw updateError;
            persisted = data;
          } else {
            const { data, error: insertError } = await supabase
              .from("agent_automation")
              .insert({ ...basePayload, user_id: userId, workspace_id: workspaceId })
              .select()
              .maybeSingle();
            if (insertError) throw insertError;
            persisted = data;
          }
        } else {
          const { data, error: upsertError } = await supabase
            .from("agent_automation")
            .upsert({ ...basePayload, user_id: userId, workspace_id: null }, { onConflict: "user_id" })
            .select()
            .maybeSingle();
          if (upsertError) throw upsertError;
          persisted = data;
        }

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

        setSettings(mapAutomation(persisted));
        return persisted;
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("Could not save automation settings.")
        );
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [ensureUserId, ensureWorkspaceId, settings, supabase, mapAutomation]
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
