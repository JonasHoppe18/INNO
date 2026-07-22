import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SonaActivityContent } from "@/components/inbox/SonaActivityContent";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { ChevronRight, ExternalLink, Truck, X } from "lucide-react";
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { ManualActionDialog } from "@/components/inbox/ManualActionDialog";
import { CORE_ACTIONS } from "@/lib/action-modes";
import { MANUAL_ACTION_TYPES, resolveMatchedOrder } from "@/lib/inbox/manual-actions";

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const DISPLAY_TIMEZONE = "Europe/Copenhagen";
const MANUAL_CORE_ACTIONS = CORE_ACTIONS.filter((action) => MANUAL_ACTION_TYPES.includes(action.type));

const SONA_INTENT_LABELS = {
  tracking: "Tracking",
  return: "Return",
  refund: "Refund",
  exchange: "Exchange",
  address_change: "Address change",
  product_question: "Product question",
  complaint: "Complaint",
  thanks: "Thanks",
  update: "Status update",
  other: "General inquiry",
};

const getSonaConfidenceLabel = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Analysis available";
  if (value >= 0.85) return "High confidence";
  if (value >= 0.65) return "Medium confidence";
  return "Needs review";
};

const stripThreadMeta = (value) =>
  String(value || "")
    .replace(/\|?\s*thread_id\s*[:=]\s*[a-z0-9-]+/gi, "")
    .replace(/\s*\|thread_id:[a-z0-9-]+\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const parseLogDetail = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      detail: "",
      threadId: null,
      orderId: null,
      action: null,
      trackingStatus: null,
      trackingCarrier: null,
      trackingNumber: null,
      trackingUrl: null,
      trackingSource: null,
      trackingLookupSource: null,
      trackingLookupDetail: null,
      trackingEvents: [],
    };
  }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const detail =
        asString(parsed?.detail) ||
        asString(parsed?.message) ||
        asString(parsed?.summary) ||
        asString(parsed?.text) ||
        asString(parsed?.action) ||
        asString(parsed?.error) ||
        asString(parsed?.reason) ||
        asString(parsed?.status);
      return {
        ...parsed,
        detail: stripThreadMeta(detail),
        threadId: asString(parsed?.thread_id || parsed?.threadId) || null,
        orderId:
          asString(parsed?.order_id || parsed?.orderId) ||
          (typeof parsed?.orderId === "number" ? String(parsed.orderId) : null),
        action: asString(parsed?.action || parsed?.actionType) || null,
        trackingStatus: asString(parsed?.status || parsed?.tracking_status) || null,
        trackingCarrier: asString(parsed?.carrier) || null,
        trackingNumber: asString(parsed?.tracking_number || parsed?.trackingNumber) || null,
        trackingUrl: asString(parsed?.tracking_url || parsed?.trackingUrl) || null,
        trackingSource: asString(parsed?.source) || null,
        trackingLookupSource:
          asString(parsed?.lookup_source || parsed?.lookupSource) || null,
        trackingLookupDetail:
          asString(parsed?.lookup_detail || parsed?.lookupDetail) || null,
        trackingEvents: summarizeTrackingEvents(parsed?.snapshot || null),
      };
    } catch {
      return {
        detail: stripThreadMeta(raw),
        threadId: null,
        orderId: null,
        action: null,
        trackingStatus: null,
        trackingCarrier: null,
        trackingNumber: null,
        trackingUrl: null,
        trackingSource: null,
        trackingLookupSource: null,
        trackingLookupDetail: null,
        trackingEvents: [],
      };
    }
  }
  return {
    detail: stripThreadMeta(raw),
    threadId: null,
    orderId: null,
    action: null,
    trackingStatus: null,
    trackingCarrier: null,
    trackingNumber: null,
    trackingUrl: null,
    trackingSource: null,
    trackingLookupSource: null,
    trackingLookupDetail: null,
    trackingEvents: [],
  };
};

const normalizeTrackingStatusLabel = (value) => {
  const text = asString(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("delivered") || lower.includes("leveret")) return "Delivered";
  if (lower.includes("afsendt - følg pakken via tracking-link")) {
    return "Shipped - follow the parcel via tracking link";
  }
  if (lower === "afsendt") return "Shipped";
  return text;
};

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

const GENERIC_TRACKING_EVENT_PATTERN = /^tracking event$/i;
const COUNTRY_ONLY_LOCATION_PATTERN = /^[a-z]{2}$/i;

