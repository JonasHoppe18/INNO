import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Loader2, Truck, X } from "lucide-react";
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
import postNordLogo from "../../../../assets/PostNord_logo.png";

function CarrierLogo({ carrier = "", className = "h-8 w-8" }) {
  const lower = String(carrier || "").toLowerCase();

  if (lower.includes("gls")) {
    return <Image src={glsLogo} alt="GLS" className={`${className} object-contain`} />;
  }
  if (lower.includes("postnord") || lower.includes("post nord")) {
    return <Image src={postNordLogo} alt="PostNord" className={`${className} object-contain`} />;
  }
  if (lower.includes("dao")) {
    return (
      <svg viewBox="0 0 48 48" className={`${className} flex-none`} aria-label="DAO">
        <rect width="48" height="48" rx="10" fill="#E3001B" />
        <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="12" fontWeight="700" fontFamily="system-ui,sans-serif">DAO</text>
      </svg>
    );
  }
  if (lower === "bring") {
    return (
      <svg viewBox="0 0 48 48" className={`${className} flex-none`} aria-label="Bring">
        <rect width="48" height="48" rx="10" fill="#E8001B" />
        <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="system-ui,sans-serif">BRING</text>
      </svg>
    );
  }
  if (lower === "dhl") {
    return (
      <svg viewBox="0 0 48 48" className={`${className} flex-none`} aria-label="DHL">
        <rect width="48" height="48" rx="10" fill="#FFCC00" />
        <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fill="#D40511" fontSize="14" fontWeight="800" fontFamily="system-ui,sans-serif">DHL</text>
      </svg>
    );
  }
  if (lower === "ups") {
    return (
      <svg viewBox="0 0 48 48" className={`${className} flex-none`} aria-label="UPS">
        <rect width="48" height="48" rx="10" fill="#351C15" />
        <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fill="#FFB500" fontSize="13" fontWeight="700" fontFamily="system-ui,sans-serif">UPS</text>
      </svg>
    );
  }
  // Fallback: truck icon
  return (
    <div className={`${className} flex-none flex items-center justify-center rounded-xl bg-slate-100 text-slate-500`}>
      <Truck className="h-5 w-5" />
    </div>
  );
}

function getStatusClasses(status = "") {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("out for delivery") || lower.includes("ude til levering")) return "bg-amber-50 text-amber-700 border border-amber-200";
  if (lower.includes("delivered") || lower.includes("leveret")) return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (lower.includes("pickup") || lower.includes("afhent") || lower.includes("pakkeshop")) return "bg-purple-50 text-purple-700 border border-purple-200";
  if (lower.includes("transit") || lower.includes("shipped") || lower.includes("afsendt")) return "bg-blue-50 text-blue-700 border border-blue-200";
  if (lower.includes("delay") || lower.includes("exception") || lower.includes("forsink")) return "bg-red-50 text-red-700 border border-red-200";
  return "bg-slate-100 text-slate-600 border border-slate-200";
}

function getStatusTextColor(status = "") {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("out for delivery") || lower.includes("ude til levering")) return "text-amber-600";
  if (lower.includes("delivered") || lower.includes("leveret")) return "text-emerald-600";
  if (lower.includes("pickup") || lower.includes("afhent") || lower.includes("pakkeshop")) return "text-purple-600";
  if (lower.includes("transit") || lower.includes("shipped") || lower.includes("afsendt")) return "text-blue-600";
  if (lower.includes("delay") || lower.includes("exception") || lower.includes("forsink")) return "text-red-600";
  return "text-slate-500";
}

function getStatusDotClasses(status = "") {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("out for delivery") || lower.includes("ude til levering")) return "bg-amber-500";
  if (lower.includes("delivered") || lower.includes("leveret")) return "bg-emerald-500";
  if (lower.includes("pickup") || lower.includes("afhent") || lower.includes("pakkeshop")) return "bg-purple-500";
  if (lower.includes("transit") || lower.includes("shipped")) return "bg-blue-500";
  if (lower.includes("delay") || lower.includes("exception")) return "bg-red-500";
  return "bg-slate-400";
}

function getCarrierLabel(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Carrier";
  const lower = text.toLowerCase();
  if (lower.includes("postnord") || lower.includes("post nord")) return "PostNord";
  if (lower.includes("gls")) return "GLS";
  return text;
}

function getTrackingStatusLabel({ tracking = null, order = null, timeline = [] }) {
  const latestTimelineStatus = String(timeline?.[0]?.title || "").trim();
  if (latestTimelineStatus) return latestTimelineStatus;
  const explicitStatus = normalizeTrackingStatusLabel(tracking?.status);
  if (explicitStatus) return explicitStatus;
  if (String(order?.fulfillmentStatus || "").toLowerCase() === "fulfilled") return "Shipped";
  return "Tracking available";
}

