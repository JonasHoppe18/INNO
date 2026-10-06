import { CircleAlert, CheckCircle2, XCircle } from "lucide-react";
import { getForwardRecipientDisplayModel } from "@/lib/forward-recipient-results";

function getRecipientStatus(result) {
  if (result?.state === "sent") {
    return { label: "Forwarded", Icon: CheckCircle2, iconClassName: "text-emerald-600" };
  }
  if (result?.state === "unknown") {
    return { label: "Delivery status unknown", Icon: CircleAlert, iconClassName: "text-amber-600" };
  }
  if (result?.state === "in_progress") {
    return { label: "Delivery in progress", Icon: CircleAlert, iconClassName: "text-blue-600" };
  }
  return { label: "Could not be delivered", Icon: XCircle, iconClassName: "text-red-600" };
}

export function ForwardRecipientResults({
  results = [],
  onRetry,
  retrying = false,
  showSingleRecipient = false,
}) {
  const model = getForwardRecipientDisplayModel(results);
  if (!model.results.length || (!model.isMultiRecipient && !showSingleRecipient)) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-2.5 text-sm">
      {model.headline ? <div className="font-medium text-foreground">{model.headline}</div> : null}
      <ul aria-label="Forward recipient results" className="space-y-1.5">
        {model.results.map((result, index) => {
          const status = getRecipientStatus(result);
          const StatusIcon = status.Icon;
          return (
            <li
              key={`${String(result?.email || "recipient")}-${index}`}
              className="flex min-w-0 items-start gap-2 text-foreground/80"
            >
              <StatusIcon
                aria-hidden="true"
                className={`mt-0.5 h-4 w-4 shrink-0 ${status.iconClassName}`}
              />
              <span className="min-w-0 truncate">{result?.email || "Unknown recipient"}</span>
              <span className="shrink-0 text-muted-foreground">— {status.label}</span>
            </li>
          );
        })}
      </ul>
      {model.hasUnknown ? (
        <p className="text-xs text-amber-700">
          Delivery may have been accepted for the recipient{model.results.filter((result) => result?.state === "unknown").length === 1 ? "" : "s"} marked unknown, so Sona will not retry it automatically.
        </p>
      ) : null}
      {model.retryableRecipients.length && onRetry ? (
        <button
          type="button"
          className="rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? "Retrying failed recipients…" : "Retry failed recipients"}
        </button>
      ) : null}
    </div>
  );
}
