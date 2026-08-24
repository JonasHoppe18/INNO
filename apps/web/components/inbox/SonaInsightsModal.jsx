import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
import { Activity, Ban, Banknote, ChevronLeft, ChevronRight, ExternalLink, MapPin, RotateCcw, Truck, X } from "lucide-react";
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { ManualActionDialog } from "@/components/inbox/ManualActionDialog";
import { CORE_ACTIONS } from "@/lib/action-modes";
import { MANUAL_ACTION_TYPES, resolveMatchedOrder } from "@/lib/inbox/manual-actions";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const DISPLAY_TIMEZONE = "Europe/Copenhagen";
const MANUAL_CORE_ACTIONS = CORE_ACTIONS.filter((action) => MANUAL_ACTION_TYPES.includes(action.type));
const MANUAL_ACTION_ICONS = {
  update_shipping_address: MapPin,
  cancel_order: Ban,
  refund_order: Banknote,
  initiate_return: RotateCcw,
};
// Semantic tints per action so agents can scan by colour (blue = address,
// rose = destructive cancel, emerald = money/refund, amber = return).
const MANUAL_ACTION_ICON_TONES = {
  update_shipping_address: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
  cancel_order: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
  refund_order: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
  initiate_return: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
};

function OrderStatusPill({ status }) {
  const raw = String(status || "").trim().toLowerCase();
  const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Unknown";
  const isFulfilled = raw === "fulfilled";
  const isPending =
    raw === "unfulfilled" || raw === "partial" || raw === "partially_fulfilled";
  const tone = isFulfilled
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    : isPending
    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
    : "bg-muted text-muted-foreground";
  const dot = isFulfilled
    ? "bg-emerald-500"
    : isPending
    ? "bg-amber-500"
    : "bg-muted-foreground/50";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

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

const formatOrderTotal = (order) => {
  const raw = order?.total ?? order?.total_price ?? order?.totalPrice;
  if (raw == null || raw === "") return "";
  const currency = String(order?.currency || order?.currencyCode || "DKK").toUpperCase();
  const rawString = String(raw).replace(/[^\d,.-]/g, "");
  const normalized = rawString.includes(",") && rawString.includes(".")
    ? rawString.lastIndexOf(",") > rawString.lastIndexOf(".")
      ? rawString.replace(/\./g, "").replace(",", ".")
      : rawString.replace(/,/g, "")
    : rawString.replace(",", ".");
  const numeric = typeof raw === "number" ? raw : Number(normalized);
  if (!Number.isFinite(numeric)) return String(raw);
  try {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency }).format(numeric);
  } catch {
    return `${numeric.toLocaleString("da-DK")} ${currency}`;
  }
};

