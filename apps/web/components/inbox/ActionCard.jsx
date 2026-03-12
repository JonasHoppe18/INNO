import { useMemo, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronRight, ShieldAlert, XCircle } from "lucide-react";

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

export function ActionCard({
  status = "pending",
  actionName = "Update Address",
  detail = "",
  error = "",
  loading = false,
  onApprove,
  onDecline,
  extraContent = null,
  testMode = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = status === "pending";
  const isApproved = status === "approved";
  const isDeclined = status === "declined";
  const isFailed = status === "failed";

  const addressLines = useMemo(() => formatAddressLines(detail), [detail]);
  const canExpand = !isPending && (addressLines.length > 0 || Boolean(detail));
  const shouldShowDetails = isPending || (canExpand && expanded);

  if (isApproved) {
    const approvedTitle = testMode
      ? "Action approved (Test Mode)"
      : `${actionName} approved successfully.`;
    const approvedDetail = testMode
      ? "This action was simulated. No changes were sent to Shopify."
      : detail;
    return (
      <div className="rounded-lg border border-violet-100 bg-violet-50 px-4">
        <button
          type="button"
          className="flex h-12 w-full items-center gap-3 text-left"
          onClick={() => canExpand && setExpanded((prev) => !prev)}
          disabled={!canExpand}
        >
          <CheckCircle2 className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-medium text-violet-900">
            {approvedTitle}
          </span>
          <span className="ml-auto text-xs text-violet-400">Approved just now</span>
          {canExpand ? (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-violet-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-violet-400" />
            )
          ) : null}
        </button>
        {shouldShowDetails ? (
          <div className="border-t border-violet-100 pb-3 pt-2">
            <div className="rounded-lg border border-violet-100 bg-white p-3 text-sm text-slate-700">
              {addressLines.length ? (
                addressLines.map((line, index) => <div key={`approved-line-${index}`}>{line}</div>)
              ) : (
                <div>{approvedDetail}</div>
              )}
            </div>
          </div>
        ) : null}
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
    <div className="w-full max-w-[520px] overflow-hidden rounded-lg border border-indigo-100 bg-white">
      <div className="p-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-indigo-50 p-1.5">
            {actionName.toLowerCase().includes("address") ? (
              <ShieldAlert className="h-3.5 w-3.5 text-indigo-600" />
            ) : (
              <Bot className="h-3.5 w-3.5 text-indigo-600" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-slate-900">{actionName}</div>
            <div className="mt-0.5 text-xs font-medium text-amber-600">Awaiting approval</div>
          </div>
        </div>

        <div className="mt-2 rounded-md border border-indigo-100 bg-slate-50/40 p-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Requested Change
          </div>
          <div className="mt-1 space-y-0.5 text-sm text-slate-700">
            {addressLines.length ? (
              addressLines.map((line, index) => <div key={`pending-line-${index}`}>{line}</div>)
            ) : (
              <div>{detail || `Sona wants to ${actionName.toLowerCase()}.`}</div>
            )}
          </div>
        </div>

        {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
        {extraContent ? <div className="mt-2">{extraContent}</div> : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-indigo-100 bg-indigo-50/30 px-3 py-2">
        <div className="text-xs text-slate-600">Requires approval</div>
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
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onApprove}
            disabled={loading}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {loading ? "Applying..." : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
