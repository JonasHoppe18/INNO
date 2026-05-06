import { useEffect, useMemo, useState } from "react";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionsTimeline } from "@/components/inbox/ActionsTimeline";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { Badge } from "@/components/ui/badge";
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
  draftLoading = false,
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
  const [sonaLogOpen, setSonaLogOpen] = useState(false);

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
      }
      setLogsLoading(false);
    };
    fetchLogs();
    return () => {
      active = false;
    };
  }, [draftId, open, threadId]);

  const timelineItems = useMemo(() => {
    const formatTitle = (value, parsed) => {
      const raw = String(value || "").toLowerCase();
      if (!raw) return "Activity";
      if (raw === "carrier_tracking" || raw === "carrier tracking") return "Carrier Tracking";
      if (raw === "shopify_lookup") return "Shopify Lookup";
      if (raw === "shopify_action") return "Shopify Action";
      if (raw === "shopify_action_applied") return "Shopify Action Applied";
      if (raw === "shopify_action_declined") return "Shopify Action Declined";
      if (raw === "shopify_action_blocked") return "Shopify Action Blocked";
      if (raw === "thread_action_pending") return "Approval Required";
      if (raw === "thread_action_applied") {
        if (parsed?.action === "fetch_tracking") return "Tracking Action";
        if (parsed?.action === "lookup_order_status") return "Order Status Action";
        return "Action Approved";
      }
      if (raw === "thread_action_declined") return "Action Declined";
      if (raw === "thread_action_failed") return "Action Failed";
      if (raw === "context") return "Context";
      if (raw === "draft_intent_assessed") return "Understood the request";
      if (raw === "draft_context_loaded") return "Order context";
      if (raw === "draft_created") return "Generated draft";
      if (raw === "postmark_inbound_draft_created") return "Draft Created";
      if (raw === "draft_edit_feedback_captured") return "Draft edited";
      if (raw === "send_smtp_success") return "Reply sent";
      if (raw === "send_smtp_fail" || raw === "send_reply_failed") return "Reply failed";
      if (raw === "email_simulated_test_mode") return "Email simulated";
      if (raw === "action_feedback_captured") return "Action feedback";
      if (raw === "shopify_action_approved_test_mode") return "Action approved in test mode";
      if (raw === "forward_email_applied") return "Email forwarded";
      if (raw === "forward_email_failed") return "Forward failed";
      if (raw === "product search") return "Product Search";
      return raw
        .replace(/_/g, " ")
        .replace(/\bpostmark\b/gi, "Postmark")
        .replace(/\bai\b/gi, "AI")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };
    const formatDetail = (parsed, name, status) => {
      if (!parsed) return "";
      const step = String(name || "").toLowerCase();
      if (step === "carrier_tracking" || step === "carrier tracking") {
        const statusLabel = normalizeTrackingStatusLabel(parsed?.trackingStatus);
        const chunks = [
          parsed?.trackingCarrier ? `${parsed.trackingCarrier}` : "",
          statusLabel || "",
          parsed?.trackingNumber ? `#${parsed.trackingNumber}` : "",
          parsed?.trackingUrl || "",
        ].filter(Boolean);
        const events = Array.isArray(parsed?.trackingEvents) ? parsed.trackingEvents : [];
        if (chunks.length && events.length) {
          return `${chunks.join(" | ")}\nRecent events: ${events.join(" → ")}`;
        }
        if (chunks.length) return chunks.join(" | ");
        if (events.length) return `Recent events: ${events.join(" → ")}`;
        return parsed?.detail || "Loaded live tracking status.";
      }
      if (step === "draft_intent_assessed") {
        const parts = [];
        if (parsed?.primary_intent) parts.push(parsed.primary_intent.replace(/_/g, " "));
        if (parsed?.language) parts.push(`Language: ${parsed.language.toUpperCase()}`);
        if (typeof parsed?.confidence === "number") parts.push(`${Math.round(parsed.confidence * 100)}% confidence`);
        return parts.join(" · ") || "Intent assessed.";
      }
      if (step === "draft_context_loaded") {
        if (parsed?.order_found && parsed?.order_number) return `Order ${parsed.order_number} found`;
        if (parsed?.order_found) return "Order found";
        return "No order context";
      }
      if (step === "draft_created") {
        const parts = [];
        if (typeof parsed?.confidence === "number") parts.push(`Confidence: ${Math.round(parsed.confidence * 100)}%`);
        if (parsed?.routing_hint) parts.push(`Routing: ${parsed.routing_hint}`);
        return parts.join(" · ") || "Draft generated.";
      }
      if (step === "postmark_inbound_draft_created" || step === "draft_created") {
        return "Forwarded email draft created.";
      }
      if (step === "draft_edit_feedback_captured") {
        const changed = parsed?.changed_materially === true || parsed?.diff_summary?.changed_materially === true;
        const eventType = parsed?.event_type ? String(parsed.event_type).replace(/_/g, " ") : "draft update";
        return changed ? `AI draft edited materially (${eventType}).` : `AI draft saved with minor or no edits (${eventType}).`;
      }
      if (step === "send_smtp_success") {
        const parts = ["Reply sent via Postmark"];
        if (parsed?.from_mode) parts.push(`sender: ${String(parsed.from_mode).replace(/_/g, " ")}`);
        if (parsed?.redirected_to) parts.push(`test: ${parsed.redirected_to}`);
        return parts.join(" · ");
      }
      if (step === "send_smtp_fail" || step === "send_reply_failed") {
        return parsed?.detail || parsed?.error || "Reply could not be sent.";
      }
      if (step === "email_simulated_test_mode") {
        return parsed?.intended_to ? `Test mode email simulated for ${parsed.intended_to}` : "Email simulated in test mode.";
      }
      if (step === "action_feedback_captured") {
        const action = parsed?.action_type ? String(parsed.action_type).replace(/_/g, " ") : "action";
        const decision = parsed?.decision ? String(parsed.decision) : "recorded";
        return `${action}: ${decision}`;
      }
      if (step === "product search") {
        return parsed.detail || "Searched product context.";
      }
      if (step === "context") {
        return parsed.detail || "Loaded store context.";
      }
      if (step === "shopify_lookup") {
        return parsed.detail || (parsed.orderId ? `Found order ${parsed.orderId}` : "Order found.");
      }
      if (
        step === "shopify_action" ||
        step === "shopify_action_applied" ||
        step === "shopify_action_declined" ||
        step === "shopify_action_blocked"
      ) {
        let detail = parsed.detail || (parsed.orderId ? `Order ${parsed.orderId}` : "");
        if (step === "shopify_action" && String(status || "").toLowerCase() === "warning") {
          detail = detail
            .replace(/^updated shipping address to\s*/i, "Requested shipping address change to ")
            .replace(/^updated shipping address\b/i, "Requested shipping address change")
            .replace(/^cancelled order\b/i, "Requested order cancellation")
            .replace(/^refunded order\b/i, "Requested refund");
        }
        if (!detail && step === "shopify_action_blocked") {
          return "Requested change was blocked and not applied.";
        }
        return detail || "Shopify action event.";
      }
      if (step.startsWith("thread_action_")) {
        if (parsed?.action === "fetch_tracking") {
          return "Tracking lookup executed.";
        }
        if (parsed?.action === "lookup_order_status") {
          return "Order status lookup executed.";
        }
        return parsed.detail || "Order action event.";
      }
      if (parsed.orderId && !parsed.detail) return `Order ${parsed.orderId}`;
      return parsed.detail || "";
    };
    const DEBUG_STEP_NAMES = new Set([
      "workflow_routing",
      "thread_context_gate",
      "workflow_routing_override",
      "legacy_case_state",
      "workflow_action_policy",
      "workflow_action_policy_final",
      "workflow_action_order_context",
      "return_process_followup_action_filter",
      "v2_action_decision",
      "v2_reply_generation",
      "carrier_preferences",
      "customer_lookup",
      "customer_lookup_failed",
    ]);

    const parsedLogs = logs
      .filter((log) => !DEBUG_STEP_NAMES.has(String(log?.step_name || "").toLowerCase()))
      .map((log) => ({
        log,
        parsed: parseLogDetail(log.step_detail),
      }));

    const trackingFocused = parsedLogs.some(({ log, parsed }) => {
      const step = String(log?.step_name || "").toLowerCase();
      return (
        step === "carrier_tracking" ||
        parsed?.action === "fetch_tracking" ||
        step === "order_status_action"
      );
    });

    const visibleLogs = trackingFocused
      ? parsedLogs.filter(({ log }) => {
          const step = String(log?.step_name || "").toLowerCase();
          if (step === "context") return false;
          if (step.startsWith("shopify_action")) return false;
          if (step === "carrier_preferences") return false;
          return true;
        })
      : parsedLogs;

    return visibleLogs.map(({ log, parsed }) => {
      return {
        id: String(log.id),
        title: formatTitle(log.step_name, parsed),
        statusLabel: formatDetail(parsed, log.step_name, log.status),
        timestamp: new Date(log.created_at).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: DISPLAY_TIMEZONE,
        }),
        status: log.status,
      };
    });
  }, [logs]);

  const trackingInfo = useMemo(() => {
    const trackingLog = logs.find(
      (log) => String(log?.step_name || "").toLowerCase() === "carrier_tracking"
    );
    if (!trackingLog) return null;
    const parsed = parseLogDetail(trackingLog.step_detail);
    if (!parsed?.trackingCarrier && !parsed?.trackingNumber && !parsed?.trackingStatus) return null;
    return parsed;
  }, [logs]);

  const draftSources = useMemo(() => {
    const createdLog = logs.find(
      (log) => String(log?.step_name || "").toLowerCase() === "draft_created"
    );
    if (!createdLog) return [];
    const parsed = parseLogDetail(createdLog.step_detail);
    return Array.isArray(parsed?.sources) ? parsed.sources : [];
  }, [logs]);
  const latestTimelineItem = timelineItems.length
    ? timelineItems[timelineItems.length - 1]
    : null;

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
      ref={setContainerEl}
      className={`flex h-full min-w-0 flex-none flex-col overflow-hidden border-l border-border bg-background transition-[width] duration-200 ease-linear ${
        open ? "w-[clamp(20rem,24vw,28rem)]" : "w-0"
      }`}
      aria-hidden={!open}
    >
      <div
        className={`flex h-full min-w-0 flex-col gap-4 overflow-hidden ${open ? "p-3 lg:p-4" : "p-0"}`}
      >
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
                      ? "Loading decisions and sources..."
                      : timelineItems.length
                        ? `${timelineItems.length} step${timelineItems.length === 1 ? "" : "s"} recorded${
                          latestTimelineItem?.title ? ` · Latest: ${latestTimelineItem.title}` : ""
                        }`
                        : "No decisions or sources recorded yet"}
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
                    {logsLoading || (draftLoading && !timelineItems.length) ? (
                      <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
                    ) : timelineItems.length ? (
                      <>
                        <ActionsTimeline items={timelineItems} />
                        {draftSources.length > 0 && (
                          <details className="group mt-4">
                            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                              Sources used
                            </summary>
                            <div className="mt-2 space-y-1.5">
                              {draftSources.map((source, i) => (
                                <div key={i} className="rounded-md border bg-card p-2">
                                  <div className="mb-1 flex items-center gap-1.5">
                                    <Badge variant="outline" className="text-[10px] py-0">{source.kind || "source"}</Badge>
                                    <p className="truncate text-xs font-medium">{source.source_label || `Source ${i + 1}`}</p>
                                  </div>
                                  <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                                    {source.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground py-4 text-center">
                        No actions recorded for this conversation.
                      </div>
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
    </aside>
  );
}
