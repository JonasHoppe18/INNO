import { useCallback, useEffect, useMemo, useState } from "react";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SonaActivityContent } from "@/components/inbox/SonaActivityContent";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { ChevronRight, ExternalLink, Truck, X } from "lucide-react";
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { SonaLogo } from "@/components/ui/SonaLogo";

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const DISPLAY_TIMEZONE = "Europe/Copenhagen";

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
  if (lower.includes("afsendt - følg pakken via tracking-link")) {
    return "Shipped - follow the parcel via tracking link";
  }
  if (lower === "afsendt") return "Shipped";
  return text;
};

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
}) {
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [containerEl, setContainerEl] = useState(null);
  const containerRef = useCallback((node) => {
    setContainerEl((current) => (current === node ? current : node));
  }, []);
  const [sonaLogOpen, setSonaLogOpen] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);

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

  useEffect(() => {
    setDiagnostic(null);
  }, [threadId]);

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
    if (!containerEl || typeof document === "undefined") return;
    const activeEl = document.activeElement;
    if (activeEl && containerEl.contains(activeEl) && typeof activeEl.blur === "function") {
      activeEl.blur();
    }
  }, [containerEl, open]);

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
          <TabsList className="grid w-full min-w-0 grid-cols-2">
            <TabsTrigger value="actions">Overview</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
          </TabsList>
          <TabsContent value="actions" className="min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card/90 p-4">
                <TicketMetadataPanel threadId={threadId} />
              </div>

              {trackingOrder ? (
                <div className="w-full">
                  <TrackingCard order={trackingOrder} threadId={threadId} fullWidth />
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

              <button
                type="button"
                onClick={() => setSonaLogOpen(true)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-[border-color,box-shadow,transform,background-color] duration-150 ease-out hover:border-slate-300 hover:bg-slate-50 hover:shadow-md active:scale-[0.99]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white">
                  <SonaLogo size={28} className="h-7 w-7" speed={logsLoading ? "working" : "idle"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    Sona activity
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {logsLoading
                      ? "Loading…"
                      : diagnostic
                        ? [
                            diagnostic.kb_chunks?.length
                              ? `${diagnostic.kb_chunks.length} source${diagnostic.kb_chunks.length !== 1 ? "s" : ""}`
                              : null,
                            diagnostic.ticket_examples?.length
                              ? `${diagnostic.ticket_examples.length} example${diagnostic.ticket_examples.length !== 1 ? "s" : ""}`
                              : null,
                            diagnostic.knowledge_gaps?.length
                              ? `${diagnostic.knowledge_gaps.length} gap${diagnostic.knowledge_gaps.length !== 1 ? "s" : ""}`
                              : null,
                          ].filter(Boolean).join(" · ") || "View details"
                        : "No activity recorded yet"}
                  </span>
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 transition-colors group-hover:bg-slate-100 group-hover:text-slate-500">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>

              <Dialog open={sonaLogOpen} onOpenChange={setSonaLogOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
                  <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
                    <DialogTitle>Sona activity</DialogTitle>
                  </DialogHeader>
                  <div className="overflow-y-auto flex-1 px-6 py-5">
                    {logsLoading ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
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
        </Tabs>
      </div>
      ) : null}
    </aside>
  );
}
