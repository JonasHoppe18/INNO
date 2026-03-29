import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";

function formatAddressLines(detail = "") {
  const stripped = String(detail || "")
    .replace(/^sona wants to update shipping address to:\s*/i, "")
    .trim();
  const parts = stripped
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return [];
  if (parts.length >= 3) return [parts.slice(0, 2).join(", "), parts.slice(2).join(", ")];
  return parts;
}

function normalizeFailedDetail(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "Order is Fulfilled and cannot be changed";
  const lower = raw.toLowerCase();
  const isBlockedOrderState =
    lower.includes("order is closed and cannot be changed") ||
    lower.includes("order action blocked") ||
    lower.includes("ordren er allerede afsluttet") ||
    lower.includes("ordren er allerede afsendt") ||
    lower.includes("already shipped") ||
    lower.includes("already fulfilled");
  if (isBlockedOrderState) {
    return "Order is Fulfilled and cannot be changed";
  }
  return raw;
}

function formatActionTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return "just now";

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAddressObjectLines(address = {}) {
  if (!address || typeof address !== "object") return [];
  const name = [address.first_name, address.last_name].filter(Boolean).join(" ").trim();
  const line1 = [address.address1, address.address2].filter(Boolean).join(", ").trim();
  const line2 = [
    address.zip || address.postal_code || address.postcode,
    address.city,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const line3 = [address.province || address.state, address.country].filter(Boolean).join(", ").trim();
  return [name, line1, line2, line3].filter(Boolean);
}

function getAppliedChangeLines({ actionType = "", detail = "", payload = {} }) {
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  if (normalizedAction === "update_shipping_address") {
    const shippingAddress = payload?.shipping_address ?? payload?.shippingAddress;
    const addressLines = formatAddressObjectLines(shippingAddress);
    if (addressLines.length) return addressLines;
  }

  const detailLines = formatAddressLines(detail);
  if (detailLines.length) return detailLines;

  return [detail || "No change details available."];
}

function getAppliedChangeLabel(actionType = "") {
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  if (normalizedAction === "update_shipping_address") return "New shipping address";
  if (normalizedAction === "cancel_order") return "Applied change";
  if (normalizedAction === "refund_order") return "Applied change";
  return "Applied change";
}

function shouldShowAppliedChange(actionType = "") {
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  return normalizedAction !== "cancel_order";
}

function getActionStatusLabel(actionType = "") {
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  if (normalizedAction === "update_shipping_address") return "Address updated";
  if (normalizedAction === "cancel_order") return "Cancelled";
  if (normalizedAction === "refund_order") return "Refunded";
  if (normalizedAction === "change_shipping_method") return "Shipping updated";
  if (normalizedAction === "update_customer_contact") return "Contact updated";
  if (normalizedAction === "forward_email") return "Forwarded";
  if (normalizedAction === "create_return_case") return "Return created";
  if (normalizedAction === "send_return_instructions") return "Instructions sent";
  if (normalizedAction === "add_note" || normalizedAction === "add_internal_note_or_tag") {
    return "Note added";
  }
  if (normalizedAction === "add_tag") return "Tag added";
  return "Completed";
}

function getResultModalTitle({ actionType = "", actionName = "", status = "completed" }) {
  if (status === "simulated") return actionName || "Action";
  if (status === "failed") return `${actionName || "Action"} failed`;
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  if (normalizedAction === "cancel_order") return "Cancel Order";
  return actionName || "Action";
}

function getStatusPillClasses(status = "completed") {
  if (status === "failed") return "bg-red-50 text-red-600";
  if (status === "simulated") return "bg-amber-50 text-amber-700";
  if (status === "executing") return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

function getResultStatusText({ status = "completed", actionType = "", testMode = false }) {
  if (status === "failed") return "Failed";
  if (status === "executing") return "Executing";
  if (status === "simulated" || testMode) return "Test mode";
  return getActionStatusLabel(actionType);
}

function getRefundAmount(payload = {}, orderSummary = null) {
  const candidates = [
    payload?.amount,
    payload?.refund_amount,
    payload?.refundAmount,
    payload?.value,
  ];
  for (const candidate of candidates) {
    const amount = parseAmount(candidate);
    if (amount !== null) {
      return formatCurrency(amount, payload?.currency || orderSummary?.currency || null);
    }
  }
  return null;
}

function getApproveButtonLabel({ actionType = "", actionName = "", payload = {}, orderSummary = null }) {
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  if (normalizedAction === "cancel_order") return "Approve cancellation";
  if (normalizedAction === "refund_order") {
    const amount = getRefundAmount(payload, orderSummary);
    return amount ? `Approve refund (${amount})` : "Approve refund";
  }
  if (normalizedAction === "create_exchange_request") return "Approve exchange";
  if (normalizedAction === "process_exchange_return") return "Approve return processing";
  if (normalizedAction === "update_shipping_address") return "Approve address update";
  if (normalizedAction === "change_shipping_method") return "Approve shipping change";
  if (normalizedAction === "update_customer_contact") return "Approve contact update";
  if (normalizedAction === "send_return_instructions") return "Approve return instructions";
  if (normalizedAction === "forward_email") return "Approve forward";
  const fallback = String(actionName || "").trim();
  return fallback ? `Approve ${fallback.toLowerCase()}` : "Approve action";
}

function getImpactSummaryLines({ actionType = "", payload = {}, orderDisplayNumber = "", orderSummary = null }) {
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  const lines = [];
  if (normalizedAction === "cancel_order") {
    lines.push("This order will be cancelled in Shopify.");
  } else if (normalizedAction === "refund_order") {
    const amount = getRefundAmount(payload, orderSummary);
    lines.push(amount ? `A refund of ${amount} will be issued.` : "A refund will be issued.");
  } else if (normalizedAction === "create_exchange_request") {
    lines.push("An exchange request will be created for this customer.");
  } else if (normalizedAction === "process_exchange_return") {
    lines.push("The return will be processed in Shopify.");
  } else if (normalizedAction === "send_return_instructions") {
    lines.push("Return instructions will be sent to the customer.");
  } else if (normalizedAction === "update_shipping_address") {
    lines.push("Shipping address on the order will be updated.");
  } else if (normalizedAction === "change_shipping_method") {
    lines.push("Shipping method on the order will be changed.");
  } else if (normalizedAction === "update_customer_contact") {
    lines.push("Customer contact details will be updated.");
  } else {
    lines.push("This action will apply the requested change.");
  }

  if (orderDisplayNumber) {
    lines.push(`Applies to ${orderDisplayNumber}.`);
  }
  return lines;
}

function parseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function formatCurrency(value, currency) {
  const parsed = typeof value === "number" ? value : parseAmount(value);
  if (parsed === null) return null;
  if (!currency) return String(parsed);
  try {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency }).format(parsed);
  } catch {
    return `${parsed} ${currency}`;
  }
}

function formatOrderDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getOrderDisplayNumber(orderSummary = null) {
  const raw =
    orderSummary?.name ||
    orderSummary?.orderNumber ||
    orderSummary?.id ||
    "";
  const value = String(raw || "").trim();
  if (!value) return null;
  return value.startsWith("#") ? value : `#${value}`;
}

export function ActionCard({
  status = "proposed",
  actionName = "Update Address",
  actionType = "",
  detail = "",
  payload = {},
  orderSummary = null,
  fallbackOrderNumber = "",
  customerEmail = "",
  error = "",
  loading = false,
  onApprove,
  onDecline,
  extraContent = null,
  testMode = false,
  approvedAt = "",
  approvedBy = "",
}) {
  const [expanded, setExpanded] = useState(false);
  const [showApprovedDetail, setShowApprovedDetail] = useState(false);
  const isProposed = status === "proposed";
  const isExecuting = status === "executing";
  const isCompleted = status === "completed";
  const isSimulated = status === "simulated";
  const isDeclined = status === "declined";
  const isFailed = status === "failed";
  const isResultState = isCompleted || isSimulated || isFailed;

  const addressLines = useMemo(() => formatAddressLines(detail), [detail]);
  const canExpand = !isProposed && (addressLines.length > 0 || Boolean(detail));
  const shouldShowDetails = isProposed || (canExpand && expanded);
  const resultMeta = useMemo(() => {
    if (!isResultState) return "";
    const parts = [];
    if (approvedBy) parts.push(`Approved by ${approvedBy}`);
    else parts.push("Approved");
    const timeLabel = formatActionTimestamp(approvedAt);
    if (timeLabel) parts.push(timeLabel);
    return parts.join(" • ");
  }, [approvedAt, approvedBy, isResultState]);
  const appliedChangeLines = useMemo(
    () => getAppliedChangeLines({ actionType, detail, payload }),
    [actionType, detail, payload]
  );
  const appliedChangeLabel = useMemo(() => getAppliedChangeLabel(actionType), [actionType]);
  const showAppliedChange = useMemo(() => shouldShowAppliedChange(actionType), [actionType]);
  const resultModalTitle = useMemo(
    () => getResultModalTitle({ actionType, actionName, status }),
    [actionName, actionType, status]
  );
  const resultStatusText = useMemo(
    () => getResultStatusText({ status, actionType, testMode }),
    [actionType, status, testMode]
  );
  const normalizedAction = String(actionType || "").trim().toLowerCase();
  const resolvedOrderNumber =
    String(orderSummary?.id || orderSummary?.orderNumber || fallbackOrderNumber || "").trim();
  const hasResolvedOrderNumber = Boolean(resolvedOrderNumber);
  const orderTitle = hasResolvedOrderNumber ? `Order #${resolvedOrderNumber}` : "";
  const orderDisplayNumber = getOrderDisplayNumber(orderSummary);
  const orderTotal = formatCurrency(orderSummary?.total, orderSummary?.currency);
  const orderDate = formatOrderDate(
    orderSummary?.placedAt ||
      orderSummary?.createdAt ||
      orderSummary?.created_at ||
      orderSummary?.processedAt ||
      orderSummary?.processed_at
  );
  const orderCustomer = customerEmail || orderSummary?.customerEmail || null;
  const orderItems = Array.isArray(orderSummary?.items) ? orderSummary.items.filter(Boolean) : [];
  const approveButtonLabel = useMemo(
    () => getApproveButtonLabel({ actionType, actionName, payload, orderSummary }),
    [actionName, actionType, orderSummary, payload]
  );
  const impactSummaryLines = useMemo(
    () =>
      getImpactSummaryLines({
        actionType,
        payload,
        orderDisplayNumber,
        orderSummary,
      }),
    [actionType, orderDisplayNumber, orderSummary, payload]
  );
  const proposedTitle = useMemo(() => {
    if (normalizedAction === "cancel_order" && orderDisplayNumber) {
      return `${actionName} ${orderDisplayNumber}`;
    }
    return actionName;
  }, [actionName, normalizedAction, orderDisplayNumber]);

  if (isResultState) {
    return (
      <>
        <div className="inline-flex w-[360px] max-w-full flex-col items-end">
          {resultMeta ? (
            <div className="mb-1 px-1 text-right text-xs text-slate-500">{resultMeta}</div>
          ) : null}
          <div className="inline-flex w-full items-center rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-12 w-12 flex-none items-center justify-center">
                <Image src={shopifyLogo} alt="" className="h-24 w-24 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-slate-950">
                  {hasResolvedOrderNumber ? (
                    orderTitle
                  ) : (
                    <span className="inline-flex items-center gap-2 text-slate-500">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Loading order...
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{resultStatusText}</span>
                  {orderTotal ? <span>&bull; {orderTotal}</span> : null}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowApprovedDetail(true)}
              className="ml-3 inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label={`View ${actionName} details`}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
        <Dialog open={showApprovedDetail} onOpenChange={setShowApprovedDetail}>
          <DialogContent className="sm:max-w-[560px] [&>button]:hidden">
            <DialogHeader className="space-y-0">
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="flex items-center gap-1.5 text-xl font-medium text-slate-950">
                  <span className="inline-flex h-10 w-10 items-center justify-center">
                    <Image src={shopifyLogo} alt="" className="h-14 w-14 object-contain" />
                  </span>
                  <span>{resultModalTitle}</span>
                </DialogTitle>
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2.5 py-1 text-xs font-medium ${getStatusPillClasses(status)}`}>
                    {resultStatusText}
                  </span>
                  <DialogClose
                    className="inline-flex h-5 w-5 items-center justify-center text-slate-400 transition-colors hover:text-slate-600"
                    aria-label="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </DialogClose>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-5">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
                <div className="grid grid-cols-[110px_1fr] gap-y-2.5 text-sm">
                  <div className="text-slate-500">Order</div>
                  <div className="text-right font-semibold text-slate-950">
                    {orderDisplayNumber ||
                      (hasResolvedOrderNumber ? `#${resolvedOrderNumber}` : "—")}
                  </div>
                  <div className="text-slate-500">Customer</div>
                  <div className="truncate text-right font-medium text-slate-950">{orderCustomer || "—"}</div>
                  <div className="text-slate-500">Date</div>
                  <div className="text-right font-medium text-slate-950">{orderDate || "—"}</div>
                  <div className="text-slate-500">Total</div>
                  <div className="text-right font-semibold text-slate-950">{orderTotal || "—"}</div>
                </div>
              </div>

              {showAppliedChange ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-600">{appliedChangeLabel}</div>
                  <div className="space-y-0.5 text-base font-medium text-slate-950">
                    {appliedChangeLines.map((line, index) => (
                      <div key={`approved-line-${index}`}>{line}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {orderItems.length ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-600">Items</div>
                  <div className="space-y-1.5">
                    {orderItems.map((item, index) => (
                      <div
                        key={`order-item-${index}`}
                        className="flex items-center justify-between gap-3 text-sm text-slate-700"
                      >
                        <div className="min-w-0 truncate">{item}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (isExecuting) {
    return (
      <div className="w-full max-w-[520px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <LoaderCircle className="h-4 w-4 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-950">{actionName}</div>
            <div className="text-xs text-slate-500">Executing action...</div>
          </div>
        </div>
      </div>
    );
  }

  if (isDeclined) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 opacity-75">
        <button
          type="button"
          className="flex h-12 w-full items-center gap-3 text-left"
          onClick={() => canExpand && setExpanded((prev) => !prev)}
          disabled={!canExpand}
        >
          <XCircle className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-500 line-through">{actionName} declined.</span>
          {canExpand ? (
            expanded ? (
              <ChevronDown className="ml-auto h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
            )
          ) : null}
        </button>
        {shouldShowDetails ? (
          <div className="border-t border-gray-100 pb-3 pt-2">
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-slate-700">
              {addressLines.length ? (
                addressLines.map((line, index) => <div key={`declined-line-${index}`}>{line}</div>)
              ) : (
                <div>{detail}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (isFailed) {
    const failedDetail = normalizeFailedDetail(
      error || detail || "Order is Fulfilled and cannot be changed"
    );
    return (
      <div className="rounded-lg border border-violet-100 bg-violet-50 px-4">
        <div className="flex h-12 w-full items-center gap-3 text-left">
          <XCircle className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-medium text-violet-900">{failedDetail}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[520px] overflow-hidden rounded-lg border border-violet-100 bg-white">
      <div className="p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center">
              <Image src={shopifyLogo} alt="" className="h-12 w-12 object-contain" />
            </div>
            <div className="truncate text-l font-semibold leading-tight text-slate-900">{proposedTitle}</div>
          </div>
          <div className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-violet-600">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>Awaiting approval</span>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-violet-100 bg-slate-50/40 p-2.5">
          <div className="space-y-0.5 text-sm text-slate-700">
            {impactSummaryLines.map((line, index) => (
              <div key={`impact-line-${index}`}>{line}</div>
            ))}
          </div>
        </div>

        {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
        {extraContent ? <div className="mt-2">{extraContent}</div> : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-violet-100 bg-violet-50/30 px-3 py-2">
        <div className="text-xs text-slate-600">This action requires your approval</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onDecline}
            disabled={loading}
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onApprove}
            disabled={loading}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {loading ? "Applying..." : approveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
