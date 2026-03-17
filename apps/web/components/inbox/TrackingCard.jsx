import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Loader2, PackageCheck, Truck, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildTrackingTimeline, normalizeTrackingStatusLabel } from "@/components/inbox/tracking-utils";
import glsLogo from "../../../../assets/GLS logo.png";

function getTrackingStatusLabel({ tracking = null, order = null, timeline = [] }) {
  const latestTimelineStatus = String(timeline?.[0]?.title || "").trim();
  if (latestTimelineStatus) return latestTimelineStatus;
  const explicitStatus = normalizeTrackingStatusLabel(tracking?.status);
  if (explicitStatus) return explicitStatus;
  if (String(order?.fulfillmentStatus || "").toLowerCase() === "fulfilled") {
    return "Shipped";
  }
  return "Tracking available";
}

function getCarrierLabel(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Carrier";
  return text;
}

function isGlsCarrier(value = "") {
  return String(value || "").trim().toLowerCase() === "gls";
}

function getSummaryLabel({ tracking = null, order = null, timeline = [] }) {
  const carrier = getCarrierLabel(tracking?.company);
  const status = getTrackingStatusLabel({ tracking, order, timeline });
  return `${carrier} • ${status}`;
}

function getStatusClasses(status = "") {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("out for delivery")) return "bg-amber-50 text-amber-700";
  if (lower.includes("delivered")) return "bg-emerald-50 text-emerald-700";
  if (lower.includes("transit") || lower.includes("shipped")) return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

function formatTrackingMeta(order = null, statusLabel = "") {
  const parts = [];
  if (statusLabel) parts.push(statusLabel);
  return parts.join(" • ");
}

export function TrackingCard({ order = null, threadId = null }) {
  const [open, setOpen] = useState(false);
  const [timelineLogs, setTimelineLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const tracking = order?.tracking || null;
  const trackingNumber = String(tracking?.number || "").trim();
  const trackingUrl = String(tracking?.url || "").trim();
  const carrier = getCarrierLabel(tracking?.company);
  const timeline = useMemo(
    () => buildTrackingTimeline({ logs: timelineLogs, order }),
    [order, timelineLogs]
  );
  const statusLabel = useMemo(
    () => getTrackingStatusLabel({ tracking, order, timeline }),
    [order, timeline, tracking]
  );
  const summaryLabel = useMemo(
    () => getSummaryLabel({ tracking, order, timeline }),
    [order, timeline, tracking]
  );
  const orderLabel = String(order?.id || "").trim();
  const cardMetaLabel = useMemo(() => {
    const parts = [];
    const base = formatTrackingMeta(order, statusLabel);
    if (base) parts.push(base);
    if (trackingNumber) parts.push(trackingNumber);
    return parts.join(" • ");
  }, [order, statusLabel, trackingNumber]);

  useEffect(() => {
    let active = true;
    const fetchTimeline = async () => {
      if (!open || !threadId) return;
      setLoading(true);
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/insights`, {
        method: "GET",
      }).catch(() => null);
      if (!active) return;
      if (!response?.ok) {
        setTimelineLogs([]);
        setLoading(false);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      setTimelineLogs(Array.isArray(payload?.logs) ? payload.logs : []);
      setLoading(false);
    };
    fetchTimeline();
    return () => {
      active = false;
    };
  }, [open, threadId]);

  if (!trackingNumber && !trackingUrl) return null;

      return (
    <>
      <div className="inline-flex w-[360px] max-w-full flex-col items-end">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-12 w-12 flex-none items-center justify-center">
              {isGlsCarrier(tracking?.company) ? (
                <Image src={glsLogo} alt="GLS logo" className="h-8 w-8 object-contain" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <Truck className="h-5 w-5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-slate-950">Tracking parcel</div>
              <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
                <span className="truncate">{cardMetaLabel || summaryLabel}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-3 inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="View tracking details"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[640px] [&>button]:hidden">
          <DialogHeader className="space-y-0">
            <div className="flex items-start justify-between gap-3">
              <DialogTitle className="flex items-center gap-1.5 text-xl font-medium text-slate-950">
                <span className="inline-flex h-10 w-10 items-center justify-center">
                  {isGlsCarrier(tracking?.company) ? (
                    <Image src={glsLogo} alt="GLS logo" className="h-8 w-8 object-contain" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                      <PackageCheck className="h-5 w-5" />
                    </span>
                  )}
                </span>
                <span>{carrier}</span>
              </DialogTitle>
              <div className="flex items-center gap-3">
                <span className={`rounded px-2.5 py-1 text-xs font-medium ${getStatusClasses(statusLabel)}`}>
                  {statusLabel}
                </span>
                <DialogClose
                  className="inline-flex h-5 w-5 items-center justify-center text-slate-400 transition-colors hover:text-slate-600"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </DialogClose>
              </div>
            </div>
            <DialogDescription>
              Internal tracking lookup for the current order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tracking #
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {trackingNumber || "Unavailable"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Order
                  </div>
                  <div className="mt-1 text-lg font-medium text-slate-900">
                    {orderLabel ? `#${orderLabel}` : "Unknown order"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Timeline
              </div>
              <div className="mt-4 space-y-4">
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading tracking events...
                  </div>
                ) : (
                  timeline.map((event, index) => (
                    <div key={event.id} className="flex gap-4">
                      <div className="flex w-4 flex-col items-center">
                        <div
                          className={`mt-1 h-3 w-3 rounded-full ${
                            event.isCurrent ? "bg-emerald-600" : "bg-slate-300"
                          }`}
                        />
                        {index < timeline.length - 1 ? (
                          <div className="mt-2 w-px flex-1 bg-slate-200" />
                        ) : null}
                      </div>
                      <div className="min-w-0 pb-4">
                        <div className="text-base font-semibold text-slate-900">{event.title}</div>
                        {event.meta ? (
                          <div className="mt-0.5 text-sm text-slate-600">{event.meta}</div>
                        ) : null}
                        {event.detail ? (
                          <div className="mt-0.5 text-sm text-slate-500">{event.detail}</div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {trackingUrl ? (
              <div className="flex justify-end">
                <Button asChild className="bg-slate-900 text-white hover:bg-slate-800">
                  <a href={trackingUrl} target="_blank" rel="noreferrer">
                    Open carrier tracking
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
