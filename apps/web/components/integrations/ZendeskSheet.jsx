"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
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

const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() || "supabase";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const isValidUuid = (value) =>
  typeof value === "string" && UUID_REGEX.test(value);

const base64UrlToBase64 = (input) => {
  if (typeof input !== "string" || !input.length) return "";
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

function normalizeZendeskUrl(input = "") {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function ZendeskSheet({ children, onConnected, initialData = null }) {
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [limit, setLimit] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const hasExistingConfig = Boolean(initialData);
  const importCompleted = Boolean(initialData?.config?.import_completed);

  useEffect(() => {
    if (open) {
      setDomain(initialData?.config?.domain ?? "");
      setEmail(initialData?.config?.email ?? "");
      setApiToken("");
      setStatus("");
      setError("");
    } else if (!initialData) {
      setDomain("");
      setEmail("");
      setApiToken("");
      setStatus("");
      setError("");
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
      if (isValidUuid(candidate)) return candidate;
    } catch (_error) {
      // noop
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
    if (profileError) return null;
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
    if (error) return null;
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
  }, [user?.publicMetadata?.supabase_uuid, resolveUserIdFromToken, fetchProfileUserId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase || !user) return;
    if (importCompleted) {
      setError("Initial import has already completed. Disconnect to run a new one.");
      return;
    }

    if (!domain.trim() || !email.trim() || !apiToken.trim()) {
      setError("Enter Zendesk domain, support email, and API token.");
      return;
    }

    setSubmitting(true);
    setError("");
    setStatus("Saving integration...");

    const normalizedUrl = normalizeZendeskUrl(domain);
    const importLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

    let supabaseUserId;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!authError && isValidUuid(authData?.user?.id)) {
        supabaseUserId = authData.user.id;
      }
    } catch (_error) {
      // noop
    }
    if (!supabaseUserId) {
      supabaseUserId = await ensureUserId();
    }
    if (!isValidUuid(supabaseUserId)) {
      setError("Supabase user ID is not ready yet.");
      setSubmitting(false);
      return;
    }

    const workspaceId = await resolveWorkspaceId();
    const onConflict = workspaceId ? "workspace_id,provider" : "user_id,provider";

    const baseConfig = {
      domain: normalizedUrl,
      email: email.trim(),
      import_completed: false,
      import_status: "in_progress",
    };

    const payload = {
      user_id: supabaseUserId,
      workspace_id: workspaceId,
      provider: "zendesk",
      config: baseConfig,
      credentials_enc: encodeToBytea(apiToken.trim()),
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { data: integrationRow, error: saveError } = await supabase
      .from("integrations")
      .upsert(payload, { onConflict })
      .select("id")
      .maybeSingle();

    if (saveError) {
      setSubmitting(false);
      setStatus("");
      setError(saveError.message);
      return;
    }

    setStatus("Queueing background import...");
    const enqueueResponse = await fetch("/api/integrations/import-history/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "zendesk",
        max_tickets: Math.max(200, importLimit * 10),
        batch_size: 50,
      }),
    });
    const enqueuePayload = await enqueueResponse.json().catch(() => ({}));

    if (!enqueueResponse.ok) {
      await supabase
        .from("integrations")
        .update({
          config: {
            ...baseConfig,
            import_status: "failed",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integrationRow?.id ?? "");
      setSubmitting(false);
      setStatus("");
      setError(enqueuePayload?.error || "Zendesk import job could not be queued.");
      return;
    }

    await supabase
      .from("integrations")
      .update({
        config: {
          ...baseConfig,
          import_completed: false,
          import_status: "running",
          import_limit: Math.max(200, importLimit * 10),
          last_import_count: Number(initialData?.config?.last_import_count || 0),
          last_import_skipped: Number(initialData?.config?.last_import_skipped || 0),
          last_import_at: null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationRow?.id ?? "");

    // Kick worker once immediately; remaining batches can continue in background ticks.
    await fetch("/api/integrations/import-history/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: enqueuePayload?.job?.id || null,
        max_batches: 2,
      }),
    }).catch(() => null);

    setStatus("");
    setApiToken("");
    setOpen(false);
    onConnected?.();
    setSubmitting(false);
  };

  const handleDisconnect = async () => {
    if (!hasExistingConfig) return;
    setDisconnecting(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/zendesk", {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not disconnect Zendesk.");
      }
      setOpen(false);
      onConnected?.();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Could not disconnect Zendesk."
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const submitLabel = submitting
    ? "Importing..."
    : hasExistingConfig
      ? "Save & Import Once"
      : "Connect & Import Once";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{hasExistingConfig ? "Manage Zendesk" : "Connect Zendesk"}</SheetTitle>
          <SheetDescription>
            We only import your historic tickets once during onboarding. No ongoing sync.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="zendesk-domain">Zendesk URL</Label>
            <Input
              id="zendesk-domain"
              placeholder="your-company.zendesk.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              disabled={submitting || importCompleted}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zendesk-email">Agent email</Label>
            <Input
              id="zendesk-email"
              type="email"
              placeholder="support@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting || importCompleted}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zendesk-token">API token</Label>
            <Input
              id="zendesk-token"
              type="password"
              placeholder="Paste Zendesk API token"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              disabled={submitting || importCompleted}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zendesk-limit">Import limit</Label>
            <Input
              id="zendesk-limit"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              disabled={submitting || importCompleted}
            />
          </div>

          {importCompleted ? (
            <p className="text-xs text-emerald-700">
              Initial import already completed. Disconnect and reconnect if you want to run it again.
            </p>
          ) : null}
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <SheetFooter className="pt-4 gap-2">
            <Button type="submit" className="w-full" disabled={submitting || importCompleted}>
              {submitLabel}
            </Button>
            {hasExistingConfig ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleDisconnect}
                disabled={disconnecting || submitting}
              >
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </Button>
            ) : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
