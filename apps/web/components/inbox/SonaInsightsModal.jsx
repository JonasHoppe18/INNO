import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ActionsTimeline } from "@/components/inbox/ActionsTimeline";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { X } from "lucide-react";
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";

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
      if (raw === "draft_created") return "Draft Created";
      if (raw === "postmark_inbound_draft_created") return "Draft Created";
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
      if (step === "postmark_inbound_draft_created" || step === "draft_created") {
        return "Forwarded email draft created.";
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
    const parsedLogs = logs.map((log) => ({
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

              <details className="group">
                <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-600 select-none list-none">
                  <svg
                    className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  What did Sona do?
                </summary>
                <div className="mt-3 rounded-2xl border border-border bg-card/90 p-4">
                  {logsLoading || (draftLoading && !timelineItems.length) ? (
                    <div className="text-sm text-muted-foreground">Loading…</div>
                  ) : timelineItems.length ? (
                    <ActionsTimeline items={timelineItems} />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No actions recorded for this conversation.
                    </div>
                  )}
                </div>
              </details>
            </div>
          </TabsContent>
          <TabsContent value="customer" className="min-w-0 flex-1 overflow-y-auto">
            <CustomerTab
              data={customerLookup}
              loading={customerLookupLoading}
              error={customerLookupError}
              onRefresh={onCustomerRefresh}
              lookupParams={customerLookupParams}
              onOpenTicket={onOpenTicket}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
