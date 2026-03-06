"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
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

export function WebshipperSheet({ children, onConnected, initialIntegration = null }) {
  const supabase = useClerkSupabase();
  const { user } = useUser();

  const [open, setOpen] = useState(false);
  const [tenant, setTenant] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hasExistingConfig = Boolean(initialIntegration?.is_active);

  useEffect(() => {
    if (open) {
      setTenant(initialIntegration?.config?.tenant ?? "");
      setToken("");
      setError("");
    }
  }, [initialIntegration?.config?.tenant, open]);

  const resolveScope = useCallback(async () => {
    if (!supabase || !user?.id) return { workspaceId: null, userId: null };

    let authUserId = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      authUserId = authData?.user?.id ?? null;
    } catch (_error) {
      authUserId = null;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();

    const userId = authUserId ?? profile?.user_id ?? initialIntegration?.user_id ?? null;

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      workspaceId: membership?.workspace_id ?? null,
      userId,
    };
  }, [initialIntegration?.user_id, supabase, user?.id]);

  const handleSave = async (event) => {
    event.preventDefault();
    if (!supabase) return;

    setError("");
    const cleanTenant = tenant.trim();
    const cleanToken = token.trim();
    if (!cleanTenant || !cleanToken) {
      setError("Enter both tenant and API token.");
      return;
    }

    setSaving(true);
    try {
      const encryptResponse = await fetch("/api/integrations/webshipper/encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cleanToken }),
      });
      const encryptPayload = await encryptResponse.json().catch(() => ({}));
      if (!encryptResponse.ok || !encryptPayload?.encryptedToken) {
        throw new Error(encryptPayload?.error || "Could not encrypt Webshipper token.");
      }

      const { workspaceId, userId } = await resolveScope();
      if (!userId) {
        throw new Error("Could not resolve Supabase user id for integration save.");
      }

      const payload = {
        provider: "webshipper",
        config: { tenant: cleanTenant },
        credentials_enc: encryptPayload.encryptedToken,
        is_active: true,
        updated_at: new Date().toISOString(),
        user_id: userId,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      };

      const onConflict = workspaceId ? "workspace_id,provider" : "user_id,provider";
      const { error: upsertError } = await supabase
        .from("integrations")
        .upsert(payload, { onConflict });

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      setToken("");
      setOpen(false);
      onConnected?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save Webshipper.");
    } finally {
      setSaving(false);
    }
  };

  const submitLabel = saving
    ? hasExistingConfig
      ? "Updating..."
      : "Connecting..."
    : hasExistingConfig
      ? "Update Configuration"
      : "Connect Webshipper";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{hasExistingConfig ? "Manage Webshipper" : "Connect Webshipper"}</SheetTitle>
          <SheetDescription>
            Add your tenant and API token to sync Shopify order updates with Webshipper.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="webshipper-tenant">Tenant</Label>
            <Input
              id="webshipper-tenant"
              placeholder="acezone"
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webshipper-token">API token</Label>
            <Input
              id="webshipper-token"
              type="password"
              placeholder={hasExistingConfig ? "Enter new token to rotate" : "Paste API token"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={saving}
            />
          </div>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <SheetFooter className="pt-4">
            <Button type="submit" className="w-full bg-black text-white" disabled={saving}>
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
