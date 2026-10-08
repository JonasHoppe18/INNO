"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { useScopedReadResource } from "@/hooks/useScopedReadResource";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { normalizeSupportLanguage } from "@/lib/translation/languages";
import { missingResourceUrls, resourcePayload, resourcesFromBootstrap, withResource } from "@/lib/settings/resource-map";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMPTY_WORKSPACE = {
  workspaceId: null,
  shopId: null,
  shopDomain: "",
  supabaseUserId: null,
  workspaceName: "Sona Team",
  supportLanguage: "en",
};

const FETCH_OPTIONS = { method: "GET", cache: "no-store", credentials: "include" };

const SettingsWorkspaceContext = createContext(null);

export function useSettingsWorkspace() {
  const value = useContext(SettingsWorkspaceContext);
  if (!value) throw new Error("useSettingsWorkspace must be used inside SettingsWorkspaceProvider.");
  return value;
}

async function readEntry(readResponse, url) {
  try {
    const response = await readResponse(url, FETCH_OPTIONS);
    return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, payload: {} };
  }
}

// Loads who-am-I (workspace, shop, members) and every settings resource once per
// visit, so switching sections renders synchronously from memory.
export function SettingsWorkspaceProvider({ children }) {
  const { ready: readsReady, readResponse } = useScopedReadResource();
  const supabase = useClerkSupabase();
  const { user } = useUser();
  const { orgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(EMPTY_WORKSPACE);
  const [resources, setResources] = useState({});
  const [members, setMembers] = useState([]);
  const [currentRole, setCurrentRole] = useState("");
  const [canManageMembers, setCanManageMembers] = useState(false);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const loadToken = ++loadRef.current;
    if (!readsReady) return;
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const bootstrapResponse = await readResponse("/api/settings/bootstrap", FETCH_OPTIONS).catch(() => null);
      const bootstrap = bootstrapResponse?.ok ? await bootstrapResponse.json() : null;
      if (loadToken !== loadRef.current) return;
      const nextResources = resourcesFromBootstrap(bootstrap);

      let serverMembersPayload = {};
      let hasServerMembers = false;
      if (user?.id) {
        const entry = nextResources["/api/settings/members"] || await readEntry(readResponse, "/api/settings/members");
        if ([401, 403, 404].includes(entry.status)) {
          throw new Error("Workspace settings are not available for this session.");
        }
        if (entry.ok) {
          hasServerMembers = true;
          serverMembersPayload = entry.payload || {};
          nextResources["/api/settings/members"] = entry;
        }
      }

      if (loadToken !== loadRef.current) return;
      let supabaseUserId = serverMembersPayload?.supabase_user_id || null;
      const metadataUuid = user?.publicMetadata?.supabase_uuid;
      if (!supabaseUserId && typeof metadataUuid === "string" && UUID_REGEX.test(metadataUuid)) {
        supabaseUserId = metadataUuid;
      }

      if (!supabaseUserId && user?.id) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("clerk_user_id", user.id)
          .maybeSingle();
        if (loadToken !== loadRef.current) return;
        if (profileError) throw profileError;
        supabaseUserId = profile?.user_id ?? null;
      }

      let workspaceId = serverMembersPayload?.workspace_id || null;
      let workspaceName = serverMembersPayload?.workspace_name || null;
      let supportLanguage = "en";
      if (workspaceId) {
        supportLanguage = normalizeSupportLanguage(serverMembersPayload.support_language || "en");
      }
      if (orgId && !workspaceId) {
        let workspaceLookup = await supabase
          .from("workspaces")
          .select("id, name, support_language")
          .eq("clerk_org_id", orgId)
          .maybeSingle();
        if (workspaceLookup.error?.code === "42703") {
          workspaceLookup = await supabase
            .from("workspaces")
            .select("id, name")
            .eq("clerk_org_id", orgId)
            .maybeSingle();
        }
        if (loadToken !== loadRef.current) return;
        const workspaceRow = workspaceLookup.data;
        const workspaceError = workspaceLookup.error;
        if (workspaceError) throw workspaceError;
        workspaceId = workspaceRow?.id ?? null;
        workspaceName = workspaceRow?.name ?? null;
        supportLanguage = normalizeSupportLanguage(workspaceRow?.support_language || "en");
      }
      if (!workspaceId && !orgId && user?.id) {
        const { data: membership, error: membershipError } = await supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("clerk_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!membershipError) {
          workspaceId = membership?.workspace_id ?? null;
        }
        if (workspaceId) {
          let workspaceLookup = await supabase
            .from("workspaces")
            .select("id, name, support_language")
            .eq("id", workspaceId)
            .maybeSingle();
          if (workspaceLookup.error?.code === "42703") {
            workspaceLookup = await supabase
              .from("workspaces")
              .select("id, name")
              .eq("id", workspaceId)
              .maybeSingle();
          }
          if (loadToken !== loadRef.current) return;
          const workspaceRow = workspaceLookup.data;
          const workspaceError = workspaceLookup.error;
          if (!workspaceError) {
            workspaceName = workspaceRow?.name ?? null;
            supportLanguage = normalizeSupportLanguage(workspaceRow?.support_language || "en");
          }
        }
      }

      // The server resolves the scope with Clerk's session directly. This is
      // the authoritative fallback when the browser-side Supabase token has
      // not refreshed its workspace claims yet.
      if (!supabaseUserId && serverMembersPayload?.supabase_user_id) {
        supabaseUserId = serverMembersPayload.supabase_user_id;
      }
      if (!workspaceId && serverMembersPayload?.workspace_id) {
        workspaceId = serverMembersPayload.workspace_id;
        workspaceName = serverMembersPayload.workspace_name || null;
        supportLanguage = normalizeSupportLanguage(serverMembersPayload.support_language || "en");
      }

      let shopRow = serverMembersPayload?.shop || null;
      let shopError = null;
      if (!hasServerMembers && !shopRow && workspaceId) {
        const latestShop = await supabase
          .from("shops")
          .select("id, owner_user_id, shop_domain")
          .eq("workspace_id", workspaceId)
          .is("uninstalled_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        shopRow = latestShop?.data ?? null;
        shopError = latestShop?.error ?? null;
      } else if (!hasServerMembers && !shopRow && supabaseUserId) {
        const latestShop = await supabase
          .from("shops")
          .select("id, owner_user_id, shop_domain")
          .eq("owner_user_id", supabaseUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        shopRow = latestShop?.data ?? null;
        shopError = latestShop?.error ?? null;
      }

      if (loadToken !== loadRef.current) return;
      if (shopError) throw shopError;

      if (!workspaceId && !supabaseUserId) {
        setWorkspace(EMPTY_WORKSPACE);
        setResources({});
        setMembers([]);
        setCurrentRole("");
        setCanManageMembers(false);
        return;
      }

      const resolvedTeamName =
        String(workspaceName || "").trim() ||
        String(shopRow?.shop_domain || "").replace(".myshopify.com", "") ||
        "Sona Team";
      const memberOwnerId = shopRow?.owner_user_id ?? supabaseUserId;

      // Fetch whatever the bootstrap did not return, in parallel.
      const missing = missingResourceUrls(nextResources, { hasWorkspace: Boolean(workspaceId) });
      const [fetched, profileRowsResult] = await Promise.all([
        Promise.all(missing.map((url) => readEntry(readResponse, url))),
        !workspaceId && memberOwnerId
          ? supabase
              .from("profiles")
              .select("user_id, first_name, last_name, email, image_url, signature")
              .eq("user_id", memberOwnerId)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);
      missing.forEach((url, index) => {
        nextResources[url] = fetched[index];
      });

      if (loadToken !== loadRef.current) return;

      let nextMembers = [];
      let nextRole = "";
      let nextCanManage = false;
      if (workspaceId) {
        const membersPayload = resourcePayload(nextResources, "/api/settings/members");
        if (!membersPayload) throw new Error("Could not load workspace members.");
        nextMembers = Array.isArray(membersPayload?.members) ? membersPayload.members : [];
        nextRole = String(membersPayload?.current_role || "");
        nextCanManage = Boolean(membersPayload?.can_manage_members);
      } else {
        if (profileRowsResult.error) throw profileRowsResult.error;
        nextMembers = Array.isArray(profileRowsResult.data) ? profileRowsResult.data : [];
      }

      setWorkspace({
        workspaceId: workspaceId ?? null,
        shopId: shopRow?.id ?? null,
        shopDomain: shopRow?.shop_domain ?? "",
        supabaseUserId,
        workspaceName: resolvedTeamName,
        supportLanguage: workspaceId ? supportLanguage : "en",
      });
      setResources(nextResources);
      setMembers(nextMembers);
      setCurrentRole(nextRole);
      setCanManageMembers(nextCanManage);
    } catch (error) {
      if (loadToken !== loadRef.current) return;
      console.error("Settings load failed:", error);
      toast.error("Could not load settings.");
    } finally {
      if (loadToken === loadRef.current) setLoading(false);
    }
  }, [readsReady, readResponse, orgId, supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

  useEffect(() => {
    load().catch(() => null);
    return () => { loadRef.current += 1; };
  }, [load]);

  // Sections record what they just saved, so their next mount shows it without a refetch.
  const setResource = useCallback(
    (url, payload) => setResources((current) => withResource(current, url, payload)),
    []
  );

  const reloadMembers = useCallback(async () => {
    const entry = await readEntry(readResponse, "/api/settings/members");
    if (!entry.ok) return;
    setResources((current) => ({ ...current, "/api/settings/members": entry }));
    setMembers(Array.isArray(entry.payload?.members) ? entry.payload.members : []);
    setCurrentRole(String(entry.payload?.current_role || ""));
    setCanManageMembers(Boolean(entry.payload?.can_manage_members));
  }, [readResponse]);

  const setWorkspaceName = useCallback(
    (name) => setWorkspace((current) => ({ ...current, workspaceName: name })),
    []
  );

  const value = useMemo(() => ({
    loading,
    workspace,
    resources,
    members,
    setMembers,
    currentRole,
    canManageMembers,
    setResource,
    reloadMembers,
    setWorkspaceName,
  }), [loading, workspace, resources, members, currentRole, canManageMembers, setResource, reloadMembers, setWorkspaceName]);

  return <SettingsWorkspaceContext.Provider value={value}>{children}</SettingsWorkspaceContext.Provider>;
}
