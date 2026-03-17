import { useMemo, useState } from "react";
import Image from "next/image";
import { Download, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, getEffectiveSenderEmail, getSenderLabel } from "@/components/inbox/inbox-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deriveMessageBodies } from "@/components/inbox/message-body";

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
  const withLinks = escaped.replace(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s>]*)?/gi, (rawUrl) => {
    const match = String(rawUrl).match(/^(.*?)([)\].,!?;:]*)$/);
    const url = match?.[1] || rawUrl;
    const trailing = match?.[2] || "";
    return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${trailing}`;
  });
  return withLinks.replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>");
};

const formatQuotedText = (value) => {
  const lines = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines
    .map((line) => {
      const trimmed = String(line || "");
      const quoteMatch = trimmed.match(/^(\s*>+)\s?(.*)$/);
      if (!quoteMatch) {
        if (!trimmed.trim()) return '<div class="h-3"></div>';
        return `<div>${linkifyText(trimmed)}</div>`;
      }
      const depth = Math.min(4, quoteMatch[1].replace(/\s/g, "").length);
      const content = quoteMatch[2] || "";
      const padding = 10 + (depth - 1) * 10;
      return [
        `<div style="margin:6px 0 0 ${Math.max(0, (depth - 1) * 10)}px;`,
        `padding-left:${padding}px;`,
        'border-left:3px solid #d1d5db;',
        'color:#6b7280;',
        'font-size:14px;',
        'line-height:1.7;">',
        content.trim() ? linkifyText(content) : '<span style="opacity:.5;">&nbsp;</span>',
        "</div>",
      ].join("");
    })
    .join("");
};

const formatAddressLabel = (name, email) => {
  const displayName = String(name || "").trim();
  const displayEmail = String(email || "").trim();
  if (!displayName) return displayEmail || "-";
  if (!displayEmail) return displayName;
  if (displayName.toLowerCase() === displayEmail.toLowerCase()) return displayEmail;
  return `${displayName} <${displayEmail}>`;
};

const hasQuotedPlainText = (value) =>
  /(^|\n)\s*>+/.test(String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));

const normalizeCid = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^cid:/i, "")
    .replace(/^<|>$/g, "")
    .toLowerCase();

const buildCidAttachmentUrlMap = (attachments = []) => {
  const map = new Map();
  for (const attachment of attachments || []) {
    const attachmentId = String(attachment?.id || "").trim();
    if (!attachmentId || !attachment?.storage_path) continue;
    const candidates = [
      attachment?.provider_attachment_id,
      attachment?.providerAttachmentId,
      attachment?.content_id,
      attachment?.contentId,
    ];
    for (const candidate of candidates) {
      const key = normalizeCid(candidate);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, `/api/attachments/${attachmentId}/download?disposition=inline`);
      }
    }
  }
  return map;
};

