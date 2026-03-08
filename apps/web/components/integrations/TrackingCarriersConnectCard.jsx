"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Truck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import glsLogo from "../../../../assets/GLS logo.png";

const FALLBACK_CARRIERS = ["gls"];
const CARRIER_LABELS = {
  postnord: "PostNord",
  gls: "GLS",
  dao: "DAO",
  bring: "Bring",
  dhl: "DHL",
  ups: "UPS",
};

function normalizeCarriers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const carrier = String(item || "").trim().toLowerCase();
    if (!carrier || seen.has(carrier)) continue;
    seen.add(carrier);
    normalized.push(carrier);
  }
  return normalized;
}

export function TrackingCarriersConnectCard() {
  const [availableCarriers, setAvailableCarriers] = useState(FALLBACK_CARRIERS);
  const [selectedCarriers, setSelectedCarriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingCarrier, setSavingCarrier] = useState("");

  const loadCarriers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/carriers", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not load carriers.");

      const available = normalizeCarriers(payload?.available_carriers);
      const selected = normalizeCarriers(payload?.selected_carriers);

      setAvailableCarriers(available.length > 0 ? available : FALLBACK_CARRIERS);
      setSelectedCarriers(selected);
    } catch (error) {
      toast.error(error?.message || "Could not load carriers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCarriers().catch(() => null);
  }, [loadCarriers]);

  const updateCarriers = useCallback(async (carrier) => {
    const normalized = String(carrier || "").trim().toLowerCase();
    if (!normalized || !availableCarriers.includes(normalized) || savingCarrier) return;
    const isActive = selectedCarriers.includes(normalized);
    const nextSelected = isActive
      ? selectedCarriers.filter((item) => item !== normalized)
      : [...selectedCarriers, normalized];

    setSavingCarrier(normalized);
    try {
      const response = await fetch("/api/settings/carriers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selected_carriers: nextSelected }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save carriers.");

      const selected = normalizeCarriers(payload?.selected_carriers);
      setSelectedCarriers(selected);
      toast.success(
        isActive ? `${CARRIER_LABELS[normalized] || normalized} disconnected.` : `${CARRIER_LABELS[normalized] || normalized} connected.`,
      );
    } catch (error) {
      toast.error(error?.message || "Could not save carriers.");
    } finally {
      setSavingCarrier("");
    }
  }, [availableCarriers, savingCarrier, selectedCarriers]);

  return (
    <>
      {availableCarriers.filter((carrier) => carrier === "gls").map((carrier) => {
        const isConnected = selectedCarriers.includes(carrier);
        const carrierLabel = CARRIER_LABELS[carrier] || carrier;
        const isSaving = savingCarrier === carrier;
        return (
          <Card key={carrier} className="flex h-full flex-col border bg-card/60 shadow-sm">
            <CardHeader className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/40">
                {carrier === "gls" ? (
                  <Image src={glsLogo} alt="GLS logo" width={32} height={32} className="h-7 w-7 object-contain" />
                ) : (
                  <Truck className="h-6 w-6 text-slate-700" />
                )}
              </div>
              <div className="space-y-1">
                <CardTitle>{carrierLabel}</CardTitle>
                <CardDescription>
                  Enable tracking lookups for {carrierLabel} shipments.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="flex-1" />

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
              <Button
                size="sm"
                variant={isConnected ? "outline" : "default"}
                onClick={() => updateCarriers(carrier)}
                disabled={loading || Boolean(savingCarrier)}
              >
                {isSaving ? "Saving..." : isConnected ? "Disconnect" : "Connect"}
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </>
  );
}
