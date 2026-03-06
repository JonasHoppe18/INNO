import { useMemo, useState } from "react";
import Image from "next/image";
import { Download, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, getSenderLabel } from "@/components/inbox/inbox-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

const sanitizeEmailHtml = (value) => {
  if (!value) return "";
  return String(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/<\/?font[^>]*>/gi, "")
    .replace(/\sstyle=(['"])[\s\S]*?\1/gi, "")
    .replace(/\sclass=(['"])[\s\S]*?\1/gi, "")
    .replace(/<\/?(html|head|body|meta|title)[^>]*>/gi, "");
};

const EMAIL_BODY_CLASS =
  "max-w-none w-full text-[15px] leading-7 text-gray-800 font-[inherit] [&_*]:font-[inherit] [&_*]:text-[15px] [&_*]:leading-7";

const isImageAttachment = (mimeType = "") => String(mimeType || "").toLowerCase().startsWith("image/");
const isPdfAttachment = (mimeType = "") => String(mimeType || "").toLowerCase() === "application/pdf";

export function MessageBubble({
  message,
  direction = "inbound",
  attachments = [],
  outboundSenderName,
  currentUserId,
}) {
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const isOutbound = direction === "outbound";
  const isAuthoredByCurrentUser =
    Boolean(currentUserId) && String(message?.user_id || "") === String(currentUserId);
  const senderLabel = isAuthoredByCurrentUser
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
  const bccList = message.bcc_emails || [];
  const avatarStyle = pickAvatarStyle(senderLabel);
  const isDraft = Boolean(message?.is_draft);
  const isInternalNote =
    String(message?.provider_message_id || "").startsWith("internal-note:") ||
    (Boolean(message?.from_me) &&
      !isDraft &&
      !message?.sent_at &&
      !message?.received_at &&
      toList.length === 0 &&
      ccList.length === 0 &&
      bccList.length === 0);
  const safeBodyHtml = sanitizeEmailHtml(message?.body_html || "");
  const selectedAttachmentUrl = useMemo(() => {
    if (!selectedAttachment?.id) return "";
    return `/api/attachments/${selectedAttachment.id}/download`;
  }, [selectedAttachment]);
  const selectedAttachmentInlineUrl = useMemo(() => {
    if (!selectedAttachment?.id) return "";
    return `/api/attachments/${selectedAttachment.id}/download?disposition=inline`;
  }, [selectedAttachment]);
  const canPreviewImage = isImageAttachment(selectedAttachment?.mime_type);
  const canPreviewPdf = isPdfAttachment(selectedAttachment?.mime_type);
  const canDownload = Boolean(selectedAttachment?.storage_path);
  const inlineImageAttachments = (attachments || []).filter(
    (attachment) => isImageAttachment(attachment?.mime_type) && attachment?.storage_path && attachment?.id
  );

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
        isInternalNote
          ? "bg-yellow-50 border-yellow-200"
          : isOutbound
          ? "bg-slate-50 border-slate-200"
          : "bg-white border-gray-200 shadow-sm"
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-4 py-2.5",
          isInternalNote && "border-yellow-200",
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
                {isAuthoredByCurrentUser ? (
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    You
                  </span>
                ) : null}
                {isDraft ? (
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    Draft
                  </span>
                ) : null}
                {isInternalNote ? (
                  <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
                    Internal note
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
        {safeBodyHtml ? (
          <div
            className={EMAIL_BODY_CLASS}
            dangerouslySetInnerHTML={{ __html: safeBodyHtml }}
          />
        ) : (
          <div
            className={EMAIL_BODY_CLASS}
            dangerouslySetInnerHTML={{
              __html: linkifyText(message.body_text || message.snippet || "No preview available."),
            }}
          />
        )}
      </div>
      {attachments.length ? (
        <div className="px-4 pb-4">
          {inlineImageAttachments.length ? (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {inlineImageAttachments.map((attachment) => (
                <button
                  key={`preview-${attachment.id}`}
                  type="button"
                  onClick={() => setSelectedAttachment(attachment)}
                  className="group overflow-hidden rounded-md border border-gray-200 bg-white"
                >
                  <Image
                    src={`/api/attachments/${attachment.id}/download?disposition=inline`}
                    alt={attachment?.filename || "Image attachment"}
                    width={640}
                    height={384}
                    className="h-24 w-full object-cover transition-transform group-hover:scale-[1.02]"
                    unoptimized
                  />
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="text-xs text-gray-500">
                <button
                  type="button"
                  onClick={() => setSelectedAttachment(attachment)}
                  className="font-medium text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
                >
                  {attachment.filename || "Attachment"}
                </button>
                <div className="text-[11px] opacity-70">
                  {attachment.size_bytes ? formatBytes(attachment.size_bytes) : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Dialog open={Boolean(selectedAttachment)} onOpenChange={(open) => !open && setSelectedAttachment(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-gray-100 px-5 py-4">
            <DialogTitle className="pr-8 text-base">
              {selectedAttachment?.filename || "Attachment"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto bg-gray-50 p-4">
            {canPreviewImage && canDownload ? (
              <Image
                src={selectedAttachmentUrl}
                alt={selectedAttachment?.filename || "Attachment preview"}
                width={1600}
                height={1200}
                className="mx-auto h-auto max-h-[60vh] max-w-full rounded border border-gray-200 bg-white object-contain"
                unoptimized
              />
            ) : null}
            {canPreviewPdf && canDownload ? (
              <iframe
                title={selectedAttachment?.filename || "Attachment preview"}
                src={selectedAttachmentUrl}
                className="h-[60vh] w-full rounded border border-gray-200 bg-white"
              />
            ) : null}
            {!canPreviewImage && !canPreviewPdf ? (
              <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
                Preview is not available for this file type.
              </div>
            ) : null}
            {(canPreviewImage || canPreviewPdf) && !canDownload ? (
              <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
                File content is currently unavailable.
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <div className="text-xs text-gray-500">
              {selectedAttachment?.mime_type || "Unknown type"}
              {selectedAttachment?.size_bytes ? ` • ${formatBytes(selectedAttachment.size_bytes)}` : ""}
            </div>
            {canDownload ? (
              <div className="flex items-center gap-2">
                <a
                  href={selectedAttachmentInlineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Open in new tab
                </a>
                <a
                  href={selectedAttachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