const resolveInlineCidImages = (html, attachments = []) => {
  const cidMap = buildCidAttachmentUrlMap(attachments);
  const removeUnresolvedCidImages = (value) =>
    String(value || "").replace(/<img\b[^>]*\bsrc=(['"])cid:[^'"]+\1[^>]*>/gi, "");
  if (!cidMap.size) {
    // Avoid browser cid: fetch errors when we cannot resolve inline references.
    return removeUnresolvedCidImages(html);
  }
  const replaced = String(html || "").replace(
    /<img\b[^>]*\bsrc=(['"])cid:([^'"]+)\1[^>]*>/gi,
    (imgTag, quote, cidValue) => {
      const key = normalizeCid(cidValue);
      const mapped = key ? cidMap.get(key) : "";
      if (!mapped) return "";
      return String(imgTag).replace(
        /\bsrc=(['"])cid:[^'"]+\1/i,
        `src=${quote}${mapped}${quote}`
      );
    }
  );
  return removeUnresolvedCidImages(replaced);
};

const sanitizeEmailHtml = (value, attachments = []) => {
  if (!value) return "";
  const htmlWithResolvedInlineCids = resolveInlineCidImages(value, attachments);
  return String(htmlWithResolvedInlineCids)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?font[^>]*>/gi, "")
    .replace(/\sstyle=(['"])[\s\S]*?\1/gi, "")
    .replace(/\sclass=(['"])[\s\S]*?\1/gi, "")
    .replace(/<\/?(html|head|body|meta|title)[^>]*>/gi, "");
};

const EMAIL_BODY_CLASS =
  "max-w-none w-full min-w-0 break-words [overflow-wrap:anywhere] text-[14px] leading-[1.55] text-gray-800 font-[inherit] [&_*]:max-w-full [&_*]:min-w-0 [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_*]:font-[inherit] [&_*]:text-[14px] [&_*]:leading-[1.55]";

const isImageAttachment = (mimeType = "") => String(mimeType || "").toLowerCase().startsWith("image/");
const isPdfAttachment = (mimeType = "") => String(mimeType || "").toLowerCase() === "application/pdf";
const normalizeLower = (value = "") => String(value || "").trim().toLowerCase();

export function MessageBubble({
  message,
  direction = "inbound",
  attachments = [],
  outboundSenderName,
  currentUserId,
}) {
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [viewEmailOpen, setViewEmailOpen] = useState(false);
  const isOutbound = direction === "outbound";
  const isAuthoredByCurrentUser =
    Boolean(currentUserId) &&
    String(message?.user_id || "") === String(currentUserId) &&
    isOutbound;
  const senderLabel = isAuthoredByCurrentUser
    ? outboundSenderName || getSenderLabel(message)
    : getSenderLabel(message);
  const rawType = normalizeLower(
    message?.type || message?.message_type || message?.kind || ""
  );
  const senderLower = normalizeLower(senderLabel);
  const isAiMessage =
    rawType.startsWith("ai") ||
    rawType.includes("assistant") ||
    senderLower === "sona" ||
    senderLower === "sona ai";
  const senderDisplayName = isAiMessage ? "Sona" : senderLabel || "Unknown sender";
  const senderEmail = getEffectiveSenderEmail(message);
  const timestampValue = message.received_at || message.sent_at || message.created_at;
  const timestamp = timestampValue
    ? new Date(timestampValue).toLocaleString("da-DK", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    })
    : "";
  const toList = message.to_emails || [];
  const ccList = message.cc_emails || [];
  const bccList = message.bcc_emails || [];
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
  const safeBodyHtml = sanitizeEmailHtml(message?.body_html || "", attachments);
  const { cleanBodyText, quotedBodyText, cleanBodyHtml, quotedBodyHtml } = deriveMessageBodies(message);
  const safeCleanBodyHtml = sanitizeEmailHtml(cleanBodyHtml || "", attachments);
  const safeQuotedBodyHtml = sanitizeEmailHtml(quotedBodyHtml || "", attachments);
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
  const attachmentCards = (attachments || []).filter((attachment) => Boolean(attachment?.id));
  const subjectLine = String(message?.subject || "").trim() || "Email";
  const senderDetails = formatAddressLabel(senderDisplayName, senderEmail);
  const rawPlainBody = message.body_text || message.snippet || "No preview available.";
  const shouldFormatRawPlainBody =
    Boolean((quotedBodyText || "").trim()) || hasQuotedPlainText(rawPlainBody);
  const shouldShowBcc = isOutbound && bccList.length > 0;

  return (
    <>
      <div className={cn("w-full", isOutbound ? "flex justify-end" : "flex justify-start")}>
        <div
          className={cn(
            "w-full max-w-full sm:max-w-[560px] lg:max-w-[620px]"
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <div
              className={cn(
                "flex flex-wrap items-start gap-2 px-1",
                isOutbound ? "justify-end" : "justify-start"
              )}
            >
              <div className={cn("leading-tight", isOutbound ? "text-right" : "text-left")}>
                <div className="text-[13px] font-semibold text-gray-800">
                  {senderDisplayName}{" "}
                  <span className="text-[12px] font-medium text-gray-400">
                    {timestamp}
                  </span>
                </div>
              </div>
              {isAuthoredByCurrentUser ? (
                <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[12px] font-medium text-slate-600">
                  You
                </span>
              ) : null}
              {isDraft ? (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[12px] font-medium text-blue-700">
                  Draft
                </span>
              ) : null}
            </div>

            <div
              className={cn(
                "overflow-hidden rounded-xl border text-xs shadow-[0_1px_2px_0_rgba(0,0,0,0.05),0_4px_6px_-1px_rgba(0,0,0,0.02)]",
                isInternalNote
                  ? "border-yellow-200 bg-yellow-50"
                  : isOutbound
                  ? "border-indigo-100 bg-indigo-50/40"
                  : "border-gray-200 bg-white"
              )}
            >
              <div className={cn("px-4 py-3 text-[14px] leading-[1.55] text-gray-800", isOutbound && "text-[14px]")}>
                {safeCleanBodyHtml ? (
                  <div
                    className={EMAIL_BODY_CLASS}
                    dangerouslySetInnerHTML={{ __html: safeCleanBodyHtml }}
                  />
                ) : (
                  <div
                    className={EMAIL_BODY_CLASS}
                    dangerouslySetInnerHTML={{
                      __html: linkifyText(cleanBodyText || message.body_text || message.snippet || "No preview available."),
                    }}
                  />
                )}
              </div>
            </div>

            {attachmentCards.length ? (
              <div className="rounded-xl border border-gray-200 bg-white px-4 pb-3 pt-2">
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400">Files</p>
                <div className="flex flex-wrap gap-1.5">
                  {attachmentCards.map((attachment) => {
                    const isImage = isImageAttachment(attachment?.mime_type);
                    const canPreview = Boolean(attachment?.storage_path);
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => setSelectedAttachment(attachment)}
                        className="w-[260px] overflow-hidden rounded-md border border-gray-200 bg-white text-left hover:border-gray-300"
                      >
                        <div className="flex items-center gap-2 px-2 py-1.5">
                          {isImage && canPreview ? (
                            <Image
                              src={`/api/attachments/${attachment.id}/download?disposition=inline`}
                              alt={attachment?.filename || "Image attachment"}
                              width={56}
                              height={56}
                              className="h-12 w-12 shrink-0 rounded object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-[12px] text-gray-500">
                              File
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium text-gray-800">
                              {attachment?.filename || "Attachment"}
                            </p>
                            <p className="text-[12px] text-gray-500">
                              {attachment?.mime_type || "Unknown type"}
                              {attachment?.size_bytes ? ` • ${formatBytes(attachment.size_bytes)}` : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!isInternalNote ? (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-3 px-1 text-sm font-medium text-gray-600",
                  isOutbound ? "justify-end" : "justify-start"
                )}
              >
                <button
                  type="button"
                  onClick={() => setViewEmailOpen(true)}
                  className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-gray-100"
                >
                  <Mail className="h-4 w-4" />
                  <span>View email</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <Dialog open={viewEmailOpen} onOpenChange={setViewEmailOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-gray-100 px-5 py-4">
            <DialogTitle className="pr-8 text-base">{subjectLine}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto bg-white px-5 py-4">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-gray-400">From</span>
                <span className="text-[13px] text-gray-700">{senderDetails}</span>
              </div>
              {toList.length ? (
                <div className="flex flex-wrap gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-gray-400">To</span>
                  <span className="text-[13px] text-gray-700">{toList.join(", ")}</span>
                </div>
              ) : null}
              {ccList.length ? (
                <div className="flex flex-wrap gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-gray-400">Cc</span>
                  <span className="text-[13px] text-gray-700">{ccList.join(", ")}</span>
                </div>
              ) : null}
              {shouldShowBcc ? (
                <div className="flex flex-wrap gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-gray-400">Bcc</span>
                  <span className="text-[13px] text-gray-700">{bccList.join(", ")}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-gray-400">Date</span>
                <span className="text-[13px] text-gray-700">{timestamp || "-"}</span>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/40 p-4">
              {safeBodyHtml ? (
                <div
                  className={EMAIL_BODY_CLASS}
                  dangerouslySetInnerHTML={{ __html: safeBodyHtml }}
                />
              ) : (
                <div
                  className={cn(
                    EMAIL_BODY_CLASS,
                    shouldFormatRawPlainBody &&
                      "text-[14px] leading-6 text-gray-700 [&_*]:text-[14px] [&_*]:leading-6"
                  )}
                  dangerouslySetInnerHTML={{
                    __html: shouldFormatRawPlainBody
                      ? formatQuotedText(rawPlainBody)
                      : linkifyText(rawPlainBody),
                  }}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
    </>
  );
}
