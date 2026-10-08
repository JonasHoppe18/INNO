import { formatDateTime } from "@/lib/format/datetime";
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
import { AlertTriangle, Ban, Banknote, ChevronLeft, ChevronRight, ExternalLink, MapPin, RotateCcw, Truck, X } from "lucide-react";
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";
import { CarrierLogo, TrackingCard } from "@/components/inbox/TrackingCard";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { ManualActionDialog } from "@/components/inbox/ManualActionDialog";
import { CORE_ACTIONS } from "@/lib/action-modes";
import { getCustomerDisplayName } from "@/lib/inbox/customer-display";
import { MANUAL_ACTION_TYPES, resolveMatchedOrder } from "@/lib/inbox/manual-actions";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import {
  CustomerAvatar,
  PanelLinkButton,
  PanelSection,
  PropertyRow,
  ticketStatusLabel,
} from "@/components/inbox/panel-primitives";
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
const SIDEBAR_ROW_CLASS =
  "group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500/30";
const SIDEBAR_BACK_CLASS =
  "inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/45 hover:text-foreground active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30";

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
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
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
  ticketThread = null,
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
  const lookupOrders = Array.isArray(effectiveLookup?.orders) ? effectiveLookup.orders : [];
  const lookupCustomer = effectiveLookup?.customer || null;
  // Only a customer derived from the sender's own Shopify orders counts as
  // "in Shopify"; otherwise the ticket's sender is the customer.
  const customerInShopify =
    lookupCustomer?.source === "shopify_orders" ||
    lookupCustomer?.source === "shopify_profile" ||
    (!lookupCustomer?.source &&
      Boolean(lookupCustomer?.name) &&
      lookupOrders.some((order) => order?.ownedBySender !== false));
  const customerEmail = lookupCustomer?.email || ticketThread?.customer_email || "";
  const customerDisplayName = getCustomerDisplayName({
    customer: customerInShopify ? lookupCustomer : { name: ticketThread?.customer_name },
    fallbackEmail: customerEmail,
  });
  const customerFacts = [
    customerInShopify && Number.isFinite(lookupCustomer?.lifetimeOrders)
      ? `${lookupCustomer.lifetimeOrders} order${lookupCustomer.lifetimeOrders === 1 ? "" : "s"}`
      : null,
    customerInShopify ? lookupCustomer?.country : null,
    customerInShopify ? lookupCustomer?.phone : null,
  ].filter(Boolean);
  const effectiveLookupLoading = customerLookup != null ? customerLookupLoading : internalLookupLoading;
  const effectiveLookupError = customerLookup != null ? customerLookupError : internalLookupError;
  const effectiveRefresh = onCustomerRefresh ?? internalLookupRefresh;
  const trackingOrder = useMemo(() => {
    const orders = Array.isArray(effectiveLookup?.orders) ? effectiveLookup.orders : [];
    return (
      orders.find(
        (order) =>
          order?.ownedBySender !== false && (order?.tracking?.number || order?.tracking?.url),
      ) || null
    );
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
  // The insights route always returns a diagnostic object; it only reflects a
  // real Sona run once an intent was assessed or retrieval/gaps were logged.
  const hasSonaAnalysis = Boolean(
    diagnostic?.intent ||
      (Array.isArray(diagnostic?.kb_chunks) && diagnostic.kb_chunks.length) ||
      knowledgeGaps.length,
  );
  // Declared after trackingInfo (useMemo below the logs effect) to avoid a TDZ.
  const hasTrackingContent = Boolean(
    trackingOrder || trackingInfo || returnTrackingOrder || returnTrackingActionState?.error,
  );
  const previousTickets = Array.isArray(effectiveLookup?.previousTickets)
    ? effectiveLookup.previousTickets
    : [];
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
        open
          ? "w-[clamp(19rem,22vw,26rem)] max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-full max-lg:border-l-0"
          : "w-0 max-lg:pointer-events-none max-lg:absolute max-lg:inset-y-0 max-lg:right-0"
      }`}
      aria-label="Ticket details"
      aria-hidden={!open}
    >
      {open ? (
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background lg:bg-muted/[0.12]">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-2.5 py-1.5 shadow-[0_1px_0_hsl(var(--border)/0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="min-w-0">
            <h2 className="text-section-heading font-semibold tracking-[-0.015em]">Ticket details</h2>
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
          className="h-7 w-7 rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3 lg:p-2.5">
          <TabsContent value="overview" className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="px-1 pb-2">
              <PanelSection>
                <div className="flex items-start gap-3">
                  <CustomerAvatar name={customerDisplayName} email={customerEmail} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground" title={customerDisplayName}>
                        {customerDisplayName}
                      </span>
                      {customerInShopify && lookupCustomer?.adminUrl ? (
                        <a
                          href={lookupCustomer.adminUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open customer in Shopify"
                          title="Open in Shopify"
                          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                    {customerDisplayName.includes("@") ? null : (
                      <div className="truncate text-xs text-muted-foreground" title={customerEmail || undefined}>
                        {customerEmail || "No email available"}
                      </div>
                    )}
                    {effectiveLookupLoading && !lookupCustomer ? (
                      <Skeleton className="mt-1.5 h-3 w-32" />
                    ) : customerFacts.length ? (
                      <div className="mt-1 truncate text-xs text-muted-foreground">{customerFacts.join(" · ")}</div>
                    ) : hasShopifyShop && !customerInShopify ? (
                      <div className="mt-1 text-xs text-muted-foreground/80">No Shopify orders for this email</div>
                    ) : null}
                  </div>
                  <PanelLinkButton onClick={() => setActiveTab("customer")}>Profile</PanelLinkButton>
                </div>
              </PanelSection>

              {lookupOrders.length || hasTrackingContent ? (
                <PanelSection
                  title={
                    lookupOrders.length ? (lookupOrders.length === 1 ? "Order" : "Orders") : "Tracking"
                  }
                  action={
                    hasShopifyShop ? (
                      <PanelLinkButton onClick={() => setActiveTab("manual-actions")}>Actions</PanelLinkButton>
                    ) : null
                  }
                >
                  {lookupOrders.length ? (
                  <div className="space-y-2.5">
                    {lookupOrders.slice(0, 3).map((order, index) => {
                      const orderUrl = buildShopifyOrderUrl(order, shopDomain);
                      const items = (Array.isArray(order?.items) ? order.items : []).filter(Boolean);
                      return (
                        <div key={`${order?.id || "order"}-${index}`} className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            {orderUrl ? (
                              <a
                                href={orderUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open order #${order.id} in Shopify`}
                                className="group/order inline-flex min-w-0 items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-violet-700 dark:hover:text-violet-300"
                              >
                                <span className="truncate">#{order.id}</span>
                                <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground group-hover/order:text-violet-600" />
                              </a>
                            ) : (
                              <span className="truncate text-sm font-medium text-foreground">#{order?.id}</span>
                            )}
                            <OrderStatusPill status={order?.fulfillmentStatus || order?.fulfillment_status || order?.status} />
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                              {formatOrderTotal(order)}
                            </span>
                          </div>
                          {items.length ? (
                            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={items.join(", ")}>
                              {items[0]}
                              {items.length > 1 ? ` +${items.length - 1} more` : ""}
                            </div>
                          ) : null}
                          {order?.ownedBySender !== false && order?.tracking?.number && order !== trackingOrder ? (
                            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <CarrierLogo carrier={order.tracking.company} className="h-4 w-4 shrink-0" />
                              <span className="truncate">
                                {order.tracking.company ? `${order.tracking.company} · ` : ""}
                                {order.tracking.url ? (
                                  <a
                                    href={order.tracking.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:text-foreground hover:underline"
                                  >
                                    {order.tracking.number}
                                  </a>
                                ) : (
                                  order.tracking.number
                                )}
                              </span>
                            </div>
                          ) : null}
                          {order?.ownedBySender === false ? (
                            <div className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-warning-foreground">
                              <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                              <span>
                                Placed with {order?.customerEmail || "a different email"}, not the sender. Verify before acting.
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  ) : null}
                {hasTrackingContent ? (
                  <div className={cn("space-y-2", lookupOrders.length && "mt-3")}>
                  {trackingOrder ? (
                    <div className="pt-0.5">
                      <TrackingCard order={trackingOrder} threadId={threadId} fullWidth compact direction="outbound" />
                    </div>
                  ) : trackingInfo ? (
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                        <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                        {trackingInfo.trackingCarrier || "Tracking"}
                        {trackingInfo.trackingStatus ? (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {normalizeTrackingStatusLabel(trackingInfo.trackingStatus)}
                          </span>
                        ) : null}
                      </div>
                      {trackingInfo.trackingNumber ? (
                        <div className="mt-1 text-xs text-muted-foreground">
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
                            className="h-7 bg-foreground px-2.5 text-sm text-background shadow-none hover:bg-foreground/90"
                            disabled={returnTrackingActionState?.submitting === returnTrackingNumber}
                            onClick={() => returnTrackingActionState?.onAdd?.(returnTrackingCandidate)}
                          >
                            {returnTrackingActionState?.submitting === returnTrackingNumber ? "Adding..." : "Add"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
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
                  </div>
                ) : null}
                </PanelSection>
              ) : null}

              <PanelSection
                title="Sona"
                action={<PanelLinkButton onClick={() => setSonaLogOpen(true)}>Activity</PanelLinkButton>}
              >
                {logsLoading && !diagnostic ? (
                  <Skeleton className="h-10 w-full" />
                ) : hasSonaAnalysis ? (
                  <div>
                    {suggestedContext.intent ? (
                      <PropertyRow label="Intent">
                        {suggestedContext.intent}
                        {suggestedContext.confidence ? (
                          <span className="text-muted-foreground"> · {suggestedContext.confidence}</span>
                        ) : null}
                      </PropertyRow>
                    ) : null}
                    {diagnostic?.language ? (
                      <PropertyRow label="Language">{String(diagnostic.language).toUpperCase()}</PropertyRow>
                    ) : null}
                    {diagnostic?.intent ? (
                      <PropertyRow label="Knowledge">
                        {Array.isArray(diagnostic.kb_chunks) && diagnostic.kb_chunks.length
                          ? `${diagnostic.kb_chunks.length} source${diagnostic.kb_chunks.length === 1 ? "" : "s"} used`
                          : <span className="text-muted-foreground">No sources used</span>}
                      </PropertyRow>
                    ) : null}
                    {knowledgeGaps.length ? (
                      <PropertyRow label="Missing">
                        <span className="text-warning-foreground">
                          {knowledgeGaps.map((gap) => gap.suggested_title || gap.gap_type).filter(Boolean).join(", ")}
                        </span>
                      </PropertyRow>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sona hasn&apos;t analysed this ticket yet.</p>
                )}
              </PanelSection>

              <PanelSection title="Ticket">
                <TicketMetadataPanel threadId={threadId} />
                {ticketThread?.created_at ? (
                  <div className="mt-1.5">
                    <PropertyRow label="Created">{formatDateTime(ticketThread.created_at)}</PropertyRow>
                  </div>
                ) : null}
              </PanelSection>

              {previousTickets.length ? (
                <PanelSection
                  title={`Previous tickets (${previousTickets.length})`}
                  action={
                    previousTickets.length > 3 ? (
                      <PanelLinkButton onClick={() => setActiveTab("customer")}>View all</PanelLinkButton>
                    ) : null
                  }
                >
                  <div className="-mx-2">
                    {previousTickets.slice(0, 3).map((ticket) => (
                      <button
                        key={ticket.thread_id}
                        type="button"
                        onClick={() => onOpenTicket?.(ticket.thread_id)}
                        className={SIDEBAR_ROW_CLASS}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">{ticket.subject}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {ticketStatusLabel(ticket.status)}
                            {ticket.last_message_at ? ` · ${formatMessageTime(ticket.last_message_at)}` : ""}
                          </span>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </PanelSection>
              ) : null}

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
          <TabsContent value="customer" className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`${SIDEBAR_BACK_CLASS} mb-3`}
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
              customerName={customerDisplayName}
              customerEmail={customerEmail}
            />
          </TabsContent>
          <TabsContent value="manual-actions" className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className={`${SIDEBAR_BACK_CLASS} self-start`}
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
                  ) : null}
                  {matchedOrder?.ownedBySender === false ? (
                    <div className="flex items-start gap-2 rounded-xl border border-warning-foreground/30 bg-warning-foreground/[0.06] px-3 py-2.5 text-xs leading-snug text-warning-foreground">
                      <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        Order {matchedOrder.id} was placed with {matchedOrder.customerEmail || "a different email"}, not the sender of this ticket. Confirm the customer owns it before changing it.
                      </span>
                    </div>
                  ) : null}
                  {!matchedOrder ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground/80">No order found</p>
                      <p className="mt-1 text-xs leading-relaxed">Find the customer or order under the Customer tab.</p>
                    </div>
                  ) : null}
                  <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-widest text-slate-400/80">
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
                            <p className="text-sm font-medium text-foreground">{action.label}</p>
                            <p className="text-xs leading-snug text-muted-foreground">{action.description}</p>
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
