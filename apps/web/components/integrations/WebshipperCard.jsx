"use client";

import Image from "next/image";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { useWorkspaceIntegration } from "@/hooks/useWorkspaceIntegration";
import WebshipperLogo from "../../../../assets/Webshipper_logo.png";
import { WebshipperSheet } from "./WebshipperSheet";

export function WebshipperCard() {
  const { integration, loading, loadStatus: loadIntegration } = useWorkspaceIntegration("webshipper");

  const isConnected = Boolean(integration?.is_active);
  const buttonLabel = isConnected ? "Manage" : "Connect";

  return (
    <Card className="flex h-full flex-col border bg-card/60 shadow-sm">
      <CardHeader className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/40">
          <Image
            src={WebshipperLogo}
            alt="Webshipper logo"
            width={84}
            height={84}
            className="object-contain"
          />
        </div>
        <div className="space-y-1">
          <CardTitle>Webshipper</CardTitle>
          <CardDescription>
            Sync order updates with Webshipper when Sona changes addresses in Shopify.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        {isConnected && integration?.config?.tenant ? (
          <div
            className="mt-2 flex min-w-0 items-center gap-2 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground"
            title={integration.config.tenant}
          >
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500 animate-pulse" />
            <span className="truncate">Tenant: {integration.config.tenant}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed" />
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 p-4">
        {isConnected ? (
          <div className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Active
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Not connected</span>
        )}
        <WebshipperSheet onConnected={loadIntegration} initialIntegration={integration}>
          <Button size="sm" variant={isConnected ? "outline" : "default"} disabled={loading}>
            {buttonLabel}
          </Button>
        </WebshipperSheet>
      </CardFooter>
    </Card>
  );
}