const buildShopifyOrderUrl = (order, shopDomain) => {
  const directUrl = asString(order?.adminUrl);
  if (directUrl) return directUrl;

  const normalizedDomain = asString(shopDomain)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const adminId = order?.adminId;
  if (!normalizedDomain || adminId === null || adminId === undefined || adminId === "") {
    return "";
  }

  const normalizedAdminId = String(adminId).replace(/^gid:\/\/shopify\/Order\//i, "");
  return `https://${normalizedDomain}/admin/orders/${encodeURIComponent(normalizedAdminId)}`;
};

function SidebarSectionLabel({ children }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
      {children}
    </div>
  );
}

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
  const [pendingManualActionId, setPendingManualActionId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

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
  const shopDomain = asString(
    effectiveLookup?.shopDomain ||
      effectiveLookup?.shop?.domain ||
      effectiveLookup?.shop?.shop_domain,
  );
  const matchedOrderUrl = useMemo(
    () => buildShopifyOrderUrl(matchedOrder, shopDomain),
    [matchedOrder, shopDomain],
  );
  const matchedOrderItems = useMemo(
    () =>
      (Array.isArray(matchedOrder?.items) ? matchedOrder.items : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    [matchedOrder?.items],
  );
  const isMatchedOrderFulfilled = useMemo(() => {
    const status = String(
      matchedOrder?.fulfillmentStatus ||
        matchedOrder?.fulfillment_status ||
        matchedOrder?.status ||
        "",
    ).trim().toLowerCase();
    return ["fulfilled", "shipped", "delivered"].includes(status);
  }, [matchedOrder]);
  const availableManualActions = useMemo(
    () =>
      MANUAL_CORE_ACTIONS.filter(
        (action) =>
          !(
            isMatchedOrderFulfilled &&
            ["update_shipping_address", "cancel_order"].includes(action.type)
          ),
      ),
    [isMatchedOrderFulfilled],
  );
  const hasShopifyShop = Boolean(shopDomain);
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
    if (!pendingManualActionId) return;
    onOrderUpdateDecision?.("accepted");
    setPendingManualActionId(null);
  }, [pendingManualActionId, onOrderUpdateDecision]);

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
  const suggestedContext = useMemo(() => {
    const intent = diagnostic?.intent
      ? SONA_INTENT_LABELS[diagnostic.intent] || "General inquiry"
      : trackingInfo || trackingOrder
        ? "Tracking"
        : null;
    const confidence = diagnostic?.confidence != null
      ? getSonaConfidenceLabel(diagnostic.confidence)
      : null;
    return { intent, confidence };
  }, [diagnostic, trackingInfo, trackingOrder]);
  useEffect(() => {
    if (open) return;
    const containerEl = containerElRef.current;
    if (!containerEl || typeof document === "undefined") return;
    const activeEl = document.activeElement;
    if (activeEl && containerEl.contains(activeEl) && typeof activeEl.blur === "function") {
      activeEl.blur();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveTab("overview");
  }, [open, threadId]);

  return (
    <aside
      ref={containerRef}
      className={`flex h-full min-w-0 flex-none flex-col overflow-hidden border-l border-border bg-background transition-[width] duration-200 ease-linear ${
        open ? "w-[clamp(19rem,22vw,26rem)]" : "w-0"
      }`}
      aria-label="Ticket details"
      aria-hidden={!open}
    >
      {open ? (
      <div className="flex h-full min-w-0 flex-col gap-2 overflow-hidden bg-muted/[0.12] p-2.5">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-0.5 pb-2">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-[-0.015em]">Ticket details</h2>
          </div>
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
            aria-label="Close ticket details"
            className="h-7 w-7 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
          <TabsContent value="overview" className="min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-2.5 px-0.5 pb-2.5">
              <section className="space-y-1.5 border-b border-border/70 pb-2">
                <SidebarSectionLabel>Customer</SidebarSectionLabel>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {effectiveLookup?.customer?.name || effectiveLookup?.customer?.email || "Unknown customer"}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {effectiveLookup?.customer?.email || "No email available"}
                  </div>
                </div>
              </section>

              {matchedOrder ? (
                <section className="space-y-1.5 border-b border-border/70 pb-2">
                  <SidebarSectionLabel>Order</SidebarSectionLabel>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {matchedOrderUrl ? (
                        <a
                          href={matchedOrderUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open order #${matchedOrder.id} in Shopify`}
                          className="group/order inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-foreground transition-colors hover:text-violet-700 dark:hover:text-violet-300"
                        >
                          <span className="truncate">#{matchedOrder.id}</span>
                          <ExternalLink
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover/order:text-violet-600 dark:group-hover/order:text-violet-300"
                          />
                        </a>
                      ) : (
                        <div className="truncate text-[13px] font-medium text-foreground">
                          #{matchedOrder.id}
                        </div>
                      )}
                      <OrderStatusPill
                        status={
                          matchedOrder.fulfillmentStatus ||
                          matchedOrder.fulfillment_status ||
                          matchedOrder.status
                        }
                      />
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatOrderTotal(matchedOrder) || "Amount unavailable"}
                    </div>
                    {matchedOrderItems.length ? (
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                          Order items
                        </div>
                        <div className="space-y-1">
                          {matchedOrderItems.slice(0, 2).map((item, index) => (
                            <div
                              key={`${matchedOrder.id}-item-${index}`}
                              title={item}
                              className="flex min-w-0 items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"
                            >
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                              <span className="line-clamp-2 min-w-0">{item}</span>
                            </div>
                          ))}
                          {matchedOrderItems.length > 2 ? (
                            <div className="pl-2.5 text-[10px] text-muted-foreground/70">
                              +{matchedOrderItems.length - 2} more
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="space-y-1.5 border-b border-border/70 pb-2">
                <TicketMetadataPanel threadId={threadId} />
              </section>

              {suggestedContext.intent || returnTrackingCandidate || returnTrackingActionState?.error ? (
                <section className="space-y-1.5 border-b border-border/70 pb-2">
                  <SidebarSectionLabel>Suggested context</SidebarSectionLabel>
                  <button
                    type="button"
                    onClick={() => setSonaLogOpen(true)}
                    className="group flex w-full items-center justify-between gap-3 rounded-lg py-1.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99]"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                      <span className="truncate">
                        {suggestedContext.intent || "Tracking"}
                        {suggestedContext.confidence ? ` · ${suggestedContext.confidence}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
                      Details
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </button>

                  {trackingOrder ? (
                    <div className="pt-0.5">
                      <TrackingCard order={trackingOrder} threadId={threadId} fullWidth compact direction="outbound" />
                    </div>
                  ) : trackingInfo ? (
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                        <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                        {trackingInfo.trackingCarrier || "Tracking"}
                        {trackingInfo.trackingStatus ? (
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {normalizeTrackingStatusLabel(trackingInfo.trackingStatus)}
                          </span>
                        ) : null}
                      </div>
                      {trackingInfo.trackingNumber ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {trackingInfo.trackingUrl ? (
                            <a href={trackingInfo.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                              #{trackingInfo.trackingNumber}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : `#${trackingInfo.trackingNumber}`}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {returnTrackingOrder ? (
                    <div className="space-y-2">
                      <TrackingCard
                        order={returnTrackingOrder}
                        threadId={threadId}
                        fullWidth
                        compact
                        title="Return tracking"
                        descriptionPrefix="Live return tracking for order"
                        direction="return"
                      />
                      {!returnTrackingState ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 bg-foreground px-2.5 text-xs text-background shadow-none hover:bg-foreground/90"
                            disabled={returnTrackingActionState?.submitting === returnTrackingNumber}
                            onClick={() => returnTrackingActionState?.onAdd?.(returnTrackingCandidate)}
                          >
                            {returnTrackingActionState?.submitting === returnTrackingNumber ? "Adding..." : "Add"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => returnTrackingActionState?.onDismiss?.(returnTrackingCandidate)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {returnTrackingActionState?.error ? (
                    <div className="text-xs text-destructive">{returnTrackingActionState.error}</div>
                  ) : null}
                </section>
              ) : null}

              {knowledgeGaps.length > 0 ? (
                <section className="space-y-1.5 border-b border-border/70 pb-2">
                  <SidebarSectionLabel>Needs knowledge</SidebarSectionLabel>
                  <div className="space-y-1 text-[11px] leading-snug text-muted-foreground">
                    {knowledgeGaps.map((gap, i) => (
                      <div key={i}>{gap.suggested_title || gap.gap_type}</div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-1.5 border-b border-border/70 pb-2">
                <SidebarSectionLabel>More actions</SidebarSectionLabel>
                <button
                  type="button"
                  onClick={() => setActiveTab("manual-actions")}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg py-1.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99]"
                >
                  <span className="text-[13px] font-medium text-foreground">View available actions</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setSonaLogOpen(true)}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg py-1.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99]"
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    View Sona activity
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              </section>

              <Dialog open={sonaLogOpen} onOpenChange={setSonaLogOpen}>
                <DialogContent className="flex max-h-[90vh] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-border/80 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-w-[720px]">
                  <DialogHeader className="shrink-0 border-b border-border/70 bg-background/95 px-6 pb-5 pt-6 text-left backdrop-blur-sm">
                    <div className="flex items-start gap-3 pr-8">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 shadow-sm">
                        <SonaLogo size={26} className="size-7" speed={logsLoading ? "working" : "idle"} />
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <DialogTitle className="text-xl tracking-[-0.02em]">Sona activity</DialogTitle>
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
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className="mb-3 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back to ticket details
            </button>
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
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to ticket details
              </button>
              {!hasShopifyShop ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground/80">Shopify actions unavailable</p>
                  <p className="mt-1 text-xs leading-relaxed">Connect a Shopify shop to manage orders from this ticket.</p>
                </div>
              ) : (
                <>
                  {matchedOrder ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background shadow-sm">
                        <Image
                          src={shopifyLogo}
                          alt="Shopify"
                          width={40}
                          height={28}
                          className="h-7 w-auto max-w-none"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Order {matchedOrder.id}</span>
                      <OrderStatusPill
                        status={
                          matchedOrder.fulfillmentStatus ||
                          matchedOrder.fulfillment_status ||
                          matchedOrder.status
                        }
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground/80">No order found</p>
                      <p className="mt-1 text-xs leading-relaxed">Find the customer or order under the Customer tab.</p>
                    </div>
                  )}
                  <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400/80">
                    Order actions
                  </p>
                  {availableManualActions.length ? (
                    <div className="overflow-hidden rounded-xl border border-border/80 bg-background">
                    {availableManualActions.map((action) => {
                      const ActionIcon = MANUAL_ACTION_ICONS[action.type];
                      return (
                        <button
                          key={action.type}
                          type="button"
                          disabled={!matchedOrder}
                          onClick={() => setActiveManualAction(action.type)}
                          className="group/action flex w-full items-center gap-3 border-b border-border/70 px-3 py-2.5 text-left transition-[background-color,transform] duration-150 last:border-b-0 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted/55 active:scale-[0.995]"
                        >
                          <div
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              MANUAL_ACTION_ICON_TONES[action.type] || "bg-muted text-muted-foreground",
                            )}
                          >
                            {ActionIcon ? <ActionIcon className="h-4 w-4" /> : null}
                          </div>
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <p className="text-[13px] font-medium text-foreground">{action.label}</p>
                            <p className="text-[11px] leading-snug text-muted-foreground">{action.description}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover/action:translate-x-0.5 group-hover/action:text-foreground" />
                        </button>
                      );
                    })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No order actions are available after fulfillment.
                    </p>
                  )}
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
                setPendingManualActionId(action.id);
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
      ) : null}
    </aside>
  );
}
