import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Download, Globe, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, getEffectiveSenderEmail, getSenderLabel } from "@/components/inbox/inbox-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deriveMessageBodies } from "@/components/inbox/message-body";

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const decodeHtmlEntitiesOnce = (value = "") => {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    oslash: "ø",
    Oslash: "Ø",
    aring: "å",
    Aring: "Å",
    aelig: "æ",
    AElig: "Æ",
    euro: "€",
    times: "×",
  };
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, num) => {
      const codePoint = Number(num);
      if (!Number.isFinite(codePoint)) return "";
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isFinite(codePoint)) return "";
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    })
    .replace(/&([a-z]+);/gi, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(named, key)) return named[key];
      return match;
    });
};

const decodeHtmlEntities = (value = "") => {
  let current = String(value || "");
  // Some providers store entities double-encoded (e.g. &amp;oslash;).
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodeHtmlEntitiesOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
};

const stripQuotedHeaderTail = (value = "") => {
  const normalized = String(value || "")
    .replace(/\s+(Sent:|From:|To:|Subject:|Dato:|Fra:|Til:|Emne:)/gi, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cutIndex = normalized.search(/\n(?:Sent:|From:|To:|Subject:|Dato:|Fra:|Til:|Emne:)/i);
  if (cutIndex > 0) return normalized.slice(0, cutIndex).trim();
  return normalized;
};

const linkifyText = (value) => {
  const normalized = decodeHtmlEntities(value)
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

const normalizeAttachmentFilename = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

const parseInlineStoragePath = (value = "") => {
  const raw = String(value || "");
  if (!raw.startsWith("inline:")) return null;
  const payload = raw.slice("inline:".length);
  const commaIndex = payload.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = payload.slice(0, commaIndex);
  const contentBase64 = payload.slice(commaIndex + 1).replace(/\s+/g, "");
  const [mimeType] = metadata.split(";");
  if (!contentBase64) return null;
  return {
    mimeType: String(mimeType || "application/octet-stream").trim() || "application/octet-stream",
    contentBase64,
  };
};

const getAttachmentInlineSrc = (attachment) => {
  if (!attachment || typeof attachment !== "object") return "";
  const attachmentId = String(attachment?.id || "").trim();
  if (attachmentId) {
    return `/api/attachments/${attachmentId}/download?disposition=inline`;
  }
  const storageInline = parseInlineStoragePath(attachment?.storage_path || "");
  if (storageInline?.contentBase64) {
    return `data:${storageInline.mimeType};base64,${storageInline.contentBase64}`;
  }
  const contentBase64 = String(
    attachment?.content_base64 || attachment?.contentBase64 || ""
  ).replace(/\s+/g, "");
  if (!contentBase64) return "";
  const mimeType = String(
    attachment?.mime_type || attachment?.mimeType || "application/octet-stream"
  ).trim();
  return `data:${mimeType || "application/octet-stream"};base64,${contentBase64}`;
};

const lookupAttachmentInlineUrl = (cidMap, rawSrc = "") => {
  const src = String(rawSrc || "").trim();
  if (!src) return "";
  const withoutCidPrefix = src.replace(/^cid:/i, "");
  const basename = withoutCidPrefix.split("/").pop() || withoutCidPrefix;
  const decodedBasename = (() => {
    try {
      return decodeURIComponent(basename);
    } catch {
      return basename;
    }
  })();

  const candidates = [
    normalizeCid(src),
    normalizeCid(withoutCidPrefix),
    normalizeCid(basename),
    normalizeAttachmentFilename(src),
    normalizeAttachmentFilename(withoutCidPrefix),
    normalizeAttachmentFilename(basename),
    normalizeAttachmentFilename(decodedBasename),
  ].filter(Boolean);

  for (const key of candidates) {
    const mapped = cidMap.get(key);
    if (mapped) return mapped;
  }

  return "";
};

const buildCidAttachmentUrlMap = (attachments = []) => {
  const map = new Map();
  const addCandidate = (candidate, url) => {
    const key = normalizeCid(candidate);
    if (!key || map.has(key)) return;
    map.set(key, url);
    const withoutDomainPart = key.split("@")[0];
    if (withoutDomainPart && !map.has(withoutDomainPart)) {
      map.set(withoutDomainPart, url);
    }
  };

  for (const attachment of attachments || []) {
    const url = getAttachmentInlineSrc(attachment);
    if (!url) continue;
    const candidates = [
      attachment?.provider_attachment_id,
      attachment?.providerAttachmentId,
      attachment?.content_id,
      attachment?.contentId,
      attachment?.filename,
      attachment?.name,
    ];
    for (const candidate of candidates) {
      addCandidate(candidate, url);
      const filename = normalizeAttachmentFilename(candidate);
      if (filename) addCandidate(filename, url);
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
  const cidMap = buildCidAttachmentUrlMap(attachments);
  const htmlWithResolvedInlineCids = resolveInlineCidImages(value, attachments);
  const sanitizedWithSafeImages = String(htmlWithResolvedInlineCids).replace(
    /<img\b[^>]*>/gi,
    (imgTag) => {
      const quotedSrc = String(imgTag).match(/\bsrc=(['"])(.*?)\1/i)?.[2] || "";
      const unquotedSrc = String(imgTag).match(/\bsrc=([^\s>]+)/i)?.[1] || "";
      const rawSrc = String(quotedSrc || unquotedSrc || "").trim();
      if (!rawSrc) return "";

      const mappedSrc = lookupAttachmentInlineUrl(cidMap, rawSrc);
      const resolvedSrc = mappedSrc || rawSrc;

      const isSafeAttachmentSrc =
        resolvedSrc.startsWith("/api/attachments/") ||
        /\/api\/attachments\/[^/]+\/download/i.test(resolvedSrc) ||
        /^data:image\//i.test(resolvedSrc) ||
        /^https?:\/\//i.test(resolvedSrc);

      if (!isSafeAttachmentSrc) return "";

      return `<img src="${escapeHtml(resolvedSrc)}" alt="Inline attachment image" loading="lazy">`;
    }
  );

  const sanitized = String(sanitizedWithSafeImages)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/<\/?font[^>]*>/gi, "")
    .replace(/\sstyle=(['"])[\s\S]*?\1/gi, "")
    .replace(/\sclass=(['"])[\s\S]*?\1/gi, "")
    .replace(/<\/?(html|head|body|meta|title)[^>]*>/gi, "");

  const tokens = sanitized.split(/(<[^>]+>)/g);
  let insideAnchor = false;
  return tokens
    .map((token) => {
      if (!token) return token;
      if (token.startsWith("<")) {
        if (/^<a\b/i.test(token)) insideAnchor = true;
        if (/^<\/a>/i.test(token)) insideAnchor = false;
        return token;
      }
      if (insideAnchor) return token;
      return token.replace(
        /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<]*)?/gi,
        (rawUrl) => {
          const match = String(rawUrl).match(/^(.*?)([)\].,!?;:]*)$/);
          const url = match?.[1] || rawUrl;
          const trailing = match?.[2] || "";
          return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${trailing}`;
        }
      );
    })
    .join("");
};

const INLINE_ATTACHMENT_ID_RE = /\/api\/attachments\/([^/?#"'\s]+)\/download/g;
const collectInlineAttachmentIds = (html = "") => {
  const ids = new Set();
  const str = String(html || "");
  let match;
  INLINE_ATTACHMENT_ID_RE.lastIndex = 0;
  while ((match = INLINE_ATTACHMENT_ID_RE.exec(str)) !== null) ids.add(match[1]);
  INLINE_ATTACHMENT_ID_RE.lastIndex = 0;
  return ids;
};

const stripHtmlToText = (value = "") =>
  decodeHtmlEntities(String(value || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|table|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/td>\s*<td\b[^>]*>/gi, ": ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const FORM_MESSAGE_RE = /\b(?:new customer message on|online store'?s contact form|country code:|what do you need help with\?:|if applicable, place of purchase and order number:)\b/i;

const isStructuredFormMessage = (message) =>
  FORM_MESSAGE_RE.test(
    [
      message?.subject,
      message?.body_text,
      message?.snippet,
      stripHtmlToText(message?.body_html || ""),
    ]
      .filter(Boolean)
      .join("\n")
  );

const formatStructuredFormText = (value, subjectLine = "") => {
  const subject = String(subjectLine || "").trim().toLowerCase();
  const normalized = String(value || "")
    .replace(
      /\s+(Country Code:|Name:|Email:|Company\s*\/\s*Team:|Your Country:|If Applicable,\s*Place Of Purchase And Order Number:|What Is Your Request Regarding\?:|What Do You Need Help With\?:|Body:)/gi,
      "\n$1"
    );
  const lines = normalized
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""));

  const filtered = lines.filter((line, index) => {
    if (!line) return true;
    const normalized = line.toLowerCase();
    if (subject && normalized === subject) return false;
    if (
      normalized === "you received a new message from your online store's contact form." ||
      normalized === "you received a new message from your online stores contact form."
    ) {
      return false;
    }
    if (index > 0 && normalized === String(lines[index - 1] || "").trim().toLowerCase()) {
      return false;
    }
    return true;
  });

  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const EMAIL_BODY_CLASS =
  "max-w-none w-full min-w-0 break-words [overflow-wrap:anywhere] text-[14px] leading-[1.55] text-foreground font-[inherit] [&_*]:max-w-full [&_*]:min-w-0 [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_*]:font-[inherit] [&_*]:text-[14px] [&_*]:leading-[1.55] [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-700 dark:hover:[&_a]:text-blue-300 [&_img]:max-h-[340px] [&_img]:w-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:cursor-zoom-in [&_img]:transition-opacity [&_img]:duration-150 hover:[&_img]:opacity-90";

const IMAGE_FILENAME_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;

const isImageAttachment = (attachmentOrMime = "") => {
  if (typeof attachmentOrMime === "string") {
    return String(attachmentOrMime || "").toLowerCase().startsWith("image/");
  }
  const mimeType = String(
    attachmentOrMime?.mime_type || attachmentOrMime?.content_type || attachmentOrMime?.mimeType || ""
  )
    .trim()
    .toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  const filename = String(attachmentOrMime?.filename || attachmentOrMime?.name || "").trim();
  return IMAGE_FILENAME_RE.test(filename);
};
const isPdfAttachment = (mimeType = "") => String(mimeType || "").toLowerCase() === "application/pdf";
const normalizeLower = (value = "") => String(value || "").trim().toLowerCase();
const DISPLAY_TIMEZONE = "Europe/Copenhagen";

function ImageGrid({ images, onOpen }) {
  const count = images.length;
  const shown = images.slice(0, 4);
  const overflow = count - 4;

  const gridClass =
    count === 1
      ? "grid-cols-1"
      : count === 2
      ? "grid-cols-2"
      : "grid-cols-2";

  return (
    <div className={cn("grid gap-1 overflow-hidden rounded-xl", gridClass, count === 3 && "grid-rows-2")}>
      {shown.map((img, i) => {
        const isLast = i === 3 && overflow > 0;
        const isTall = count === 3 && i === 0;
        const src = getAttachmentInlineSrc(img);
        const key = String(img?.id || img?.provider_attachment_id || img?.filename || `image-${i}`);
        if (!src) return null;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onOpen(img)}
            style={{ animationDelay: `${i * 40}ms` }}
            className={cn(
              "group/img relative overflow-hidden bg-muted outline-none animate-in fade-in duration-200",
              isTall ? "row-span-2" : "",
              count === 1 ? "max-h-[340px] min-h-[180px]" : "h-[160px]"
            )}
          >
            <Image
              src={src}
              alt={img?.filename || "Image"}
              fill
              sizes="(max-width: 640px) 50vw, 280px"
              className="object-cover transition-transform duration-200 ease-out group-hover/img:scale-[1.03]"
              unoptimized
            />
            {isLast ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
                <span className="text-[22px] font-semibold text-white">+{overflow}</span>
              </div>
            ) : (
              <div className="absolute inset-0 bg-black/0 transition-colors duration-150 group-hover/img:bg-black/10" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function ImageLightbox({ images, index, onClose, onNext, onPrev }) {
  const img = images[index];
  const url = img ? getAttachmentInlineSrc(img) : "";
  const hasNext = index < images.length - 1;
  const hasPrev = index > 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.88)" }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] animate-in fade-in zoom-in-95 duration-150 flex-col items-center"
        style={{ animationTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <Image
            key={img?.id}
            src={url}
            alt={img?.filename || "Image"}
            width={1600}
            height={1200}
            className="max-h-[80vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
            unoptimized
          />
        </div>

        {images.length > 1 ? (
          <div className="mt-3 text-[13px] font-medium text-white/60">
            {index + 1} / {images.length}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-4 w-4" />
      </button>

      {hasPrev ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : null}

      {hasNext ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      ) : null}

      {img?.id ? (
        <a
          href={String(img?.id || "").trim() ? `/api/attachments/${img.id}/download` : url}
          target="_blank"
          rel="noreferrer"
          download
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-5 right-5 flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/20"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </a>
      ) : null}
    </div>
  );
}

export function MessageBubble({
  message,
  direction = "inbound",
  attachments = [],
  outboundSenderName,
  translatedText = null,
  translationLoading = false,
  onRequestTranslation = null,
}) {
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [viewEmailOpen, setViewEmailOpen] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const isOutbound = direction === "outbound";

  const handleToggleTranslation = () => {
    if (!showTranslation && !translatedText) {
      onRequestTranslation?.();
    }
    setShowTranslation((prev) => !prev);
  };

  const normalizedOutboundSenderName = String(outboundSenderName || "").trim().toLowerCase();
  const messageSenderLabel = getSenderLabel(message);
  const normalizedMessageSender = String(messageSenderLabel || "").trim().toLowerCase();
  const isAuthoredByCurrentUser =
    isOutbound &&
    Boolean(normalizedOutboundSenderName) &&
    normalizedMessageSender === normalizedOutboundSenderName;
  const senderLabel =
    messageSenderLabel && !/^unknown sender$/i.test(String(messageSenderLabel || ""))
      ? messageSenderLabel
      : outboundSenderName || messageSenderLabel;
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
      timeZone: DISPLAY_TIMEZONE,
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
  const canPreviewImage = isImageAttachment(selectedAttachment) && Boolean(getAttachmentInlineSrc(selectedAttachment));
  const canPreviewPdf = isPdfAttachment(selectedAttachment?.mime_type);
  const canDownload = Boolean(selectedAttachment?.storage_path);
  const attachmentCards = (attachments || []).filter((attachment) => Boolean(getAttachmentInlineSrc(attachment) || attachment?.id));
  const inlineBodyImageIds = useMemo(() => collectInlineAttachmentIds(safeBodyHtml), [safeBodyHtml]);
  const inlineImageAttachments = useMemo(
    () => attachmentCards.filter((a) => isImageAttachment(a) && inlineBodyImageIds.has(String(a?.id || ""))),
    [attachmentCards, inlineBodyImageIds]
  );
  const inlineSrcToAttachment = useMemo(() => {
    const map = new Map();
    for (const a of inlineImageAttachments) {
      const src = getAttachmentInlineSrc(a);
      if (src) map.set(src, a);
    }
    return map;
  }, [inlineImageAttachments]);
  const imageAttachments = attachmentCards.filter((a) => isImageAttachment(a) && Boolean(getAttachmentInlineSrc(a)) && !inlineBodyImageIds.has(String(a?.id || "")));
  const fileAttachments = attachmentCards.filter((a) => !isImageAttachment(a));
  const lightboxImages = useMemo(() => [...inlineImageAttachments, ...imageAttachments], [inlineImageAttachments, imageAttachments]);
  const lightboxIndex = lightboxImages.findIndex((a) => a?.id === selectedAttachment?.id);
  const isLightboxOpen = Boolean(selectedAttachment) && canPreviewImage;

  const openLightbox = useCallback((attachment) => setSelectedAttachment(attachment), []);
  const closeLightbox = useCallback(() => setSelectedAttachment(null), []);
  const goNext = useCallback(() => {
    if (lightboxIndex < lightboxImages.length - 1) setSelectedAttachment(lightboxImages[lightboxIndex + 1]);
  }, [lightboxIndex, lightboxImages]);
  const goPrev = useCallback(() => {
    if (lightboxIndex > 0) setSelectedAttachment(lightboxImages[lightboxIndex - 1]);
  }, [lightboxIndex, lightboxImages]);

  useEffect(() => {
    if (!isLightboxOpen) return;
    const handler = (e) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLightboxOpen, goNext, goPrev, closeLightbox]);
  const subjectLine = String(message?.subject || "").trim() || "Email";
  const senderDetails = formatAddressLabel(senderDisplayName, senderEmail);
  const rawPlainBodyFull = stripQuotedHeaderTail(
    decodeHtmlEntities(message.body_text || message.snippet || "No preview available.")
  );
  const rawPlainBody = rawPlainBodyFull.replace(/\[cid:[^\]]+\]/gi, "").trim();
  const shouldFormatRawPlainBody =
    Boolean((quotedBodyText || "").trim()) || hasQuotedPlainText(rawPlainBody);
  const isStructuredForm = isStructuredFormMessage(message);
  const structuredFormText = isStructuredForm
    ? formatStructuredFormText(
        cleanBodyText || rawPlainBody || stripHtmlToText(message?.body_html || ""),
        subjectLine
      )
    : "";
  const formattedStructuredHtml = linkifyText(
    structuredFormText || cleanBodyText || rawPlainBody
  );
  const rawBodyForPlaceholderCheck = String(cleanBodyText || rawPlainBodyFull || "");
  const containsInlineImagePlaceholder =
    /\[[^\]]+\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)\]/i.test(rawBodyForPlaceholderCheck) ||
    /\[cid:[^\]]+\]/i.test(rawBodyForPlaceholderCheck);
  const bodyHtmlHasRenderableImage = /<img\b/i.test(String(safeBodyHtml || ""));
  const bodyHtmlHasLink = /<a\b/i.test(String(safeBodyHtml || ""));
  const cleanHtmlTextOnly = stripHtmlToText(safeCleanBodyHtml || "");
  const hasCleanHtmlContent = Boolean(String(cleanHtmlTextOnly || "").trim());
  const shouldPreferFullBodyPreview =
    !isStructuredForm &&
    !hasCleanHtmlContent &&
    (containsInlineImagePlaceholder || bodyHtmlHasRenderableImage || bodyHtmlHasLink);
  const previewBodyHtml = shouldPreferFullBodyPreview ? safeBodyHtml : safeCleanBodyHtml;
  const previewHtml = isStructuredForm
    ? formattedStructuredHtml
    : previewBodyHtml
    ? previewBodyHtml
    : linkifyText(
        isStructuredForm
          ? structuredFormText || cleanBodyText || rawPlainBody
          : cleanBodyText || rawPlainBody
      );
  const modalHtml = isStructuredForm
    ? formattedStructuredHtml
    : safeBodyHtml;
  const shouldShowBcc = isOutbound && bccList.length > 0;

  return (
    <>
      <div className={cn("animate-in fade-in slide-in-from-bottom-1 duration-200 group/bubble w-full", isOutbound ? "flex justify-end" : "flex justify-start")}>
        <div className={cn("w-full max-w-full sm:max-w-[560px] lg:max-w-[620px]")}>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <div className="text-[13px] font-semibold text-foreground">
                {senderDisplayName}{" "}
                <span className="text-[12px] font-normal text-muted-foreground">
                  {timestamp}
                </span>
              </div>
              {isDraft ? (
                <span className="rounded-full border border-blue-200 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[12px] font-medium text-blue-700 dark:text-blue-300">
                  Draft
                </span>
              ) : null}
            </div>

            <div
              className={cn(
                "overflow-hidden rounded-xl border text-xs",
                isInternalNote
                  ? "border-yellow-200 bg-yellow-50 dark:border-yellow-300/40 dark:bg-yellow-500/10"
                  : isOutbound
                  ? "border-violet-200 bg-violet-50/55 dark:border-violet-400/30 dark:bg-violet-500/10"
                  : "border-border bg-card"
              )}
            >
              <div
                className={cn("px-4 py-3 text-[14px] leading-[1.55] text-foreground", isOutbound && "text-[14px]")}
                onClick={(e) => {
                  if (e.target.tagName !== "IMG") return;
                  const src = e.target.getAttribute("src");
                  const attachment = src ? inlineSrcToAttachment.get(src) : null;
                  if (attachment) openLightbox(attachment);
                }}
              >
                {!isStructuredForm && previewBodyHtml ? (
                  <div
                    className={EMAIL_BODY_CLASS}
                    dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
                  />
                ) : (
                  <div
                    className={EMAIL_BODY_CLASS}
                    dangerouslySetInnerHTML={{
                      __html: previewHtml,
                    }}
                  />
                )}
              </div>

            </div>

            {imageAttachments.length ? (
              <ImageGrid images={imageAttachments} onOpen={openLightbox} />
            ) : null}

            {fileAttachments.length ? (
              <div className="rounded-xl border border-border bg-card px-4 pb-3 pt-2">
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Files</p>
                <div className="flex flex-wrap gap-1.5">
                  {fileAttachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => setSelectedAttachment(attachment)}
                      className="group/file flex w-[240px] items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors group-hover/file:bg-muted/80">
                        {String(attachment?.mime_type || "").includes("pdf") ? "PDF" : "File"}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-foreground">
                          {attachment?.filename || "Attachment"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {attachment?.size_bytes ? formatBytes(attachment.size_bytes) : attachment?.mime_type || "Unknown"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!isOutbound && showTranslation && (
              <div className="rounded-xl border border-border bg-muted px-4 py-3">
                {translationLoading ? (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground/80" />
                    Translating…
                  </div>
                ) : translatedText ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                    {translatedText}
                  </p>
                ) : (
                  <p className="text-[12px] text-muted-foreground">Translation not available.</p>
                )}
              </div>
            )}

            {!isInternalNote ? (
              <div className="flex flex-wrap items-center gap-3 px-1 text-sm font-medium text-muted-foreground">
                <button
                  type="button"
                  onClick={() => setViewEmailOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] opacity-0 transition-opacity hover:bg-muted group-hover/bubble:opacity-100"
                >
                  <Mail className="h-3.5 w-3.5" />
                  <span>View email</span>
                </button>
                {!isOutbound && (
                  <button
                    type="button"
                    onClick={handleToggleTranslation}
                    className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] opacity-0 transition-opacity hover:bg-muted group-hover/bubble:opacity-100"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>{showTranslation ? "Hide translation" : "Show translation"}</span>
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <Dialog open={viewEmailOpen} onOpenChange={setViewEmailOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="pr-8 text-base">{subjectLine}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto bg-card px-5 py-4">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">From</span>
                <span className="text-[13px] text-foreground">{senderDetails}</span>
              </div>
              {toList.length ? (
                <div className="flex flex-wrap gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">To</span>
                  <span className="text-[13px] text-foreground">{toList.join(", ")}</span>
                </div>
              ) : null}
              {ccList.length ? (
                <div className="flex flex-wrap gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Cc</span>
                  <span className="text-[13px] text-foreground">{ccList.join(", ")}</span>
                </div>
              ) : null}
              {shouldShowBcc ? (
                <div className="flex flex-wrap gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Bcc</span>
                  <span className="text-[13px] text-foreground">{bccList.join(", ")}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Date</span>
                <span className="text-[13px] text-foreground">{timestamp || "-"}</span>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
              {modalHtml ? (
                <div
                  className={EMAIL_BODY_CLASS}
                  dangerouslySetInnerHTML={{ __html: modalHtml }}
                />
              ) : (
                <div
                  className={cn(
                    EMAIL_BODY_CLASS,
                    shouldFormatRawPlainBody &&
                      "text-[14px] leading-6 text-foreground [&_*]:text-[14px] [&_*]:leading-6"
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
      {isLightboxOpen ? createPortal(
        <ImageLightbox
          images={lightboxImages}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNext={goNext}
          onPrev={goPrev}
        />,
        document.body
      ) : null}

      <Dialog open={Boolean(selectedAttachment) && !canPreviewImage} onOpenChange={(open) => !open && setSelectedAttachment(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="pr-8 text-base">
              {selectedAttachment?.filename || "Attachment"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto bg-muted p-4">
            {canPreviewPdf && canDownload ? (
              <iframe
                title={selectedAttachment?.filename || "Attachment preview"}
                src={selectedAttachmentUrl}
                className="h-[60vh] w-full rounded border border-border bg-card"
              />
            ) : (
              <div className="rounded border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                {canDownload ? "Preview is not available for this file type." : "File content is currently unavailable."}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <div className="text-xs text-muted-foreground">
              {selectedAttachment?.mime_type || "Unknown type"}
              {selectedAttachment?.size_bytes ? ` • ${formatBytes(selectedAttachment.size_bytes)}` : ""}
            </div>
            {canDownload ? (
              <div className="flex items-center gap-2">
                <a
                  href={selectedAttachmentInlineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Open in new tab
                </a>
                <a
                  href={selectedAttachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
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
