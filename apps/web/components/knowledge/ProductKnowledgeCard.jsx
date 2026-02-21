"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ProductKnowledgeCard() {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadCount = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/sync-products", { method: "GET" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof payload?.error === "string" ? payload.error : "Could not load products.";
        throw new Error(message);
      }
      setCount(Number(payload?.count ?? 0));
    } catch (error) {
      console.warn("ProductKnowledgeCard: load failed", error);
      toast.error("Could not load product knowledge.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCount().catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/knowledge/sync-products", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof payload?.error === "string" ? payload.error : "Sync failed.";
        throw new Error(message);
      }
      toast.success(`Synced ${payload?.synced ?? 0} products.`);
      await loadCount();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  };

  const statusText = loading
    ? "Checking products..."
    : `${count} product${count === 1 ? "" : "s"} synced`;

  return (
    <Card className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:p-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Database className="h-4 w-4 text-slate-500" />
            <span>Product Catalog</span>
          </div>
          <span className="text-sm text-muted-foreground">{statusText}</span>
        </div>
        <Button
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="gap-2 self-start sm:self-auto"
        >
          {syncing ? "Syncing..." : "Sync Products"}
        </Button>
      </CardContent>
    </Card>
  );
}
