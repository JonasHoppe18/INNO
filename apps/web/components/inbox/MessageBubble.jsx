import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, getSenderLabel } from "@/components/inbox/inbox-utils";
import { Button } from "@/components/ui/button";

const AVATAR_STYLES = [
  "bg-emerald-50 text-emerald-700",
  "bg-blue-50 text-blue-700",
  "bg-amber-50 text-amber-700",
  "bg-purple-50 text-purple-700",
  "bg-rose-50 text-rose-700",
];

const pickAvatarStyle = (value) => {
  if (!value) return AVATAR_STYLES[0];
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_STYLES.length;
  return AVATAR_STYLES[index];
};

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const linkifyText = (value) => {
  const normalized = value
    .replace(/<\s*(https?:\/\/[^>]+)\s*>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/([^\s])((?:https?:\/\/))/gi, "$1 $2");
  const escaped = escapeHtml(normalized);
  const withLinks = escaped.replace(
    /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s>]*)?/gi,
    (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`
  );
  return withLinks.replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>");
};

export function MessageBubble({
  message,
  direction = "inbound",
  attachments = [],
  outboundSenderName,
}) {
  const isOutbound = direction === "outbound";
  const senderLabel = isOutbound
    ? outboundSenderName || getSenderLabel(message)
    : getSenderLabel(message);
  const timestampValue = message.received_at || message.sent_at || message.created_at;
  const timestamp = timestampValue
    ? new Date(timestampValue).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    : "";
  const toList = message.to_emails || [];
  const ccList = message.cc_emails || [];
  const avatarStyle = pickAvatarStyle(senderLabel);
  const isDraft = Boolean(message?.is_draft);

  const initials = senderLabel
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border text-xs",
        isOutbound
          ? "bg-slate-50 border-slate-200"
          : "bg-white border-gray-200 shadow-sm"
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-4 py-2.5",
          isOutbound && "border-slate-200"
        )}
      >
        <div
          className="flex items-start gap-3"
        >
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold",
              avatarStyle
            )}
          >
            {initials || "?"}
          </div>
          <div className="min-w-0">
            <div
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-xs font-semibold text-gray-900">
                {senderLabel}
              </span>
                {isOutbound ? (
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    You
                  </span>
                ) : null}
                {isDraft ? (
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    Draft
                  </span>
                ) : null}
            </div>
            {toList.length || ccList.length ? (
              <details className="mt-1 text-xs text-gray-400">
                <summary className="cursor-pointer select-none">Details</summary>
                <div className="mt-1 space-y-1">
                  {toList.length ? (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-gray-300">
                        To
                      </span>
                      {toList.map((email) => (
                        <span key={email} className="rounded-full bg-gray-100 px-2 py-0.5">
                          {email}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {ccList.length ? (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-gray-300">
                        Cc
                      </span>
                      {ccList.map((email) => (
                        <span key={email} className="rounded-full bg-gray-100 px-2 py-0.5">
                          {email}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">{timestamp}</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6">
              <Reply className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="p-4 text-gray-800 leading-relaxed">
        {message.body_html ? (
          <div
            className="prose prose-sm max-w-none w-full text-sm text-gray-800"
            // Trusts email HTML from upstream providers; if needed, sanitize before render.
            dangerouslySetInnerHTML={{ __html: message.body_html }}
          />
        ) : (
          <div
            className="prose prose-sm max-w-none w-full text-sm text-gray-800"
            dangerouslySetInnerHTML={{
              __html: linkifyText(message.body_text || message.snippet || "No preview available."),
            }}
          />
        )}
      </div>
      {attachments.length ? (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="text-xs text-gray-500">
                <div className="font-medium text-gray-700">
                  {attachment.filename || "Attachment"}
                </div>
                <div className="text-[11px] opacity-70">
                  {attachment.size_bytes ? formatBytes(attachment.size_bytes) : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
