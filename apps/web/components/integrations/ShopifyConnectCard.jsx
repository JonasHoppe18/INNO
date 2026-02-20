"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useUser } from "@clerk/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { CheckCircle2 } from "lucide-react";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";
import { ShopifySheet } from "./ShopifySheet";

export function ShopifyConnectCard() {
  const supabase = useClerkSupabase();
  const { orgId } = useAuth();
  const { user } = useUser();
  // Holder den seneste shop connection så vi kan vise status og bruge den i sheetet.
  const [connection, setConnection] = useState(null);
  // Bruges til at vise "Henter..." badge og blokere knapper hvis Supabase klienten mangler.
  const [loading, setLoading] = useState(true);

  // Henter butikkens domæne og ejer via Supabase RLS.
  const loadConnection = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let workspaceId = null;
    if (orgId) {
      const { data: workspace, error: workspaceError } = await supabase
        .from("workspaces")
        .select("id")
        .eq("clerk_org_id", orgId)
        .maybeSingle();
      if (workspaceError) {
        console.warn("Could not resolve workspace:", workspaceError);
      } else {
        workspaceId = workspace?.id ?? null;
      }
    }

    if (!workspaceId && user?.id) {
      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("clerk_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (membershipError) {
        console.warn("Could not resolve workspace from membership:", membershipError);
      } else {
        workspaceId = membership?.workspace_id ?? null;
      }
    }

    let ownerUserId = null;
    if (!workspaceId && user?.id) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("clerk_user_id", user.id)
        .maybeSingle();
      if (profileError) {
        console.warn("Could not resolve owner user id:", profileError);
      } else {
        ownerUserId = profile?.user_id ?? null;
      }
    }

    let query = supabase
      .from("shops")
      .select("shop_domain, owner_user_id, platform, installed_at, uninstalled_at")
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .is("uninstalled_at", null)
      .limit(1);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    let { data, error } = await query.maybeSingle();

    // Legacy fallback: only scope by owner if the primary (RLS-scoped) read found nothing.
    if (!data && !error && !workspaceId && ownerUserId) {
      const fallback = await supabase
        .from("shops")
        .select("shop_domain, owner_user_id, platform, installed_at, uninstalled_at")
        .eq("platform", "shopify")
        .eq("owner_user_id", ownerUserId)
        .is("uninstalled_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      data = fallback.data ?? null;
      error = fallback.error ?? null;
    }

    if (error) {
      console.warn("Could not load Shopify connection:", error);
      setConnection(null);
    } else {
      setConnection(data);
    }
    setLoading(false);
  }, [orgId, supabase, user?.id]);

  // Når supabase klienten er klar henter vi forbindelsen én gang og når onConnected kaldes.
  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

  const isConnected = Boolean(connection) && !connection?.uninstalled_at;
  const connectedDomain = connection?.shop_domain || connection?.store_domain;
  // Status badges skal vise loading/aktiv/inaktiv baseret på Supabase record.
  const statusLabel = loading
    ? "Loading..."
    : isConnected
    ? "Active"
    : "Not connected";

  const buttonLabel = isConnected ? "Manage" : "Connect Shopify Store";

  return (
    <Card className="flex h-full flex-col border bg-card/60 shadow-sm">
      <CardHeader className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/40">
          <Image
            src={shopifyLogo}
            alt="Shopify logo"
            width={80}
            height={80}
            className="object-contain"
          />
        </div>
        <div className="space-y-1">
          <CardTitle>Shopify</CardTitle>
          <CardDescription>
            Connect your Shopify store and sync orders and customers with Sona.
          </CardDescription>
        </div>
      </CardHeader>
      {/* Når butikken er forbundet viser vi domænet + grøn indikator. */}
      <CardContent className="flex-1">
        {isConnected && connectedDomain ? (
          <div
            className="mt-2 flex min-w-0 items-center gap-2 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground"
            title={connectedDomain}
          >
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500 animate-pulse" />
            <span className="truncate">{connectedDomain}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            
          </p>
        )}
      </CardContent>
      {/* Foden viser status og åbner ShopifySheet hvor man kan forbinde/frakoble */}
      <CardFooter className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 p-4">
        {isConnected ? (
          <div className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {statusLabel}
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {statusLabel}
          </span>
        )}
        {/* ShopifySheet abstraherer formularlogik + disconnect ligesom Freshdesk */}
        <ShopifySheet
          onConnected={loadConnection}
          initialConnection={connection}
        >
          <Button size="sm" variant={isConnected ? "outline" : "default"}>
            {buttonLabel}
          </Button>
        </ShopifySheet>
      </CardFooter>
    </Card>
  );
}