const mapGlsEventCodeToDescription = (code) => {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/[^A-Z]/g, "");
  if (raw.includes("DELIVD") && (raw.includes("PSAPP") || raw.includes("PARCELSHOP"))) {
    return "Delivered to parcel shop";
  }
  if (raw.includes("OUTDEL")) return "Out for delivery";
  if (raw.includes("INBOD") || raw.includes("INBOUD")) return "Arrived at distribution center";
  if (raw.includes("OUTBOD")) return "Departed from distribution center";
  if (raw.includes("INTIAL") && raw.includes("PREADVICE")) {
    return "Shipment data received by carrier";
  }
  if (raw.includes("INTIAL")) return "Shipment accepted by carrier";
  if (compact === "PREADVICE") return "Shipment data received by carrier";
  if (compact === "PLANNEDPICKUP") return "Pickup planned";
  if (compact === "INPICKUP") return "Picked up by carrier";
  if (compact === "NOTPICKEDUP") return "Pickup not completed";
  if (compact === "INTRANSIT") return "In transit";
  if (compact === "INDELIVERY") return "Out for delivery";
  if (compact === "DELIVEREDPS") return "Delivered to parcel shop";
  if (compact === "INWAREHOUSE") return "Ready for pickup";
  if (compact === "DELIVERED" || compact === "FINAL") return "Delivered";
  if (compact === "NOTDELIVERED") return "Delivery attempt failed";
  if (compact === "CANCELED") return "Shipment canceled";
  return "";
};

const describeTrackingEvent = (event) => {
  const description = asString(event?.description);
  const code = asString(event?.code);
  if (description && !GENERIC_TRACKING_EVENT_PATTERN.test(description)) {
    const mappedFromDescription = mapGlsEventCodeToDescription(description);
    if (mappedFromDescription) return mappedFromDescription;
    return description;
  }
  const mappedFromCode = mapGlsEventCodeToDescription(code);
  if (mappedFromCode) return mappedFromCode;
  if (code) {
    return code
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "Tracking event";
};

const normalizeEventLocation = (value) => {
  const location = asString(value);
  if (!location) return "";
  if (COUNTRY_ONLY_LOCATION_PATTERN.test(location)) return "";
  return location;
};

const summarizeTrackingEvents = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.events)) return [];
  return [...snapshot.events]
    .filter((event) => event?.description || event?.code || event?.occurredAt)
    .sort((a, b) => {
      const aTs = a?.occurredAt ? Date.parse(String(a.occurredAt)) : Number.NaN;
      const bTs = b?.occurredAt ? Date.parse(String(b.occurredAt)) : Number.NaN;
      const aValid = Number.isFinite(aTs);
      const bValid = Number.isFinite(bTs);
      if (aValid && bValid) return bTs - aTs;
      if (aValid) return -1;
      if (bValid) return 1;
      return 0;
    })
    .slice(0, 4)
    .map((event) => {
      const description = describeTrackingEvent(event);
      const location = normalizeEventLocation(event?.location);
      return location ? `${description} (${location})` : description;
    })
    .filter(Boolean);
};

