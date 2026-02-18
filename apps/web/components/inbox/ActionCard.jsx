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

export function ActionCard({
  status = "pending",
  actionName = "Update Address",
  detail = "",
  error = "",
  loading = false,
  onApprove,
  onDecline,
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = status === "pending";
  const isApproved = status === "approved";
  const isDeclined = status === "declined";

  const addressLines = useMemo(() => formatAddressLines(detail), [detail]);
  const canExpand = !isPending && (addressLines.length > 0 || Boolean(detail));
  const shouldShowDetails = isPending || (canExpand && expanded);

  if (isApproved) {
    return (
      <div className="rounded-lg border border-violet-100 bg-violet-50 px-4">
        <button
          type="button"
          className="flex h-12 w-full items-center gap-3 text-left"
          onClick={() => canExpand && setExpanded((prev) => !prev)}
          disabled={!canExpand}
        >
          <CheckCircle2 className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-medium text-violet-900">{actionName} approved successfully.</span>
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
                <div>{detail}</div>
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

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-violet-100 p-2">
          {actionName.toLowerCase().includes("address") ? (
            <ShieldAlert className="h-4 w-4 text-violet-600" />
          ) : (
            <Bot className="h-4 w-4 text-violet-600" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900">Permission Required: {actionName}</div>

          <div className="mt-3 rounded-lg border border-violet-100 bg-white p-3">
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

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onApprove}
              disabled={loading}
            >
              {loading ? "Applying..." : "Approve"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onDecline}
              disabled={loading}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