export function TrackingCard({ order = null, threadId = null }) {
  const [open, setOpen] = useState(false);
  const [timelineLogs, setTimelineLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const tracking = order?.tracking || null;
  const trackingNumber = String(tracking?.number || "").trim();
  const trackingUrl = String(tracking?.url || "").trim();
  const carrier = getCarrierLabel(tracking?.company);
  const orderLabel = String(order?.id || "").trim();

  const timeline = useMemo(
    () => buildTrackingTimeline({ logs: timelineLogs, order }),
    [order, timelineLogs]
  );

  const statusLabel = useMemo(
    () => getTrackingStatusLabel({ tracking, order, timeline }),
    [order, timeline, tracking]
  );

  // Extract pickup point from newest carrier_tracking log snapshot
  const pickupPoint = useMemo(() => {
    const carrierLog = [...(timelineLogs || [])]
      .filter((l) => String(l?.step_name || "").toLowerCase() === "carrier_tracking")
      .sort((a, b) => (Date.parse(b?.created_at) || 0) - (Date.parse(a?.created_at) || 0))[0];
    if (!carrierLog) return null;
    try {
      const parsed = JSON.parse(String(carrierLog?.step_detail || "{}"));
      const pp = parsed?.snapshot?.pickupPoint;
      if (!pp) return null;
      const name = String(pp.name || "").trim();
      const address = String(pp.address || "").trim();
      const city = String(pp.city || pp.postalCode || "").trim();
      if (!name && !address && !city) return null;
      return { name, address, city };
    } catch { return null; }
  }, [timelineLogs]);

  useEffect(() => {
    let active = true;
    const fetchTimeline = async () => {
      if (!open || !threadId) return;
      setLoading(true);
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/insights`).catch(() => null);
      if (!active) return;
      if (!response?.ok) { setTimelineLogs([]); setLoading(false); return; }
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      setTimelineLogs(Array.isArray(payload?.logs) ? payload.logs : []);
      setLoading(false);
    };
    fetchTimeline();
    return () => { active = false; };
  }, [open, threadId]);

  if (!trackingNumber && !trackingUrl) return null;

  return (
    <>
      {/* Inline card in ticket thread */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex w-fit min-w-[220px] max-w-[360px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 text-left"
      >
        <CarrierLogo carrier={carrier} className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">Track shipment</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
            <span>{carrier}</span>
            <span className="text-slate-300 mx-0.5">·</span>
            <span className={`font-medium ${getStatusTextColor(statusLabel)}`}>{statusLabel.split(" · ")[0]}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            {trackingNumber || "No tracking number"}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-none text-slate-300 group-hover:text-slate-500 transition-colors" />
      </button>

      {/* Detail modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px] [&>button]:hidden">
          <DialogHeader className="space-y-0">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold text-slate-900">
                <CarrierLogo carrier={carrier} className="h-8 w-8" />
                <span>{carrier}</span>
              </DialogTitle>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClasses(statusLabel)}`}>
                  {statusLabel}
                </span>
                <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                  <X className="h-4 w-4" />
                </DialogClose>
              </div>
            </div>
            <DialogDescription className="text-xs text-slate-400 mt-1">
              Live tracking for order {orderLabel ? `#${orderLabel}` : ""}
            </DialogDescription>
          </DialogHeader>

          {/* Tracking number + order */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tracking #</div>
                <div className="mt-1 font-mono text-sm font-medium text-slate-800 break-all">
                  {trackingNumber || "–"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Order</div>
                <div className="mt-1 text-sm font-medium text-slate-800">
                  {orderLabel ? `#${orderLabel}` : "–"}
                </div>
              </div>
            </div>
          </div>

          {/* Pickup point */}
          {pickupPoint && (
            <div className="rounded-lg border border-purple-100 bg-purple-50 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-1">Pickup point</div>
              <div className="text-sm font-semibold text-slate-900">{pickupPoint.name}</div>
              {pickupPoint.address && (
                <div className="text-xs text-slate-500 mt-0.5">{pickupPoint.address}</div>
              )}
              {pickupPoint.city && (
                <div className="text-xs text-slate-500">{pickupPoint.city}</div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Timeline</div>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tracking events...
              </div>
            ) : timeline.length === 0 ? (
              <div className="py-4 text-sm text-slate-400">No tracking events available.</div>
            ) : (
              <div className="space-y-0">
                {timeline.map((event, index) => (
                  <div key={event.id} className="flex gap-3">
                    {/* Dot + line */}
                    <div className="flex w-5 flex-col items-center pt-1">
                      <div className={`h-2.5 w-2.5 flex-none rounded-full ${event.isCurrent ? getStatusDotClasses(statusLabel) : "bg-slate-200"}`} />
                      {index < timeline.length - 1 && (
                        <div className="mt-1 w-px flex-1 bg-slate-100 min-h-[20px]" />
                      )}
                    </div>
                    {/* Content */}
                    <div className="min-w-0 pb-4">
                      <div className={`text-sm font-semibold ${event.isCurrent ? "text-slate-900" : "text-slate-500"}`}>
                        {event.title}
                      </div>
                      {event.meta ? (
                        <div className="mt-0.5 text-xs text-slate-400">{event.meta}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open carrier link */}
          {trackingUrl && (
            <div className="flex justify-end border-t border-slate-100 pt-3">
              <Button asChild size="sm" className="bg-slate-900 text-white hover:bg-slate-700">
                <a href={trackingUrl} target="_blank" rel="noreferrer">
                  Open carrier tracking
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
