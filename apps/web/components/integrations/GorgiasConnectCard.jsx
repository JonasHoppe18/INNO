"use client";

import { useEffect } from "react";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { useWorkspaceIntegration } from "@/hooks/useWorkspaceIntegration";
import { GorgiasSheet } from "./GorgiasSheet";
import gorgiasLogo from "../../../../assets/gorgias-removebg-preview.png";

export function GorgiasConnectCard() {
  const { integration, loading, loadStatus: loadIntegration } = useWorkspaceIntegration("gorgias");

  useEffect(() => {
    const importStatus = integration?.config?.import_status;
    if (importStatus !== "running") return;

    const timer = setInterval(async () => {
      try {
        await fetch("/api/integrations/import-history/worker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max_batches: 2 }),
        });
      } catch (_error) {
        // noop
      } finally {
        loadIntegration();
      }
    }, 6000);

    return () => clearInterval(timer);
  }, [integration?.config?.import_status, loadIntegration]);

  const isConnected = integration?.is_active;
  const domain = integration?.config?.domain;
  const importStatus = integration?.config?.import_status;
  const importedCount = integration?.config?.last_import_count;

  return (
    <Card className="flex h-full flex-col border bg-card/60 shadow-sm">
      <CardHeader className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/40">
          <Image
            src={gorgiasLogo}
            alt="Gorgias logo"
            width={40}
            height={40}
            className="object-contain"
          />
        </div>
        <div className="space-y-1">
          <CardTitle>Gorgias</CardTitle>
          <CardDescription>
            Import your historic Gorgias tickets once, so Sona learns prior support tone.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        {isConnected && domain ? (
          <div className="mt-2 space-y-2">
            <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500 animate-pulse" />
              <span className="truncate">{domain}</span>
            </div>
            {typeof importedCount === "number" ? (
              <p className="text-xs text-muted-foreground">
                {importStatus === "running"
                  ? `Importing history... ${importedCount} imported.`
                  : `Initial import complete: ${importedCount} tickets.`}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 p-4">
        {isConnected ? (
          <div className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Active
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            Not connected
          </span>
        )}

        <GorgiasSheet initialData={integration} onConnected={loadIntegration}>
          <Button size="sm" variant={isConnected ? "outline" : "default"}>
            {isConnected ? "Manage" : "Connect"}
          </Button>
        </GorgiasSheet>
      </CardFooter>
    </Card>
  );
}
