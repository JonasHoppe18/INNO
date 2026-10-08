import { formatDateTime } from "@/lib/format/datetime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, ExternalLink, Loader2, Truck, X } from "lucide-react";
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
import bringLogo from "../../../../assets/Bring logo.png";
import glsLogo from "../../../../assets/GLS logo.png";
import postNordLogo from "../../../../assets/PostNord_logo.png";

export function CarrierLogo({ carrier = "", className = "h-8 w-8" }) {
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
  if (lower.includes("bring")) {
    return (
      <Image
        src={bringLogo}
        alt="Bring"
        className={`${className} flex-none object-contain`}
      />
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
    <div className={`${className} flex-none flex items-center justify-center rounded-[25%] bg-slate-100 text-slate-500`}>
      <Truck className="h-[60%] w-[60%]" />
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

// Events an agent should notice: failed delivery attempts, exceptions, delays.
const EXCEPTION_EVENT_PATTERN =
  /not possible|could not|unable|failed|exception|delay|returned to sender|ikke muligt|kunne ikke|forsink|retur til afsender/i;

function getCarrierLabel(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Carrier";
  const lower = text.toLowerCase();
  if (lower.includes("postnord") || lower.includes("post nord")) return "PostNord";
  if (lower.includes("gls")) return "GLS";
  return text;
}

function buildPublicTrackingUrl({ carrier = "", trackingNumber = "" } = {}) {
  const number = String(trackingNumber || "").trim();
  if (!number) return "";
  const encoded = encodeURIComponent(number);
  const lower = String(carrier || "").toLowerCase();
  if (lower.includes("postnord") || lower.includes("post nord")) {
    return `https://www.postnord.dk/track-trace?shipmentId=${encoded}`;
  }
  if (lower.includes("gls")) {
    return `https://gls-group.eu/track?match=${encoded}`;
  }
  if (lower.includes("dao")) {
    return `https://www.dao.as/track-and-trace/?id=${encoded}`;
  }
  if (lower.includes("bring") || lower.includes("no-post") || lower.includes("posten")) {
    return `https://sporing.bring.no/sporing/${encoded}`;
  }
  if (lower.includes("dhl")) {
    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encoded}`;
  }
  if (lower.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${encoded}`;
  }
  return "";
}

function getTrackingStatusLabel({ tracking = null, order = null, timeline = [] }) {
  const latestTimelineStatus = String(timeline?.[0]?.title || "").trim();
  if (latestTimelineStatus) return normalizeTrackingStatusLabel(latestTimelineStatus);
  const explicitStatus = normalizeTrackingStatusLabel(tracking?.status);
  if (explicitStatus) return explicitStatus;
  if (String(order?.fulfillmentStatus || "").toLowerCase() === "fulfilled") return "Shipped";
  return "Tracking available";
}

export function TrackingCard({
  order = null,
  threadId = null,
  fullWidth = false,
  compact = false,
  title = "Track shipment",
  descriptionPrefix = "Live tracking for order",
  direction = "unknown",
}) {
  const [open, setOpen] = useState(false);
  // Live snapshot fetched directly from carrier API
  const [liveDetail, setLiveDetail] = useState(null);
  // Fallback: stored agent_log entries
  const [timelineLogs, setTimelineLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const tracking = order?.tracking || null;
  const trackingNumber = String(tracking?.number || "").trim();
  const trackingUrl = String(tracking?.url || "").trim();
  const carrier = getCarrierLabel(tracking?.company);
  const effectiveTrackingUrl = trackingUrl || buildPublicTrackingUrl({ carrier, trackingNumber });
  // Prefer display number (#4229) over internal Shopify ID
  const orderLabel = String(order?.name || order?.orderNumber || order?.order_number || order?.id || "").trim().replace(/^#/, "");

  // Build timeline: prefer live snapshot events, fall back to stored logs
  const timeline = useMemo(() => {
    if (liveDetail?.snapshot) {
      // Inject live snapshot into a fake log so buildTrackingTimeline can parse it
      const fakeLog = {
        id: "live",
        step_name: "carrier_tracking",
        step_detail: JSON.stringify({
          carrier: liveDetail.carrier,
          status: liveDetail.statusText,
          snapshot: liveDetail.snapshot,
        }),
        created_at: new Date().toISOString(),
      };
      return buildTrackingTimeline({ logs: [fakeLog], order });
    }
    return buildTrackingTimeline({ logs: timelineLogs, order });
  }, [liveDetail, order, timelineLogs]);

  const statusLabel = useMemo(
    () => getTrackingStatusLabel({ tracking, order, timeline }),
    [order, timeline, tracking]
  );

  // Extract pickup point from live snapshot or stored logs
  const pickupPoint = useMemo(() => {
    const pp = liveDetail?.snapshot?.pickupPoint || null;
    if (pp) {
      const name = String(pp.name || "").trim();
      const address = String(pp.address || "").trim();
      const city = String(pp.city || pp.postalCode || "").trim();
      if (name || address || city) return { name, address, city };
    }
    const carrierLog = [...(timelineLogs || [])]
      .filter((l) => String(l?.step_name || "").toLowerCase() === "carrier_tracking")
      .sort((a, b) => (Date.parse(b?.created_at) || 0) - (Date.parse(a?.created_at) || 0))[0];
    if (!carrierLog) return null;
    try {
      const parsed = JSON.parse(String(carrierLog?.step_detail || "{}"));
      const storedPp = parsed?.snapshot?.pickupPoint;
      if (!storedPp) return null;
      const name = String(storedPp.name || "").trim();
      const address = String(storedPp.address || "").trim();
      const city = String(storedPp.city || storedPp.postalCode || "").trim();
      if (!name && !address && !city) return null;
      return { name, address, city };
    } catch { return null; }
  }, [liveDetail, timelineLogs]);

  const fetchLive = useCallback(async (force = false) => {
    if (!trackingNumber || !threadId) return;
    setLoading(true);
    setLiveDetail(null);
    try {
      const params = new URLSearchParams({ trackingNumber });
      if (effectiveTrackingUrl) params.set("trackingUrl", effectiveTrackingUrl);
      if (tracking?.company) params.set("company", tracking.company);
      if (direction) params.set("direction", direction);
      if (force) params.set("force", "true");
      const res = await fetch(
        `/api/threads/${encodeURIComponent(threadId)}/tracking/refresh?${params}`
      ).catch(() => null);
      if (res?.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.detail) {
          setLiveDetail(body.detail);
          setLoading(false);
          return;
        }
      }
    } catch { /* fall through to stored logs */ }
    // Fallback: load stored logs from insights endpoint
    const response = await fetch(
      `/api/threads/${encodeURIComponent(threadId)}/insights`
    ).catch(() => null);
    if (response?.ok) {
      const payload = await response.json().catch(() => ({}));
      const logs = Array.isArray(payload?.logs) ? payload.logs : [];
      setTimelineLogs(logs);
    }
    setLoading(false);
  }, [direction, threadId, trackingNumber, effectiveTrackingUrl, tracking?.company]);

  useEffect(() => {
    // The compact row already loaded live data; don't blank and refetch it.
    if (open && !liveDetail) fetchLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only (re)fetch when the dialog opens.
  }, [open, fetchLive]);

  // The panel row shows the carrier's live status, not Shopify's fulfillment
  // fallback, so it matches the dialog. The refresh route serves its
  // tracking_snapshots cache while fresh, so this rarely hits the carrier.
  useEffect(() => {
    if (compact) fetchLive();
  }, [compact, fetchLive]);

  const [copied, setCopied] = useState(false);
  const copyTrackingNumber = useCallback(async () => {
    if (!trackingNumber) return;
    try {
      await navigator.clipboard.writeText(trackingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions/insecure context); nothing to do.
    }
  }, [trackingNumber]);

  if (!trackingNumber && !trackingUrl) return null;

  return (
    <>
      {compact ? (
        // Panel row: borderless like the rest of the ticket details panel.
        // A wide logo frame keeps wordmarks (PostNord, GLS, Bring) legible.
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/50 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
        >
          <span className="flex h-7 w-12 flex-none items-center justify-center overflow-hidden rounded-md border border-border/70 bg-white px-1 dark:bg-white/95">
            <CarrierLogo carrier={carrier} className="h-full w-full" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5 text-xs">
              {direction === "return" ? (
                <span className="shrink-0 text-muted-foreground">Return ·</span>
              ) : null}
              <span className="shrink-0 font-medium text-foreground">{carrier}</span>
              <span className={`size-1.5 shrink-0 rounded-full ${getStatusDotClasses(statusLabel)}`} aria-hidden="true" />
              <span className={`truncate font-medium ${getStatusTextColor(statusLabel)}`}>
                {statusLabel.split(" · ")[0]}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">
              {trackingNumber || "No tracking number"}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 flex-none text-muted-foreground/60 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground" />
        </button>
      ) : (
        // Inline card in ticket thread
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group inline-flex items-center border border-border/70 bg-card/80 shadow-none transition-[border-color,background-color,transform] duration-150 ease-out hover:border-border hover:bg-muted/25 active:scale-[0.995] text-left ${
          compact ? "gap-2 rounded-lg bg-background/60 px-2.5 py-2" : "gap-2.5 rounded-xl px-3 py-2.5"
        } ${
          fullWidth
            ? "w-full min-w-0 max-w-none"
            : "w-full min-w-0 max-w-none sm:w-fit sm:min-w-[220px] sm:max-w-[340px]"
        }`}
      >
        <span className={`flex flex-none items-center justify-center rounded-lg border border-border/60 bg-muted/35 ${compact ? "h-7 w-7 rounded-md" : "h-8 w-8"}`}>
          <CarrierLogo carrier={carrier} className={compact ? "h-5 w-5" : "h-6 w-6"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={`font-semibold text-foreground ${compact ? "text-xs leading-4" : "text-sm leading-5"}`}>{title}</div>
          <div className={`mt-0.5 flex min-w-0 items-center gap-1 text-muted-foreground ${compact ? "text-xs" : "text-xs"}`}>
            <span>{carrier}</span>
            <span className="mx-0.5 text-muted-foreground/45">·</span>
            <span className={`truncate font-medium ${getStatusTextColor(statusLabel)}`}>{statusLabel.split(" · ")[0]}</span>
          </div>
          <div className={`mt-0.5 truncate font-mono text-muted-foreground/70 ${compact ? "text-xs" : "text-xs"}`}>
            {trackingNumber || "No tracking number"}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/45 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </button>

      )}

      {/* Detail modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 sm:max-w-[520px] [&>button]:hidden">
          <DialogHeader className="space-y-0">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-16 flex-none items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-white px-1.5 dark:bg-white/95">
                <CarrierLogo carrier={carrier} className="h-full w-full" />
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-foreground">
                  {orderLabel ? `Order #${orderLabel}` : carrier}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {direction === "return" ? "Return shipment" : "Shipment"} with {carrier}
                </DialogDescription>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClasses(statusLabel)}`}>
                {statusLabel.split(" · ")[0]}
              </span>
              <DialogClose className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Tracking number</div>
              <div className="mt-0.5 truncate text-sm font-medium tabular-nums text-foreground">
                {trackingNumber || "–"}
              </div>
            </div>
            {trackingNumber ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5"
                onClick={copyTrackingNumber}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            ) : null}
          </div>

          {pickupPoint && (
            <div className="rounded-lg border border-purple-200/70 bg-purple-50/60 px-3 py-2.5 dark:border-purple-500/20 dark:bg-purple-500/10">
              <div className="text-xs text-purple-700 dark:text-purple-300">Pickup point</div>
              <div className="mt-0.5 text-sm font-medium text-foreground">{pickupPoint.name}</div>
              {pickupPoint.address || pickupPoint.city ? (
                <div className="text-xs text-muted-foreground">
                  {[pickupPoint.address, pickupPoint.city].filter(Boolean).join(", ")}
                </div>
              ) : null}
            </div>
          )}

          <div>
            <div className="mb-3 text-sm font-semibold text-foreground">Timeline</div>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tracking events...
              </div>
            ) : timeline.length === 0 ? (
              <div className="py-4 text-sm text-muted-foreground">No tracking events available.</div>
            ) : (
              <ol className="max-h-[50vh] overflow-y-auto pr-1">
                {timeline.map((event, index) => {
                  const label = event.label || event.title;
                  const isException = EXCEPTION_EVENT_PATTERN.test(String(label || ""));
                  return (
                    <li key={event.id} className="flex gap-3">
                      <div className="flex w-4 shrink-0 flex-col items-center pt-1.5">
                        <div
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            event.isCurrent
                              ? getStatusDotClasses(statusLabel)
                              : isException
                                ? "bg-amber-500"
                                : "bg-border"
                          }`}
                        />
                        {index < timeline.length - 1 && <div className="mt-1 min-h-[20px] w-px flex-1 bg-border/70" />}
                      </div>
                      <div className="min-w-0 flex-1 pb-4">
                        <div className="flex items-baseline justify-between gap-3">
                          <div
                            className={`min-w-0 text-sm ${
                              event.isCurrent
                                ? "font-semibold text-foreground"
                                : isException
                                  ? "font-medium text-warning-foreground"
                                  : "text-foreground/80"
                            }`}
                          >
                            {isException && !event.isCurrent ? (
                              <AlertTriangle aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
                            ) : null}
                            {label}
                          </div>
                          {event.timestamp || event.time ? (
                            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                              {formatDateTime(event.timestamp) || event.time}
                            </span>
                          ) : null}
                        </div>
                        {event.meta ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{event.meta}</div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {(effectiveTrackingUrl || trackingNumber) && (
            <div className="flex justify-end gap-2 border-t border-border/70 pt-3">
              {trackingNumber && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => fetchLive(true)}
                >
                  {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Refresh
                </Button>
              )}
              {effectiveTrackingUrl && (
                <Button asChild size="sm">
                  <a href={effectiveTrackingUrl} target="_blank" rel="noreferrer">
                    Open carrier tracking
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
