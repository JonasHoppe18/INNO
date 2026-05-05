import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  X,
  Loader2,
  Maximize2,
  Paperclip,
  Send,
  Zap,
  Globe,
  Sparkles,
  CornerDownLeft,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SUPPORTED_SUPPORT_LANGUAGE_CODES,
  SUPPORT_LANGUAGE_LABELS,
} from "@/lib/translation/languages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const escapeHtml = (input = "") =>
  String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const linkifyHtml = (html = "") =>
  String(html || "").replace(/https?:\/\/[^\s<]+/gi, (rawUrl) => {
    const match = String(rawUrl).match(/^(.*?)([)\].,!?;:]*)$/);
    const url = match?.[1] || rawUrl;
    const trailing = match?.[2] || "";
    return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${trailing}`;
  });

const formatMarkdownBold = (html = "") =>
  String(html || "").replace(/\*\*([^*\n][\s\S]*?)\*\*/g, "<strong>$1</strong>");

const plainTextToReplyHtml = (text = "") =>
  formatMarkdownBold(linkifyHtml(escapeHtml(String(text || "").replace(/\r\n/g, "\n")))).replace(
    /\n/g,
    "<br/>"
  );

const extractPlainTextFromReplyHtml = (html = "") => {
  if (typeof document === "undefined") return String(html || "");
  const div = document.createElement("div");
  div.innerHTML = String(html || "");

  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "LI",
    "UL",
    "OL",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "MAIN",
    "TABLE",
    "TR",
  ]);

  const chunks = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(String(node.nodeValue || ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "BR") {
      chunks.push("\n");
      return;
    }
    if (tag === "LI") chunks.push("- ");
    for (const child of Array.from(el.childNodes || [])) walk(child);
    if (BLOCK_TAGS.has(tag)) chunks.push("\n");
  };

  for (const child of Array.from(div.childNodes || [])) walk(child);

  return chunks
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const hasHtmlTag = (value = "") => /<[^>]+>/.test(String(value || ""));

const normalizeSavedReplyImageDeliveryMode = (value = "") =>
  String(value || "").trim().toLowerCase() === "inline" ? "inline" : "attachment";

const normalizeContentId = (value = "", fallback = "") => {
  const cleaned = String(value || fallback || "")
    .trim()
    .replace(/^cid:/i, "")
    .replace(/[^A-Za-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || null;
};

const normalizeDimension = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(1, Math.min(2400, Math.round(num)));
};

const parseCidMarker = (raw = "") => {
  const source = String(raw || "").trim();
  if (!source) return { contentId: null, width: null, height: null };
  const [rawId = "", ...rest] = source.split("|");
  const contentId = normalizeContentId(rawId);
  let width = null;
  let height = null;
  rest.forEach((segment) => {
    const [rawKey = "", rawValue = ""] = String(segment || "").split(":", 2);
    const key = String(rawKey || "").trim().toLowerCase();
    const value = normalizeDimension(rawValue);
    if (!value) return;
    if (key === "w") width = value;
    if (key === "h") height = value;
  });
  return { contentId, width, height };
};

const buildCidMarker = (contentId = "", width = null, height = null) => {
  const normalizedId = normalizeContentId(contentId);
  if (!normalizedId) return "";
  const parts = [normalizedId];
  const safeWidth = normalizeDimension(width);
  const safeHeight = normalizeDimension(height);
  if (safeWidth) parts.push(`w:${safeWidth}`);
  if (safeHeight) parts.push(`h:${safeHeight}`);
  return `[cid:${parts.join("|")}]`;
};

const extractImageContentIdFromTag = (tagHtml = "") => {
  const raw = String(tagHtml || "");
  const dataContentIdMatch = raw.match(
    /\sdata-content-id\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
  );
  const dataContentIdRaw =
    dataContentIdMatch?.[2] || dataContentIdMatch?.[3] || dataContentIdMatch?.[4] || "";
  const normalizedDataContentId = normalizeContentId(dataContentIdRaw);
  if (normalizedDataContentId) return normalizedDataContentId;

  const srcMatch = raw.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const srcRaw = srcMatch?.[2] || srcMatch?.[3] || srcMatch?.[4] || "";
  const cidMatch = String(srcRaw || "").match(/^cid:(.+)$/i);
  return cidMatch ? normalizeContentId(cidMatch[1]) : null;
};

const extractImageDimensionsFromTag = (tagHtml = "") => {
  const raw = String(tagHtml || "");
  const widthMatch = raw.match(/\swidth\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const widthRaw = widthMatch?.[2] || widthMatch?.[3] || widthMatch?.[4] || "";
  const heightMatch = raw.match(/\sheight\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const heightRaw = heightMatch?.[2] || heightMatch?.[3] || heightMatch?.[4] || "";
  return {
    width: normalizeDimension(widthRaw),
    height: normalizeDimension(heightRaw),
  };
};

const replaceInlineImageTagsWithMarkers = (html = "") =>
  String(html || "").replace(/<img\b[^>]*>/gi, (imgTag) => {
    const contentId = extractImageContentIdFromTag(imgTag);
    if (!contentId) return "";
    const { width, height } = extractImageDimensionsFromTag(imgTag);
    const marker = buildCidMarker(contentId, width, height);
    return marker ? `\n${marker}\n` : "";
  });

const buildInlineImagePreviewMap = (attachments = []) => {
  const map = new Map();
  for (const attachment of attachments || []) {
    const isInline =
      attachment?.__innoInline === true ||
      String(attachment?.__innoDeliveryMode || "").trim().toLowerCase() === "inline";
    if (!isInline) continue;
    const contentId = normalizeContentId(attachment?.__innoContentId || "");
    const mimeType = String(attachment?.type || attachment?.__innoMimeType || "").trim();
    const base64 = String(attachment?.__innoContentBase64 || "").trim();
    if (!contentId || !mimeType || !base64) continue;
    map.set(contentId, { mimeType, base64 });
  }
  return map;
};

const plainTextToReplyHtmlWithInlineImages = (text = "", attachments = []) => {
  const previewMap = buildInlineImagePreviewMap(attachments);
  return plainTextToReplyHtml(text).replace(/\[cid:([^\]]+)\]/gi, (fullMatch, rawCid = "") => {
    const { contentId, width, height } = parseCidMarker(rawCid);
    if (!contentId) return fullMatch;
    const preview = previewMap.get(contentId);
    if (!preview) return fullMatch;
    const widthAttr = width ? ` width="${width}"` : "";
    const heightAttr = height ? ` height="${height}"` : "";
    return `<img src="data:${preview.mimeType};base64,${preview.base64}" data-content-id="${contentId}" alt="Inline image"${widthAttr}${heightAttr} style="max-width:100%;height:auto;display:block;margin:8px 0;border-radius:8px;">`;
  });
};

const savedReplyHtmlToComposerText = (value = "", allowedInlineContentIds = null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withInlineMarkers = raw.replace(
    /<img\b[^>]*\bsrc=(['"])cid:([^'"]+)\1[^>]*>/gi,
    (match, _quote, rawCid = "") => {
      const cid = normalizeContentId(rawCid);
      const shouldKeepInline =
        cid &&
        (!allowedInlineContentIds ||
          allowedInlineContentIds.size === 0 ||
          allowedInlineContentIds.has(cid));
      if (!shouldKeepInline) return "\n";
      const { width, height } = extractImageDimensionsFromTag(match);
      const marker = buildCidMarker(cid, width, height);
      return marker ? `\n${marker}\n` : "\n";
    }
  );
  return extractPlainTextFromReplyHtml(withInlineMarkers);
};

const normalizeSavedReplyToPlainText = (value = "", allowedInlineContentIds = null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (hasHtmlTag(raw)) {
    return savedReplyHtmlToComposerText(raw, allowedInlineContentIds);
  }
  return raw;
};

const fileFromSavedReplyImage = (image) => {
  if (!image || typeof image !== "object") return null;
  const mimeType = String(image?.mime_type || image?.mimeType || "").toLowerCase();
  const contentBase64 = String(image?.content_base64 || image?.contentBase64 || "").trim();
  if (!mimeType.startsWith("image/") || !contentBase64) return null;
  if (typeof atob !== "function") return null;
  try {
    const binary = atob(contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const filename = String(image?.filename || "saved-reply-image");
    const file = new File([bytes], filename, { type: mimeType, lastModified: Date.now() });
    const deliveryMode = normalizeSavedReplyImageDeliveryMode(
      image?.delivery_mode || image?.deliveryMode
    );
    const contentId = normalizeContentId(image?.content_id || image?.contentId, filename);
    file.__innoDeliveryMode = deliveryMode;
    file.__innoInline = deliveryMode === "inline";
    file.__innoContentId = contentId;
    file.__innoContentBase64 = contentBase64;
    file.__innoMimeType = mimeType;
    return file;
  } catch {
    return null;
  }
};

const filesFromSavedReplyImages = (reply) => {
  const source = Array.isArray(reply?.images)
    ? reply.images
    : reply?.image
      ? [reply.image]
      : [];
  return source.map((image) => fileFromSavedReplyImage(image)).filter(Boolean);
};

const getSavedReplyInlineContentIdSet = (reply) => {
  const source = Array.isArray(reply?.images)
    ? reply.images
    : reply?.image
      ? [reply.image]
      : [];
  return new Set(
    source
      .filter(
        (image) =>
          normalizeSavedReplyImageDeliveryMode(image?.delivery_mode || image?.deliveryMode) ===
          "inline"
      )
      .map((image) => normalizeContentId(image?.content_id || image?.contentId))
      .filter(Boolean)
  );
};

export function Composer({
  value,
  onChange,
  draftLoaded = false,
  canSend = false,
  onSend,
  isSending = false,
  mode,
  onModeChange,
  toLabel,
  mentionUsers = [],
  onBlur,
  collapsed = false,
  onToggleCollapse,
  disabled = false,
  disabledPlaceholder = "Waiting for action approval...",
  isDraftLoading = false,
  onGenerateDraft = null,
  isGeneratingDraft = false,
  detectedLanguage = null,
  onReplyLanguageChange = null,
  onRefineDraft = null,
  isRefiningDraft = false,
}) {
  const [replyLanguage, setReplyLanguage] = useState(detectedLanguage || null);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    if (detectedLanguage) setReplyLanguage(detectedLanguage);
  }, [detectedLanguage]);

  const MIN_COMPOSER_HEIGHT_PX = 170;
  const MAX_COMPOSER_VIEWPORT_RATIO = 0.8;
  const isNote = mode === "note";
  const isForward = mode === "forward";
  const showDraftLoadingState = !isNote && (isDraftLoading || isRefiningDraft);

  const handleRefineSubmit = async () => {
    const prompt = refinePrompt.trim();
    if (!prompt || !onRefineDraft) return;
    setRefineError("");
    setRefineOpen(false);
    setRefinePrompt("");
    await onRefineDraft(prompt);
  };
  const replyEditorMinHeightClassName = "min-h-[72px]";
  const editorBodyMinHeightClassName = isNote ? "min-h-[96px]" : "min-h-[112px]";
  const initialTo = useMemo(() => {
    if (isForward) return [];
    if (!toLabel) return [];
    const match = String(toLabel).match(/<([^>]+)>/);
    const email = match?.[1] ? match[1].trim() : String(toLabel).trim();
    return email ? [email] : [];
  }, [isForward, toLabel]);
  const [toRecipients, setToRecipients] = useState(initialTo);
  const [ccRecipients, setCcRecipients] = useState([]);
  const [bccRecipients, setBccRecipients] = useState([]);
  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const textareaRef = useRef(null);
  const replyEditorRef = useRef(null);
  const replyInlineImageResizeStateRef = useRef(null);
  const syncingReplyHtmlRef = useRef(false);
  const replyEditorFocusedRef = useRef(false);
  const noteCaretIndexRef = useRef(null);
  const replyCaretIndexRef = useRef(null);
  const fileInputRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [selectedMentionIds, setSelectedMentionIds] = useState([]);
  const [mentionState, setMentionState] = useState({
    open: false,
    query: "",
    start: -1,
    end: -1,
    activeIndex: 0,
  });
  const [mentionPopupPosition, setMentionPopupPosition] = useState({
    left: 12,
    top: 24,
    placement: "up",
  });
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [savedRepliesLoading, setSavedRepliesLoading] = useState(false);
  const [savedReplies, setSavedReplies] = useState([]);
  const [savedRepliesQuery, setSavedRepliesQuery] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refineError, setRefineError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [composerHeightPx, setComposerHeightPx] = useState(MIN_COMPOSER_HEIGHT_PX);
  const composerContainerRef = useRef(null);
  const resizeStateRef = useRef(null);
  const manualComposerResizeRef = useRef(false);
  const mentionCandidates = useMemo(() => {
    const base = Array.isArray(mentionUsers) ? mentionUsers : [];
    const query = String(mentionState.query || "").trim().toLowerCase();
    const list = !query
      ? base
      : base.filter((user) => {
          const label = String(user?.label || "").toLowerCase();
          const email = String(user?.email || "").toLowerCase();
          return label.includes(query) || email.includes(query);
        });
    return list.slice(0, 8);
  }, [mentionState.query, mentionUsers]);
  const filteredSavedReplies = useMemo(() => {
    const rows = Array.isArray(savedReplies) ? savedReplies : [];
    // Sort by use_count descending so most-used appear first
    const sorted = [...rows].sort((a, b) => (b.use_count || 0) - (a.use_count || 0));
    const query = String(savedRepliesQuery || "").trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((reply) => {
      const title = String(reply?.title || "").toLowerCase();
      const category = String(reply?.category || "").toLowerCase();
      const content = normalizeSavedReplyToPlainText(reply?.content || "").toLowerCase();
      return title.includes(query) || category.includes(query) || content.includes(query);
    });
  }, [savedReplies, savedRepliesQuery]);
  const visibleAttachmentPills = useMemo(
    () =>
      (attachments || []).filter(
        (file) => !(file?.__innoDeliveryMode === "inline" || file?.__innoInline === true)
      ),
    [attachments]
  );

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const minHeight = 56;
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  };

  useEffect(() => {
    setToRecipients(initialTo);
    setCcRecipients([]);
    setBccRecipients([]);
    setShowCC(false);
    setShowBCC(false);
    setToInput("");
    setCcInput("");
    setBccInput("");
    setAttachments([]);
  }, [initialTo]);

  useEffect(() => {
    if (collapsed) {
      // If the composer is hidden while the contentEditable is active,
      // clear focus state so value hydration works when reopening.
      replyEditorFocusedRef.current = false;
      // Re-open with auto-calculated height based on current text content.
      manualComposerResizeRef.current = false;
      return;
    }
    if (isNote) {
      resizeTextarea();
      return;
    }
    if (isDraftLoading) {
      if (replyEditorRef.current) {
        replyEditorRef.current.innerHTML = "";
      }
      return;
    }
    // While user is actively editing, avoid forcing innerHTML from external state.
    // Doing so resets caret/focus and makes typing/backspace feel broken.
    if (replyEditorFocusedRef.current) return;
    if (syncingReplyHtmlRef.current) return;
    const nextHtml = plainTextToReplyHtmlWithInlineImages(value || "", attachments);
    if (replyEditorRef.current && replyEditorRef.current.innerHTML !== nextHtml) {
      replyEditorRef.current.innerHTML = nextHtml;
    }
  }, [attachments, collapsed, isDraftLoading, isNote, value]);

  useEffect(() => {
    if (!isSending && !String(value || "").trim()) {
      setAttachments([]);
    }
  }, [isSending, value]);

  useEffect(() => {
    if (!isNote) {
      setMentionState({ open: false, query: "", start: -1, end: -1, activeIndex: 0 });
      setSelectedMentionIds([]);
    }
    if (isNote) {
      setAttachments([]);
    }
  }, [isNote]);

  useEffect(() => {
    if (!savedRepliesOpen || isNote) return;
    let active = true;
    const loadSavedReplies = async () => {
      setSavedRepliesLoading(true);
      try {
        const response = await fetch("/api/settings/saved-replies?active_only=1", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load saved replies.");
        }
        setSavedReplies(Array.isArray(payload?.replies) ? payload.replies : []);
      } catch {
        if (!active) return;
        setSavedReplies([]);
      } finally {
        if (active) setSavedRepliesLoading(false);
      }
    };
    loadSavedReplies();
    return () => {
      active = false;
    };
  }, [isNote, savedRepliesOpen]);

  useEffect(() => {
    if (!isNote) return;
    if (!String(value || "").trim()) {
      setSelectedMentionIds([]);
    }
  }, [isNote, value]);

  useEffect(() => {
    if (isDraftLoading || isRefiningDraft) {
      setRefineOpen(false);
      setRefinePrompt("");
    }
  }, [isDraftLoading, isRefiningDraft]);

  const addRecipient = (valueToAdd, setter, inputSetter) => {
    const trimmed = valueToAdd.trim();
    if (!trimmed) return;
    setter((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    inputSetter("");
  };

  const onRecipientKey = (event, value, setter, inputSetter) => {
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      addRecipient(value, setter, inputSetter);
    }
  };

  const removeRecipient = (valueToRemove, setter) => {
    setter((prev) => prev.filter((item) => item !== valueToRemove));
  };

  const buildRecipients = (existing, pendingValue) => {
    const next = [...existing];
    const pending = String(pendingValue || "").trim();
    if (pending && !next.includes(pending)) next.push(pending);
    return next;
  };

  const handleLanguageChange = async (lang) => {
    setLanguagePickerOpen(false);
    if (lang === replyLanguage) return;
    setReplyLanguage(lang);
    onReplyLanguageChange?.(lang);
    const draftText = String(value || "").trim();
    if (!draftText) return;
    setIsTranslating(true);
    try {
      const res = await fetch("/api/translate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draftText, targetLanguage: lang }),
      });
      if (res.ok) {
        const { translatedText } = await res.json();
        if (translatedText) onChange?.(translatedText);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleAddAttachments = (event) => {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;
    setAttachments((prev) => {
      const next = [...prev];
      files.forEach((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!next.some((item) => `${item.name}:${item.size}:${item.lastModified}` === key)) {
          next.push(file);
        }
      });
      return next;
    });
    if (event?.target) {
      event.target.value = "";
    }
  };

  const removeAttachment = (targetFile) => {
    setAttachments((prev) =>
      prev.filter(
        (file) =>
          !(
            file.name === targetFile.name &&
            file.size === targetFile.size &&
            file.lastModified === targetFile.lastModified
          )
      )
    );
  };

  const handleDragOver = (event) => {
    if (isNote || disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDragLeave = (event) => {
    if (!composerContainerRef.current?.contains(event.relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);
    if (isNote || disabled) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    setAttachments((prev) => {
      const next = [...prev];
      files.forEach((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!next.some((item) => `${item.name}:${item.size}:${item.lastModified}` === key)) {
          next.push(file);
        }
      });
      return next;
    });
  };

  const getMentionContext = (text, caret) => {
    const source = String(text || "");
    const position = Number.isFinite(caret) ? caret : source.length;
    const before = source.slice(0, position);
    const atIndex = before.lastIndexOf("@");
    if (atIndex < 0) return null;
    const charBeforeAt = atIndex > 0 ? before[atIndex - 1] : "";
    if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;
    const query = before.slice(atIndex + 1);
    if (/[\s\n]/.test(query)) return null;
    return {
      start: atIndex,
      end: position,
      query,
    };
  };

  const measureCaretPosition = (textarea, caretIndex) => {
    if (!textarea || typeof window === "undefined" || typeof document === "undefined") return null;
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    mirror.style.position = "fixed";
    mirror.style.top = "0";
    mirror.style.left = "0";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflowWrap = "break-word";
    mirror.style.boxSizing = "border-box";
    mirror.style.font = computed.font;
    mirror.style.fontSize = computed.fontSize;
    mirror.style.fontFamily = computed.fontFamily;
    mirror.style.fontWeight = computed.fontWeight;
    mirror.style.letterSpacing = computed.letterSpacing;
    mirror.style.lineHeight = computed.lineHeight;
    mirror.style.padding = computed.padding;
    mirror.style.border = computed.border;
    mirror.style.width = `${textarea.clientWidth}px`;

    const safeCaret = Math.max(0, Math.min(caretIndex, String(textarea.value || "").length));
    mirror.textContent = String(textarea.value || "").slice(0, safeCaret);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const textareaRect = textarea.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const result = {
      left: markerRect.left - textareaRect.left,
      top: markerRect.top - textareaRect.top,
    };

    document.body.removeChild(mirror);
    return result;
  };

  const updateMentionStateFromInput = (nextValue, caret, textareaEl = textareaRef.current) => {
    if (!isNote) return;
    const context = getMentionContext(nextValue, caret);
    if (!context) {
      setMentionState((prev) => ({ ...prev, open: false, query: "", start: -1, end: -1 }));
      return;
    }
    const caretPosition = measureCaretPosition(textareaEl, context.end);
    if (caretPosition && textareaEl) {
      const estimatedPopupWidth = 320;
      const estimatedPopupHeight = 120;
      const horizontalPadding = 12;
      const maxLeft = Math.max(horizontalPadding, textareaEl.clientWidth - estimatedPopupWidth - horizontalPadding);
      const clampedLeft = Math.min(Math.max(caretPosition.left + horizontalPadding, horizontalPadding), maxLeft);
      const canPlaceAbove = caretPosition.top > estimatedPopupHeight - 36;
      const placement = canPlaceAbove ? "up" : "down";
      setMentionPopupPosition({
        left: clampedLeft,
        top: Math.max(18, caretPosition.top + 8),
        placement,
      });
    }
    setMentionState((prev) => ({
      ...prev,
      open: true,
      query: context.query,
      start: context.start,
      end: context.end,
      activeIndex: 0,
    }));
  };

  const insertMention = (user) => {
    if (!user || mentionState.start < 0 || mentionState.end < 0) return;
    const label = String(user.label || user.email || "").trim();
    if (!label) return;
    const before = String(value || "").slice(0, mentionState.start);
    const after = String(value || "").slice(mentionState.end);
    const nextValue = `${before}@${label} ${after}`;
    onChange(nextValue);
    setMentionState({ open: false, query: "", start: -1, end: -1, activeIndex: 0 });
    if (user.id) {
      setSelectedMentionIds((prev) => (prev.includes(user.id) ? prev : [...prev, user.id]));
    }
    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input) return;
      const nextCaret = `${before}@${label} `.length;
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const trackSavedReplyUse = (reply) => {
    if (!reply?.id) return;
    fetch("/api/settings/saved-replies", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reply.id }),
    }).catch(() => {});
    // Optimistically update local count so sort updates immediately next open
    setSavedReplies((prev) =>
      prev.map((r) => r.id === reply.id ? { ...r, use_count: (r.use_count || 0) + 1 } : r)
    );
  };

  const addSavedReplyImagesToAttachments = (reply) => {
    const imageFiles = filesFromSavedReplyImages(reply);
    if (!imageFiles.length) return;
    setAttachments((prev) => {
      const next = [...prev];
      imageFiles.forEach((imageFile) => {
        const mode = String(imageFile.__innoDeliveryMode || "attachment");
        const cid = String(imageFile.__innoContentId || "");
        const key = `${imageFile.name}:${imageFile.size}:${imageFile.type}:${mode}:${cid}`;
        if (
          !next.some((item) => {
            const existingMode = String(item?.__innoDeliveryMode || "attachment");
            const existingCid = String(item?.__innoContentId || "");
            return `${item.name}:${item.size}:${item.type}:${existingMode}:${existingCid}` === key;
          })
        ) {
          next.push(imageFile);
        }
      });
      return next;
    });
  };

  const applySavedReplyReplace = (reply) => {
    const inlineContentIds = getSavedReplyInlineContentIdSet(reply);
    const content = normalizeSavedReplyToPlainText(reply?.content || "", inlineContentIds);
    if (!content) return;
    const current = String(value || "");
    const hasCurrentText = Boolean(current.trim());
    const sameContent = current.trim() === content;
    if (hasCurrentText && !sameContent) {
      const confirmed = window.confirm("Replace current draft with this saved reply?");
      if (!confirmed) return;
    }
    trackSavedReplyUse(reply);
    onChange(content);
    addSavedReplyImagesToAttachments(reply);
    setSavedRepliesOpen(false);
  };

  const applySavedReplyInsert = (reply) => {
    const inlineContentIds = getSavedReplyInlineContentIdSet(reply);
    const content = normalizeSavedReplyToPlainText(reply?.content || "", inlineContentIds);
    if (!content) return;
    trackSavedReplyUse(reply);
    const current = String(value || "");
    let caretIndex = null;
    if (isNote) {
      const input = textareaRef.current;
      if (input && typeof input.selectionStart === "number") {
        caretIndex = input.selectionStart;
      } else if (typeof noteCaretIndexRef.current === "number") {
        caretIndex = noteCaretIndexRef.current;
      }
    } else if (typeof replyCaretIndexRef.current === "number") {
      caretIndex = replyCaretIndexRef.current;
    }

    const hasExplicitCaret = typeof caretIndex === "number" && Number.isFinite(caretIndex);
    const safeCaret = hasExplicitCaret
      ? Math.max(0, Math.min(Number(caretIndex), current.length))
      : current.length;
    const nextValue = hasExplicitCaret
      ? `${current.slice(0, safeCaret)}${content}${current.slice(safeCaret)}`
      : current.trim()
        ? `${current.replace(/\s+$/, "")}\n\n${content}`
        : content;
    onChange(nextValue);
    addSavedReplyImagesToAttachments(reply);
    setSavedRepliesOpen(false);
    if (isNote) {
      requestAnimationFrame(() => {
        const input = textareaRef.current;
        if (!input) return;
        const nextCaret = safeCaret + content.length;
        input.focus();
        input.setSelectionRange(nextCaret, nextCaret);
      });
    }
  };

  const normalizeMentionKey = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "")
      .trim();

  const resolveMentionIdsFromText = (text) => {
    const source = String(text || "");
    if (!source) return [];
    const candidates = Array.isArray(mentionUsers) ? mentionUsers : [];
    if (!candidates.length) return [];
    const matches = Array.from(source.matchAll(/@([^\s@]+)/g)).map((hit) => normalizeMentionKey(hit?.[1]));
    if (!matches.length) return [];

    const resolved = new Set();
    matches.forEach((token) => {
      if (!token) return;
      candidates.forEach((candidate) => {
        const id = String(candidate?.id || "").trim();
        if (!id) return;
        const label = normalizeMentionKey(candidate?.label);
        const email = String(candidate?.email || "").trim().toLowerCase();
        const emailLocal = normalizeMentionKey(email.split("@")[0]);
        if (
          token === label ||
          token === emailLocal ||
          (label && label.startsWith(token)) ||
          (emailLocal && emailLocal.startsWith(token))
        ) {
          resolved.add(id);
        }
      });
    });
    return Array.from(resolved);
  };

  const handleReplyEditorInput = (event) => {
    const html = String(event?.currentTarget?.innerHTML || "");
    const htmlWithMarkers = replaceInlineImageTagsWithMarkers(html);
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (replyEditorRef.current?.contains(range.startContainer)) {
        const beforeRange = range.cloneRange();
        beforeRange.selectNodeContents(replyEditorRef.current);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        replyCaretIndexRef.current = String(beforeRange.toString() || "").replace(/\r\n/g, "\n").length;
      }
    }
    syncingReplyHtmlRef.current = true;
    onChange(extractPlainTextFromReplyHtml(htmlWithMarkers));
    syncingReplyHtmlRef.current = false;
  };

  const getReplyInlineResizeTarget = (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLImageElement)) return null;
    const rect = target.getBoundingClientRect();
    const handleZonePx = 16;
    const inCorner =
      event.clientX >= rect.right - handleZonePx && event.clientY >= rect.bottom - handleZonePx;
    return inCorner ? target : null;
  };

  const handleReplyEditorMouseMove = (event) => {
    const editor = replyEditorRef.current;
    if (!editor) return;
    const target = getReplyInlineResizeTarget(event);
    editor.style.cursor = target ? "nwse-resize" : "";
  };

  const handleReplyEditorMouseLeave = () => {
    const editor = replyEditorRef.current;
    if (!editor) return;
    if (!replyInlineImageResizeStateRef.current) editor.style.cursor = "";
  };

  const handleReplyEditorMouseDown = (event) => {
    const img = getReplyInlineResizeTarget(event);
    if (!img) return;
    event.preventDefault();
    const editor = replyEditorRef.current;
    const startWidth =
      Number(img.getAttribute("width")) || Number(img.width) || Number(img.clientWidth) || 320;
    const startHeight =
      Number(img.getAttribute("height")) || Number(img.height) || Number(img.clientHeight) || 180;
    const ratio = startHeight > 0 ? startWidth / startHeight : 1;
    replyInlineImageResizeStateRef.current = {
      img,
      startX: Number(event.clientX || 0),
      startWidth,
      ratio,
    };
    if (editor) editor.style.cursor = "nwse-resize";

    const onMove = (moveEvent) => {
      const state = replyInlineImageResizeStateRef.current;
      if (!state?.img) return;
      const deltaX = Number(moveEvent.clientX || 0) - state.startX;
      const nextWidth = Math.max(80, Math.min(1400, Math.round(state.startWidth + deltaX)));
      const nextHeight = Math.max(40, Math.round(nextWidth / Math.max(state.ratio || 1, 0.1)));
      state.img.style.width = `${nextWidth}px`;
      state.img.style.height = "auto";
      state.img.setAttribute("width", String(nextWidth));
      state.img.setAttribute("height", String(nextHeight));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      replyInlineImageResizeStateRef.current = null;
      if (editor) editor.style.cursor = "";
      handleReplyEditorInput({ currentTarget: replyEditorRef.current });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleReplyEditorBlur = () => {
    replyEditorFocusedRef.current = false;
    onBlur?.();
  };

  const getAutoComposerHeightPx = useCallback(
    (textValue = "", measuredEditorHeight = null) => {
      const normalizedText = String(textValue || "")
        // Generated drafts can contain trailing blank lines; ignore them for height fitting.
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
      const lines = normalizedText
        .replace(/\r\n/g, "\n")
        .split("\n");
      const estimatedLineCount = lines.reduce(
        (sum, line) => sum + Math.max(1, Math.ceil(String(line || "").length / 110)),
        0
      );
      const editorLineHeight = 23;
      const minEditorHeight = isNote ? 62 : 72;
      const maxEditorHeight = 240;
      const estimatedEditorHeight = Math.min(
        maxEditorHeight,
        Math.max(minEditorHeight, estimatedLineCount * editorLineHeight + 20)
      );
      const effectiveEditorHeight =
        Number.isFinite(Number(measuredEditorHeight)) && Number(measuredEditorHeight) > 0
          ? Math.min(maxEditorHeight, Math.max(minEditorHeight, Number(measuredEditorHeight)))
          : estimatedEditorHeight;
      const chromeHeight = isNote ? 112 : 124;
      const maxHeight = Math.max(
        MIN_COMPOSER_HEIGHT_PX,
        Math.round((typeof window !== "undefined" ? window.innerHeight : 900) * MAX_COMPOSER_VIEWPORT_RATIO)
      );
      return Math.min(maxHeight, Math.max(MIN_COMPOSER_HEIGHT_PX, chromeHeight + effectiveEditorHeight));
    },
    [MAX_COMPOSER_VIEWPORT_RATIO, MIN_COMPOSER_HEIGHT_PX, isNote]
  );

  useEffect(() => {
    if (collapsed) return;
    if (manualComposerResizeRef.current) return;
    if (replyEditorFocusedRef.current) return;
    if (typeof document !== "undefined" && document.activeElement === textareaRef.current) return;
    const rafId = requestAnimationFrame(() => {
      const measuredEditorHeight = isNote
        ? Number(textareaRef.current?.scrollHeight || 0)
        : Number(replyEditorRef.current?.scrollHeight || 0);
      setComposerHeightPx(getAutoComposerHeightPx(value, measuredEditorHeight));
    });
    return () => cancelAnimationFrame(rafId);
  }, [collapsed, getAutoComposerHeightPx, isNote, showDraftLoadingState, value]);

  const onResizeMove = useCallback(
    (event) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const delta = Number(event?.clientY || 0) - state.startY;
      const maxHeight = Math.max(
        MIN_COMPOSER_HEIGHT_PX,
        Math.round((typeof window !== "undefined" ? window.innerHeight : 900) * MAX_COMPOSER_VIEWPORT_RATIO)
      );
      const next = Math.min(maxHeight, Math.max(MIN_COMPOSER_HEIGHT_PX, state.startHeight - delta));
      setComposerHeightPx(next);
    },
    [MAX_COMPOSER_VIEWPORT_RATIO, MIN_COMPOSER_HEIGHT_PX]
  );

  const stopResize = useCallback(() => {
    resizeStateRef.current = null;
    if (typeof window === "undefined") return;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", stopResize);
  }, [onResizeMove]);

  const startResize = useCallback((event) => {
    event.preventDefault();
    const container = composerContainerRef.current;
    if (!container || typeof window === "undefined") return;
    manualComposerResizeRef.current = true;
    const rect = container.getBoundingClientRect();
    resizeStateRef.current = {
      startY: Number(event?.clientY || 0),
      startHeight: Math.round(rect.height),
    };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", stopResize);
  }, [onResizeMove, stopResize]);

  useEffect(() => () => stopResize(), [stopResize]);

  if (collapsed) {
    return (
      <div className="flex-none border-t border-border bg-background px-4 py-2">
        <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2">
          <span className="text-[12px] font-medium text-muted-foreground">Reply box hidden</span>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-none bg-transparent px-3 py-1.5">
      <style>{`
        @keyframes refine-slide-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes attachment-pill-in {
          from { opacity: 0; transform: scale(0.95) translateY(2px); }
          to   { opacity: 1; transform: scale(1) translateY(0);       }
        }
      `}</style>
      <div
        ref={composerContainerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative mx-auto flex w-full max-w-[900px] flex-col overflow-hidden rounded-3xl border bg-card shadow-sm transition-colors ${
          isDragOver ? "border-violet-400 shadow-violet-200/50 dark:shadow-violet-900/40" : "border-border"
        } ${disabled ? "opacity-60" : ""}`}
        style={{
          height: `${composerHeightPx}px`,
          minHeight: `${MIN_COMPOSER_HEIGHT_PX}px`,
          maxHeight: `${Math.round(MAX_COMPOSER_VIEWPORT_RATIO * 100)}vh`,
        }}
      >
        {isDragOver ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-3xl bg-violet-50/90 dark:bg-violet-900/40 backdrop-blur-[1px]">
            <Paperclip className="h-6 w-6 text-violet-500" />
            <span className="text-[13px] font-medium text-violet-600 dark:text-violet-400">Drop to attach</span>
          </div>
        ) : null}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize reply box"
          onMouseDown={startResize}
          className="group flex h-2.5 cursor-row-resize items-center justify-center bg-card"
        >
          <span className="h-1 w-14 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/40" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <div className="flex flex-1 items-start justify-between gap-2 text-[12px] text-foreground">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="font-medium text-muted-foreground">To:</span>
              {toRecipients.map((recipient) => (
                <span
                  key={recipient}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[12px] text-foreground"
                >
                  {recipient}
                  <button
                    type="button"
                    onClick={() => removeRecipient(recipient, setToRecipients)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                value={toInput}
                onChange={(event) => setToInput(event.target.value)}
                onKeyDown={(event) =>
                  onRecipientKey(event, toInput, setToRecipients, setToInput)
                }
                placeholder={toRecipients.length ? "" : "Add recipient"}
                disabled={disabled}
                className="min-w-[120px] flex-1 bg-transparent text-[13px] text-foreground outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pr-2 text-[12px]">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowCC((prev) => !prev)}
              className="font-medium text-muted-foreground hover:text-foreground"
            >
              Cc
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowBCC((prev) => !prev)}
              className="font-medium text-muted-foreground hover:text-foreground"
            >
              Bcc
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Hide reply box"
              title="Hide reply box"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {showCC ? (
          <div className="flex items-start gap-2 border-b border-border px-3 py-1.5 text-[12px] text-foreground">
            <span className="font-medium text-muted-foreground">Cc:</span>
            {ccRecipients.map((recipient) => (
              <span
                key={recipient}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[12px] text-foreground"
              >
                {recipient}
                <button
                  type="button"
                  onClick={() => removeRecipient(recipient, setCcRecipients)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={ccInput}
              onChange={(event) => setCcInput(event.target.value)}
              onKeyDown={(event) =>
                onRecipientKey(event, ccInput, setCcRecipients, setCcInput)
              }
              placeholder="Add CC"
              disabled={disabled}
              className="min-w-[120px] flex-1 bg-transparent text-[13px] text-foreground outline-none"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowCC(false);
                setCcRecipients([]);
                setCcInput("");
              }}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          </div>
        ) : null}
        {showBCC ? (
          <div className="flex items-start gap-2 border-b border-border px-3 py-1.5 text-[12px] text-foreground">
            <span className="font-medium text-muted-foreground">Bcc:</span>
            {bccRecipients.map((recipient) => (
              <span
                key={`bcc-${recipient}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[12px] text-foreground"
              >
                {recipient}
                <button
                  type="button"
                  onClick={() => removeRecipient(recipient, setBccRecipients)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={bccInput}
              onChange={(event) => setBccInput(event.target.value)}
              onKeyDown={(event) =>
                onRecipientKey(event, bccInput, setBccRecipients, setBccInput)
              }
              placeholder="Add BCC"
              disabled={disabled}
              className="min-w-[120px] flex-1 bg-transparent text-[13px] text-foreground outline-none"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowBCC(false);
                setBccRecipients([]);
                setBccInput("");
              }}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto bg-card px-3 py-2">
            {refineOpen && !isNote ? (
              <div
                className="mb-2 flex flex-col gap-2 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/70 dark:bg-violet-500/10 px-3 py-2.5"
                style={{
                  animation: "refine-slide-in 180ms cubic-bezier(0.23,1,0.32,1) both",
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
                  Refine draft
                </div>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={refinePrompt}
                    onChange={(e) => setRefinePrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleRefineSubmit();
                      }
                      if (e.key === "Escape") {
                        setRefineOpen(false);
                        setRefineError("");
                      }
                    }}
                    placeholder="Write a custom instruction..."
                    className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-violet-400/70 dark:placeholder:text-violet-400/50"
                  />
                  <button
                    type="button"
                    disabled={!refinePrompt.trim()}
                    onClick={handleRefineSubmit}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40 hover:bg-violet-700 transition-colors"
                    aria-label="Submit refinement"
                  >
                    Apply
                    <CornerDownLeft className="h-3 w-3" />
                  </button>
                </div>
                {refineError ? (
                  <p className="text-[11px] text-red-500 dark:text-red-400">{refineError}</p>
                ) : null}
              </div>
            ) : null}
            {isNote ? (
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => {
                  noteCaretIndexRef.current = event.target.selectionStart;
                  onChange(event.target.value);
                  updateMentionStateFromInput(
                    event.target.value,
                    event.target.selectionStart,
                    event.currentTarget
                  );
                }}
                onClick={(event) =>
                  {
                    noteCaretIndexRef.current = event.currentTarget.selectionStart;
                    updateMentionStateFromInput(
                      event.currentTarget.value,
                      event.currentTarget.selectionStart,
                      event.currentTarget
                    );
                  }
                }
                onKeyUp={(event) =>
                  {
                    noteCaretIndexRef.current = event.currentTarget.selectionStart;
                    updateMentionStateFromInput(
                      event.currentTarget.value,
                      event.currentTarget.selectionStart,
                      event.currentTarget
                    );
                  }
                }
                onKeyDown={(event) => {
                  if (!mentionState.open || !mentionCandidates.length) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionState((prev) => ({
                      ...prev,
                      activeIndex: (prev.activeIndex + 1) % mentionCandidates.length,
                    }));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionState((prev) => ({
                      ...prev,
                      activeIndex:
                        (prev.activeIndex - 1 + mentionCandidates.length) % mentionCandidates.length,
                    }));
                  } else if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    insertMention(mentionCandidates[mentionState.activeIndex] || mentionCandidates[0]);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionState((prev) => ({ ...prev, open: false }));
                  }
                }}
                onInput={resizeTextarea}
                onBlur={onBlur}
                placeholder={disabled ? disabledPlaceholder : "Leave an internal note..."}
                rows={2}
                disabled={disabled}
                className="min-h-[52px] resize-y !border-0 !shadow-none !bg-transparent !p-0 text-[14px] leading-[1.55] focus-visible:!ring-0 bg-yellow-50/40"
              />
            ) : (
              <div className={`flex flex-col ${editorBodyMinHeightClassName}`}>
                <div
                  key="reply-editor-body"
                  className={`relative flex flex-1 flex-col ${replyEditorMinHeightClassName}`}
                >
                  {!showDraftLoadingState && !String(value || "").trim() ? (
                    <div className="pointer-events-none absolute left-0 top-0 text-[14px] text-muted-foreground">
                      {disabled ? disabledPlaceholder : "Write your reply..."}
                    </div>
                  ) : null}
                  <div
                    ref={replyEditorRef}
                    contentEditable={!disabled && !showDraftLoadingState}
                    suppressContentEditableWarning
                    onFocus={() => {
                      replyEditorFocusedRef.current = true;
                      const selection = typeof window !== "undefined" ? window.getSelection() : null;
                      if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        if (replyEditorRef.current?.contains(range.startContainer)) {
                          const beforeRange = range.cloneRange();
                          beforeRange.selectNodeContents(replyEditorRef.current);
                          beforeRange.setEnd(range.startContainer, range.startOffset);
                          replyCaretIndexRef.current = String(beforeRange.toString() || "")
                            .replace(/\r\n/g, "\n").length;
                        }
                      }
                    }}
                    onInput={handleReplyEditorInput}
                    onMouseDown={handleReplyEditorMouseDown}
                    onMouseMove={handleReplyEditorMouseMove}
                    onMouseLeave={handleReplyEditorMouseLeave}
                    onBlur={handleReplyEditorBlur}
                    onKeyUp={() => {
                      const selection = typeof window !== "undefined" ? window.getSelection() : null;
                      if (!selection || selection.rangeCount === 0) return;
                      const range = selection.getRangeAt(0);
                      if (!replyEditorRef.current?.contains(range.startContainer)) return;
                      const beforeRange = range.cloneRange();
                      beforeRange.selectNodeContents(replyEditorRef.current);
                      beforeRange.setEnd(range.startContainer, range.startOffset);
                      replyCaretIndexRef.current = String(beforeRange.toString() || "")
                        .replace(/\r\n/g, "\n").length;
                    }}
                    onMouseUp={() => {
                      const selection = typeof window !== "undefined" ? window.getSelection() : null;
                      if (!selection || selection.rangeCount === 0) return;
                      const range = selection.getRangeAt(0);
                      if (!replyEditorRef.current?.contains(range.startContainer)) return;
                      const beforeRange = range.cloneRange();
                      beforeRange.selectNodeContents(replyEditorRef.current);
                      beforeRange.setEnd(range.startContainer, range.startOffset);
                      replyCaretIndexRef.current = String(beforeRange.toString() || "")
                        .replace(/\r\n/g, "\n").length;
                    }}
                    onClick={(event) => {
                      const target = event.target;
                      if (!(target instanceof HTMLAnchorElement)) return;
                      event.preventDefault();
                      const href = String(target.getAttribute("href") || "").trim();
                      if (!href) return;
                      window.open(href, "_blank", "noopener,noreferrer");
                    }}
                    className={`flex-1 whitespace-pre-wrap break-words p-0 text-[14px] leading-[1.55] text-foreground outline-none [&_a]:cursor-pointer [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-700 dark:[&_a:hover]:text-blue-300 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md ${replyEditorMinHeightClassName}`}
                  />
                  {showDraftLoadingState ? (
                    <div className="absolute inset-0 flex flex-col gap-3 pt-0.5">
                      <div className="h-3 rounded-full bg-muted animate-pulse" style={{ width: "72%" }} />
                      <div className="h-3 rounded-full bg-muted animate-pulse" style={{ width: "91%", animationDelay: "120ms" }} />
                      <div className="h-3 rounded-full bg-muted animate-pulse" style={{ width: "84%", animationDelay: "240ms" }} />
                      <div className="h-3 rounded-full bg-muted animate-pulse" style={{ width: "58%", animationDelay: "360ms" }} />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
            {isNote && mentionState.open && mentionCandidates.length ? (
              <div
                className="absolute z-20 w-[320px] rounded-xl border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur-[2px]"
                style={{
                  left: `${mentionPopupPosition.left}px`,
                  top: `${mentionPopupPosition.top}px`,
                  transform:
                    mentionPopupPosition.placement === "up"
                      ? "translateY(calc(-100% - 10px))"
                      : "translateY(10px)",
                }}
              >
                {mentionCandidates.map((candidate, index) => {
                  const isActive = index === mentionState.activeIndex;
                  return (
                    <button
                      key={candidate.id || candidate.email || candidate.label}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertMention(candidate)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px] ${
                        isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                      }`}
                    >
                      <span className="truncate text-[13px] font-medium">{candidate.label}</span>
                      <span className="ml-2 truncate text-[12px] text-muted-foreground">{candidate.email}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {visibleAttachmentPills.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 pb-1 text-[12px]">
                {visibleAttachmentPills.map((file) => (
                  <span
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-foreground shadow-[0_1px_1px_rgba(0,0,0,0.03)]"
                    style={{
                      animation: "attachment-pill-in 160ms cubic-bezier(0.23,1,0.32,1) both",
                    }}
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-[220px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(file)}
                      className="-mr-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground">
            <div className="flex items-center gap-2">
              {showDraftLoadingState ? (
                <div className="flex items-center gap-1.5 text-[12px] text-violet-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                  {isRefiningDraft ? "Refining draft..." : "Drafting reply..."}
                </div>
              ) : !isNote ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleAddAttachments}
                    disabled={disabled || showDraftLoadingState}
                  />
                  <button
                    type="button"
                    disabled={disabled || showDraftLoadingState}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach file"
                    title="Attach file"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || showDraftLoadingState}
                    onClick={() => {
                      setSavedRepliesQuery("");
                      setSavedRepliesOpen(true);
                    }}
                    aria-label="Open saved replies"
                    title="Saved Replies"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Zap className="h-4 w-4" />
                  </button>
                  {!isNote && (
                    <Popover open={languagePickerOpen} onOpenChange={setLanguagePickerOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                          disabled={isTranslating}
                        >
                          {isTranslating ? (
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border border-border border-t-foreground" />
                          ) : (
                            <Globe className="h-4 w-4" />
                          )}
                          {replyLanguage && (
                            <span className="text-[12px] font-medium">
                              {SUPPORT_LANGUAGE_LABELS[replyLanguage] || replyLanguage}
                            </span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-40 p-1">
                        {SUPPORTED_SUPPORT_LANGUAGE_CODES.map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => handleLanguageChange(code)}
                            className={`w-full rounded-md px-3 py-1.5 text-left text-[13px] transition-colors ${
                              code === replyLanguage
                                ? "bg-accent font-medium text-foreground"
                                : "text-foreground/70 hover:bg-accent hover:text-foreground"
                            }`}
                          >
                            {SUPPORT_LANGUAGE_LABELS[code]}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                  {typeof onGenerateDraft === "function" ? (
                    <button
                      type="button"
                      disabled={disabled || showDraftLoadingState || isGeneratingDraft}
                      onClick={() => onGenerateDraft?.(replyLanguage)}
                      className="rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-medium text-foreground/80 hover:border-border/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGeneratingDraft ? "Generating..." : "Generate draft"}
                    </button>
                  ) : null}
                  {typeof onRefineDraft === "function" ? (
                    <button
                      type="button"
                      disabled={disabled || showDraftLoadingState || isRefiningDraft || isGeneratingDraft}
                      onClick={() => {
                        setRefineOpen((prev) => !prev);
                        setRefineError("");
                      }}
                      aria-label="Refine draft with AI"
                      title="Refine draft"
                      className={refineOpen
                        ? "rounded-md bg-violet-100 dark:bg-violet-500/25 p-1.5 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/30"
                        : "rounded-md p-1.5 text-violet-400 dark:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-400"}
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled || showDraftLoadingState}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium ${
                      isNote
                        ? "bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                        : "bg-muted text-foreground/80"
                    }`}
                  >
                    {isNote ? "Internal note" : isForward ? "Forward email" : "Reply to customer"}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onModeChange("reply")}>Reply to customer</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onModeChange("forward")}>Forward email</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onModeChange("note")}>Internal note</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                disabled={disabled || showDraftLoadingState || !canSend || !value.trim() || isSending}
                onClick={() => {
                  const parsedMentionIds = isNote ? resolveMentionIdsFromText(value) : [];
                  const mentionUserIds = Array.from(
                    new Set([...(selectedMentionIds || []), ...parsedMentionIds])
                  );
                  onSend?.({
                    mode: isNote ? "note" : isForward ? "forward" : "reply",
                    bodyText: value,
                    toRecipients: buildRecipients(toRecipients, toInput),
                    ccRecipients: buildRecipients(ccRecipients, ccInput),
                    bccRecipients: buildRecipients(bccRecipients, bccInput),
                    attachments,
                    mentionUserIds,
                  });
                }}
                className="h-8 w-8 rounded-full bg-violet-600 p-0 text-white shadow-sm hover:bg-violet-700"
              >
                {isSending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <Dialog open={savedRepliesOpen} onOpenChange={setSavedRepliesOpen}>
        <DialogContent className="sm:max-w-[620px] gap-0 p-0 overflow-hidden">
          <div className="border-b border-border px-4 pt-4 pb-3">
            <DialogHeader className="mb-3">
              <DialogTitle className="text-[15px]">Saved Replies</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={savedRepliesQuery}
              onChange={(event) => setSavedRepliesQuery(event.target.value)}
              placeholder="Search replies..."
              className="h-9 text-[13px]"
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto p-2">
            {savedRepliesLoading ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                Loading…
              </p>
            ) : filteredSavedReplies.length ? (
              filteredSavedReplies.map((reply, i) => {
                const title = String(reply?.title || "Untitled reply");
                const category = String(reply?.category || "").trim();
                const content = normalizeSavedReplyToPlainText(reply?.content || "");
                const preview =
                  content.length > 160 ? `${content.slice(0, 160).trim()}…` : content;
                const imageCount = Array.isArray(reply?.images)
                  ? reply.images.length
                  : reply?.image?.content_base64
                    ? 1
                    : 0;
                return (
                  <div
                    key={reply?.id || `${title}-${preview}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => applySavedReplyReplace(reply)}
                    onKeyDown={(e) => e.key === "Enter" && applySavedReplyReplace(reply)}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className="group/row animate-in fade-in slide-in-from-bottom-1 duration-200 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
                        {category ? (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {category}
                          </span>
                        ) : null}
                        {imageCount > 0 ? (
                          <span className="shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-500/20 px-1.5 py-0.5 text-[11px] text-indigo-600 dark:text-indigo-400">
                            {imageCount === 1 ? "1 image" : `${imageCount} images`}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-[1.5] text-muted-foreground">{preview}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); applySavedReplyInsert(reply); }}
                      className="mt-0.5 shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-medium text-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-accent group-hover/row:opacity-100"
                    >
                      Insert
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-10 text-center">
                <p className="text-[13px] font-medium text-foreground">No saved replies yet.</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Create your first saved reply in Settings.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
