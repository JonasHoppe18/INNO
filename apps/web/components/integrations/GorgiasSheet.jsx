"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { useAuth, useUser } from "@clerk/nextjs";

const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() || "supabase";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const isValidUuid = (value) =>
  typeof value === "string" && UUID_REGEX.test(value);

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

function encodeToBytea(value) {
  if (!value) return null;
  const hex = Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `\\x${hex}`;
}

export function GorgiasSheet({ children, onConnected, initialData = null }) {
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");
  const hasExistingConfig = Boolean(initialData);

  useEffect(() => {
    if (open) {
      const existingDomain = initialData?.config?.domain ?? "";
      const existingEmail = initialData?.config?.email ?? "";
      const existingApiKey =
        initialData?.config?.apiKey ??
        initialData?.config?.api_key ??
        initialData?.apiKey ??
        initialData?.api_key ??
        "";
      setDomain(existingDomain || "");
      setEmail(existingEmail || "");
      setApiKey(existingApiKey || "");
    } else if (!initialData) {
      setDomain("");
      setEmail("");
      setApiKey("");
    }
  }, [open, initialData]);

  const resolveUserIdFromToken = useCallback(async () => {
    if (typeof getToken !== "function") return null;
    try {
      const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
      const payload = decodeJwtPayload(templateToken);
      const claimUuid =
        typeof payload?.supabase_user_id === "string"
          ? payload.supabase_user_id
          : null;
      const sub = typeof payload?.sub === "string" ? payload.sub : null;
      const candidate = isValidUuid(claimUuid) ? claimUuid : sub;
      if (isValidUuid(candidate)) {
        return candidate;
      }
    } catch (tokenError) {
      console.warn(
        "GorgiasSheet: clerk token did not include supabase uuid",
        tokenError
      );
    }
    return null;
  }, [getToken]);

  const fetchProfileUserId = useCallback(async () => {
    if (!supabase || !user?.id) return null;
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();
    if (profileError) {
      console.warn("GorgiasSheet: could not fetch profile user id", profileError);
      return null;
    }
    return isValidUuid(data?.user_id) ? data.user_id : null;
  }, [supabase, user?.id]);

  const resolveWorkspaceId = useCallback(async () => {
    if (!supabase || !user?.id) return null;
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("GorgiasSheet: could not fetch workspace id", error);
      return null;
    }
    return typeof data?.workspace_id === "string" ? data.workspace_id : null;
  }, [supabase, user?.id]);

  const ensureUserId = useCallback(async () => {
    const metadataUuid = user?.publicMetadata?.supabase_uuid;
    if (isValidUuid(metadataUuid)) return metadataUuid;

    const tokenUuid = await resolveUserIdFromToken();
    if (isValidUuid(tokenUuid)) return tokenUuid;

    const profileUuid = await fetchProfileUserId();
    if (isValidUuid(profileUuid)) return profileUuid;

    return null;
  }, [
    user?.publicMetadata?.supabase_uuid,
    resolveUserIdFromToken,
    fetchProfileUserId,
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase || !user) return;

    if (!domain.trim() || !email.trim() || !apiKey.trim()) {
      setError("Enter domain, email, and API key.");
      return;
    }

    setSubmitting(true);
    setError("");

    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

    let supabaseUserId;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!authError && isValidUuid(authData?.user?.id)) {
        supabaseUserId = authData.user.id;
      }
    } catch (_err) {
      // noop
    }

    if (!supabaseUserId) {
      try {
        supabaseUserId = await ensureUserId();
      } catch (uuidError) {
        console.error("Could not fetch Supabase user ID:", uuidError);
      }
    }

    if (!isValidUuid(supabaseUserId)) {
      setError("Supabase user ID is not ready yet.");
      setSubmitting(false);
      return;
    }

    const workspaceId = await resolveWorkspaceId();

    const payload = {
      user_id: supabaseUserId,
      workspace_id: workspaceId,
      provider: "gorgias",
      config: {
        domain: cleanDomain,
        email: email.trim(),
        import_status: "running",
        import_completed: false,
      },
      credentials_enc: encodeToBytea(apiKey.trim()),
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const onConflict = workspaceId ? "workspace_id,provider" : "user_id,provider";
    const { error: upsertError } = await supabase
      .from("integrations")
      .upsert(payload, { onConflict });

    if (upsertError) {
      console.error("Error saving integration:", upsertError);
      setError("Could not save. Check the console for details.");
    } else {
      const enqueueResponse = await fetch("/api/integrations/import-history/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gorgias",
          max_tickets: 1000,
          batch_size: 50,
        }),
      });
      if (enqueueResponse.ok) {
        const enqueuePayload = await enqueueResponse.json().catch(() => ({}));
        await fetch("/api/integrations/import-history/worker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: enqueuePayload?.job?.id || null,
            max_batches: 2,
          }),
        }).catch(() => null);
      }
      onConnected?.();
      setOpen(false);
      setDomain(cleanDomain);
      setEmail(email.trim());
      setApiKey("");
    }
    setSubmitting(false);
  };

  const handleDisconnect = async () => {
    if (!hasExistingConfig) return;
    setDisconnecting(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/gorgias", {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : "Could not disconnect the integration.";
        throw new Error(message);
      }
      setDomain("");
      setEmail("");
      setApiKey("");
      setOpen(false);
      onConnected?.();
    } catch (disconnectError) {
      console.error("Error disconnecting Gorgias:", disconnectError);
      setError(
        disconnectError?.message ||
          "Could not disconnect the integration. Try again."
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const primaryCtaLabel = submitting
    ? hasExistingConfig
      ? "Updating & importing..."
      : "Connecting & importing..."
    : hasExistingConfig
    ? "Update & Import Once"
    : "Connect & Import Once";

  const disconnectLabel = disconnecting
    ? "Disconnecting..."
    : "Disconnect Integration";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>
            {hasExistingConfig ? "Update Gorgias" : "Connect Gorgias"}
          </SheetTitle>
          <SheetDescription>
            We import your historic tickets once during onboarding. No ongoing sync.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              1. Access
            </h3>
            <div className="space-y-2">
              <Label htmlFor="gorgias-domain">Gorgias domain</Label>
              <Input
                id="gorgias-domain"
                placeholder="your-store.gorgias.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gorgias-api">API Key</Label>
              <Input
                id="gorgias-api"
                type="password"
                placeholder="••••••••••••••"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Find it under your Gorgias profile settings.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gorgias-email">Support email</Label>
              <Input
                id="gorgias-email"
                type="email"
                placeholder="support@your-store.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Used as the sender when creating drafts in Gorgias.
              </p>
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          <p className="text-xs text-muted-foreground">
            Sona starts a background import job automatically right after connect.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <SheetFooter className="pt-4 flex-col gap-3 sm:flex-col">
            <Button
              type="submit"
              className="w-full bg-black text-white"
              disabled={submitting || disconnecting}
            >
              {primaryCtaLabel}
            </Button>
            {hasExistingConfig && (
              <Button
                type="button"
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50"
                onClick={handleDisconnect}
                disabled={disconnecting || submitting}
              >
                {disconnectLabel}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
