import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ActionsTimeline } from "@/components/inbox/ActionsTimeline";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { X } from "lucide-react";

const asString = (value) => (typeof value === "string" ? value.trim() : "");

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
}) {
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

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
        if (chunks.length) return chunks.join(" | ");
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
        }),
        status: log.status,
      };
    });
  }, [logs]);

  return (
    <aside
      className={`flex h-full flex-none flex-col border-l border-gray-200 bg-background transition-[width] duration-200 ease-linear ${
        open ? "w-[360px]" : "w-0"
      }`}
      aria-hidden={!open}
    >
      <div className={`flex h-full flex-col gap-4 overflow-hidden ${open ? "p-4" : "p-0"}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sona Insights</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close insights"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs defaultValue="actions" className="flex flex-1 flex-col gap-4 overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="actions">Sona Actions</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
          </TabsList>
          <TabsContent value="actions" className="flex-1 overflow-y-auto">
            <div className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/50 to-white p-4">
              {logsLoading || (draftLoading && !timelineItems.length) ? (
                <div className="text-sm text-slate-500">Loading investigation data…</div>
              ) : timelineItems.length ? (
                <ActionsTimeline items={timelineItems} />
              ) : (
                <div className="text-sm text-slate-500">
                  No actions required for this conversation.
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent value="customer" className="flex-1 overflow-y-auto">
            <CustomerTab
              data={customerLookup}
              loading={customerLookupLoading}
              error={customerLookupError}
              onRefresh={onCustomerRefresh}
              lookupParams={customerLookupParams}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