export function SonaInsightsModal({
  open,
  onOpenChange,
  actions,
  draftId,
  threadId,
  customerLookup,
  customerLookupLoading,
  customerLookupError,
  onCustomerRefresh,
  customerLookupParams,
  onOpenTicket,
  returnTrackingActionState = null,
  onSeedPendingOrderUpdate,
  onOrderUpdateDecision,
}) {
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [returnTrackingDetail, setReturnTrackingDetail] = useState(null);
  const [returnTrackingLoading, setReturnTrackingLoading] = useState(false);
  const containerElRef = useRef(null);
  const containerRef = useCallback((node) => {
    containerElRef.current = node;
  }, []);
  const [sonaLogOpen, setSonaLogOpen] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [activeManualAction, setActiveManualAction] = useState(null);

  const {
    data: internalLookup,
    loading: internalLookupLoading,
    error: internalLookupError,
    refresh: internalLookupRefresh,
  } = useCustomerLookup({
    ...customerLookupParams,
    enabled: open && Boolean(customerLookupParams?.threadId),
  });

  const effectiveLookup = customerLookup ?? internalLookup;
  const effectiveLookupLoading = customerLookup != null ? customerLookupLoading : internalLookupLoading;
  const effectiveLookupError = customerLookup != null ? customerLookupError : internalLookupError;
  const effectiveRefresh = onCustomerRefresh ?? internalLookupRefresh;
  const trackingOrder = useMemo(() => {
    const orders = Array.isArray(effectiveLookup?.orders) ? effectiveLookup.orders : [];
    return orders.find((order) => order?.tracking?.number || order?.tracking?.url) || null;
  }, [effectiveLookup?.orders]);
  const matchedOrder = useMemo(
    () => resolveMatchedOrder(effectiveLookup?.orders),
    [effectiveLookup?.orders]
  );
  const hasShopifyShop = Boolean(effectiveLookup?.shopDomain);
  const returnTrackingCandidate = returnTrackingActionState?.candidates?.[0] || null;
  const returnTrackingNumber = String(
    returnTrackingCandidate?.normalized_tracking_number ||
      returnTrackingCandidate?.tracking_number ||
      "",
  );
  const returnTrackingState = returnTrackingNumber
    ? returnTrackingActionState?.stateByNumber?.[returnTrackingNumber] ||
      (returnTrackingCandidate?.already_added ? "duplicate" : "")
    : "";
  const returnTrackingStatusLabel =
    normalizeTrackingStatusLabel(returnTrackingDetail?.statusText || returnTrackingDetail?.status || "") ||
    (returnTrackingLoading ? "Checking carrier..." : "Tracking available");
  const returnTrackingOrder = useMemo(() => {
    if (!returnTrackingCandidate || !returnTrackingNumber) return null;
    const carrier = returnTrackingDetail?.carrier || returnTrackingCandidate.carrier || "";
    const trackingNumber = returnTrackingCandidate.tracking_number || returnTrackingNumber;
    return {
      id: returnTrackingCandidate.order_number || returnTrackingNumber,
      name: returnTrackingCandidate.order_number || "",
      orderNumber: returnTrackingCandidate.order_number || "",
      order_number: returnTrackingCandidate.order_number || "",
      tracking: {
        number: trackingNumber,
        company: carrier,
        url: buildPublicTrackingUrl({ carrier, trackingNumber }),
        status: returnTrackingStatusLabel,
      },
    };
  }, [returnTrackingCandidate, returnTrackingDetail?.carrier, returnTrackingNumber, returnTrackingStatusLabel]);

  useEffect(() => {
    setDiagnostic(null);
  }, [threadId]);

  useEffect(() => {
    let active = true;
    const fetchReturnTracking = async () => {
      setReturnTrackingDetail(null);
      if (!open || !threadId || !returnTrackingNumber) return;
      setReturnTrackingLoading(true);
      try {
        const params = new URLSearchParams({ trackingNumber: returnTrackingNumber });
        if (returnTrackingCandidate?.carrier) params.set("company", returnTrackingCandidate.carrier);
        const response = await fetch(
          `/api/threads/${encodeURIComponent(threadId)}/tracking/refresh?${params.toString()}`
        ).catch(() => null);
        if (!active) return;
        const body = await response?.json?.().catch(() => ({}));
        if (response?.ok && body?.detail) {
          setReturnTrackingDetail(body.detail);
        }
      } finally {
        if (active) setReturnTrackingLoading(false);
      }
    };
    fetchReturnTracking();
    return () => {
      active = false;
    };
  }, [open, returnTrackingCandidate?.carrier, returnTrackingNumber, threadId]);

  useEffect(() => {
    let active = true;
    const fetchLogs = async () => {
      if (!open || !threadId) {
        setLogs([]);
        setLogsLoading(false);
        return;
      }
      setLogsLoading(true);
      const res = await fetch(
        `/api/threads/${encodeURIComponent(threadId)}/insights`,
        { method: "GET" }
      ).catch(() => null);
      if (!active) return;
      if (!res?.ok) {
        setLogs([]);
      } else {
        const payload = await res.json().catch(() => ({}));
        setLogs(Array.isArray(payload?.logs) ? payload.logs : []);
        setDiagnostic(payload?.diagnostic ?? null);
      }
      setLogsLoading(false);
    };
    fetchLogs();
    return () => {
      active = false;
    };
  }, [draftId, open, threadId]);

  const trackingInfo = useMemo(() => {
    const trackingLog = logs.find(
      (log) => String(log?.step_name || "").toLowerCase() === "carrier_tracking"
    );
    if (!trackingLog) return null;
    const parsed = parseLogDetail(trackingLog.step_detail);
    if (!parsed?.trackingCarrier && !parsed?.trackingNumber && !parsed?.trackingStatus) return null;
    return parsed;
  }, [logs]);

  const knowledgeGaps = useMemo(() => {
    const gapLog = logs.find(
      (log) => String(log?.step_name || "").toLowerCase() === "knowledge_gap_detected"
    );
    if (!gapLog) return [];
    const parsed = parseLogDetail(gapLog.step_detail);
    return Array.isArray(parsed?.gaps) ? parsed.gaps : [];
  }, [logs]);
  useEffect(() => {
    if (open) return;
    const containerEl = containerElRef.current;
    if (!containerEl || typeof document === "undefined") return;
    const activeEl = document.activeElement;
    if (activeEl && containerEl.contains(activeEl) && typeof activeEl.blur === "function") {
      activeEl.blur();
    }
  }, [open]);

  return (
    <aside
      ref={containerRef}
      className={`flex h-full min-w-0 flex-none flex-col overflow-hidden border-l border-border bg-background transition-[width] duration-200 ease-linear ${
        open ? "w-[clamp(20rem,24vw,28rem)]" : "w-0"
      }`}
      aria-hidden={!open}
    >
      {open ? (
      <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden p-3 lg:p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sona Insights</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(event) => {
              if (typeof event?.currentTarget?.blur === "function") {
                event.currentTarget.blur();
              }
              onOpenChange(false);
            }}
            aria-label="Close insights"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs defaultValue="actions" className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          <TabsList className="grid w-full min-w-0 grid-cols-3">
            <TabsTrigger value="actions">Overview</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
            <TabsTrigger value="manual-actions">Actions</TabsTrigger>
          </TabsList>
          <TabsContent value="actions" className="min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card/90 p-4">
                <TicketMetadataPanel threadId={threadId} />
              </div>

              {returnTrackingCandidate || returnTrackingActionState?.error ? (
                <div>
                  {returnTrackingOrder ? (
                    <div className="space-y-3">
                      <TrackingCard
                        order={returnTrackingOrder}
                        threadId={threadId}
                        fullWidth
                        title="Return tracking"
                        descriptionPrefix="Live return tracking for order"
                        direction="return"
                      />
                      {!returnTrackingState ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 bg-slate-900 px-2.5 text-xs text-white shadow-none hover:bg-slate-800"
                            disabled={returnTrackingActionState?.submitting === returnTrackingNumber}
                            onClick={() => returnTrackingActionState?.onAdd?.(returnTrackingCandidate)}
                          >
                            {returnTrackingActionState?.submitting === returnTrackingNumber ? "Adding..." : "Add"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            onClick={() => returnTrackingActionState?.onDismiss?.(returnTrackingCandidate)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {returnTrackingActionState?.error ? (
                    <div className={returnTrackingCandidate ? "mt-3 text-xs text-red-600" : "text-xs text-red-600"}>
                      {returnTrackingActionState.error}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {trackingOrder ? (
                <div className="w-full">
                  <TrackingCard order={trackingOrder} threadId={threadId} fullWidth direction="outbound" />
                </div>
              ) : trackingInfo ? (
                <div className="rounded-2xl border border-border bg-card/90 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Truck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400/80">
                      Tracking
                    </span>
                    {trackingInfo.trackingStatus && (
                      <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                        {normalizeTrackingStatusLabel(trackingInfo.trackingStatus)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {trackingInfo.trackingCarrier && (
                      <div className="text-[13px] font-semibold text-slate-800">
                        {trackingInfo.trackingCarrier}
                      </div>
                    )}
                    {trackingInfo.trackingNumber && (
                      <div className="text-[12px] text-slate-500">
                        {trackingInfo.trackingUrl ? (
                          <a
                            href={trackingInfo.trackingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline text-slate-600"
                          >
                            #{trackingInfo.trackingNumber}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          `#${trackingInfo.trackingNumber}`
                        )}
                      </div>
                    )}
                    {trackingInfo.trackingEvents?.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {trackingInfo.trackingEvents.slice(0, 2).map((event, i) => (
                          <div key={i} className="text-[11px] text-slate-400">
                            {event}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {knowledgeGaps.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600/80">
                      Needs knowledge
                    </span>
                  </div>
                  <div className="space-y-1">
                    {knowledgeGaps.map((gap, i) => (
                      <div key={i} className="text-xs text-amber-800 leading-snug">
                        {gap.suggested_title || gap.gap_type}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setSonaLogOpen(true)}
                className="group h-auto w-full justify-start gap-3 whitespace-normal rounded-2xl border-slate-200 bg-white p-4 text-left shadow-sm transition-[border-color,box-shadow,transform,background-color] duration-150 ease-out hover:border-slate-300 hover:bg-slate-50 hover:shadow-md active:scale-[0.99]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white">
                  <SonaLogo size={28} className="h-7 w-7" speed={logsLoading ? "working" : "idle"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    How Sona built this draft
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {logsLoading
                      ? "Loading Sona’s activity…"
                      : diagnostic
                        ? [
                            SONA_INTENT_LABELS[diagnostic.intent] || null,
                            getSonaConfidenceLabel(diagnostic.confidence),
                            `${(diagnostic.kb_chunks?.length || 0) + (diagnostic.ticket_examples?.length || 0)} references`,
                          ].filter(Boolean).join(" · ")
                        : "No activity recorded yet"}
                  </span>
                </span>
                {diagnostic?.decision?.routingHint === "review" ? (
                  <span className={`${badgeVariants({ variant: "outline" })} hidden shrink-0 border-amber-200 bg-amber-50 text-amber-700 sm:inline-flex`}>
                    Review
                  </span>
                ) : null}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 transition-colors group-hover:bg-slate-100 group-hover:text-slate-500">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </Button>

              <Dialog open={sonaLogOpen} onOpenChange={setSonaLogOpen}>
                <DialogContent className="flex max-h-[90vh] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-border/80 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-w-[720px]">
                  <DialogHeader className="shrink-0 border-b border-border/70 bg-background/95 px-6 pb-5 pt-6 text-left backdrop-blur-sm">
                    <div className="flex items-start gap-3 pr-8">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 shadow-sm">
                        <SonaLogo size={26} className="size-7" speed={logsLoading ? "working" : "idle"} />
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <DialogTitle className="text-xl tracking-[-0.02em]">How Sona built this draft</DialogTitle>
                        <DialogDescription className="leading-relaxed">
                          The context, evidence, and decisions that shaped the reply.
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                  <div className="flex-1 overflow-y-auto bg-muted/[0.12] px-6 py-6">
                    {logsLoading ? (
                      <div className="flex flex-col gap-4" aria-label="Loading Sona activity">
                        <Skeleton className="h-32 w-full rounded-xl" />
                        <div className="flex gap-3">
                          <Skeleton className="size-9 shrink-0 rounded-full" />
                          <div className="flex flex-1 flex-col gap-2">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-16 w-full rounded-lg" />
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <Skeleton className="size-9 shrink-0 rounded-full" />
                          <div className="flex flex-1 flex-col gap-2">
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-24 w-full rounded-lg" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <SonaActivityContent
                        diagnostic={diagnostic}
                        shopId={customerLookup?.shop_id ?? null}
                      />
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </TabsContent>
          <TabsContent value="customer" className="min-w-0 flex-1 overflow-y-auto">
            <CustomerTab
              data={effectiveLookup}
              loading={effectiveLookupLoading}
              error={effectiveLookupError}
              onRefresh={effectiveRefresh}
              lookupParams={customerLookupParams}
              onOpenTicket={onOpenTicket}
            />
          </TabsContent>
          <TabsContent value="manual-actions" className="min-w-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 p-1">
              {!hasShopifyShop ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Actions is only available for Shopify shops.
                </p>
              ) : (
                <>
                  {matchedOrder ? (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <span className="font-medium text-foreground">Order {matchedOrder.id}</span>
                      <span className="ml-2 text-muted-foreground">{matchedOrder.status}</span>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No order found on this ticket — find the customer/order under the Customer tab.
                    </p>
                  )}
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {MANUAL_CORE_ACTIONS.map((action) => (
                      <button
                        key={action.type}
                        type="button"
                        disabled={!matchedOrder}
                        onClick={() => setActiveManualAction(action.type)}
                        className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-4 text-left last:border-b-0 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted/60"
                      >
                        <div className="grid gap-1">
                          <p className="text-sm font-medium text-foreground">{action.label}</p>
                          <p className="text-sm text-muted-foreground">{action.description}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <ManualActionDialog
              actionType={activeManualAction}
              order={matchedOrder}
              threadId={threadId}
              onClose={() => setActiveManualAction(null)}
              onSubmitted={(action) => {
                setActiveManualAction(null);
                if (!action || !threadId) return;
                onSeedPendingOrderUpdate?.((prev) => ({
                  ...prev,
                  [threadId]: {
                    id: action.id,
                    detail: action.detail,
                    actionType: action.actionType,
                    payload: action.payload,
                    createdAt: action.createdAt,
                  },
                }));
                onOrderUpdateDecision?.("accepted");
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
      ) : null}
    </aside>
  );
}
