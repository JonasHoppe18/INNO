import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  X,
  Loader2,
  Maximize2,
  Paperclip,
  Send,
  PenLine,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SonaLogo } from "@/components/ui/SonaLogo";
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
  DialogDescription,
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

const plainTextToReplyHtml = (text = "") =>
  linkifyHtml(escapeHtml(String(text || "").replace(/\r\n/g, "\n"))).replace(/\n/g, "<br/>");

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

const normalizeSavedReplyToPlainText = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (hasHtmlTag(raw)) {
    return extractPlainTextFromReplyHtml(raw);
  }
  return raw;
};

export function Composer({
  value,
  onChange,
  signatureValue = "",
  onSignatureChange,
  onSignatureBlur,
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
}) {
  const isNote = mode === "note";
  const isForward = mode === "forward";
  const showDraftLoadingState = !isNote && isDraftLoading;
  const replyEditorMinHeightClassName = "min-h-[72px]";
  const loadingStateMinHeightClassName = "min-h-[120px]";
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
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
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
    const query = String(savedRepliesQuery || "").trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((reply) => {
      const title = String(reply?.title || "").toLowerCase();
      const category = String(reply?.category || "").toLowerCase();
      const content = normalizeSavedReplyToPlainText(reply?.content || "").toLowerCase();
      return title.includes(query) || category.includes(query) || content.includes(query);
    });
  }, [savedReplies, savedRepliesQuery]);

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
    const nextHtml = plainTextToReplyHtml(value || "");
    if (replyEditorRef.current && replyEditorRef.current.innerHTML !== nextHtml) {
      replyEditorRef.current.innerHTML = nextHtml;
    }
  }, [isDraftLoading, isNote, value]);

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

  const applySavedReplyReplace = (reply) => {
    const content = normalizeSavedReplyToPlainText(reply?.content || "");
    if (!content) return;
    const current = String(value || "");
    const hasCurrentText = Boolean(current.trim());
    const sameContent = current.trim() === content;
    if (hasCurrentText && !sameContent) {
      const confirmed = window.confirm("Replace current draft with this saved reply?");
      if (!confirmed) return;
    }
    onChange(content);
    setSavedRepliesOpen(false);
  };

  const applySavedReplyInsert = (reply) => {
    const content = normalizeSavedReplyToPlainText(reply?.content || "");
    if (!content) return;
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
    onChange(extractPlainTextFromReplyHtml(html));
    syncingReplyHtmlRef.current = false;
  };

  const handleReplyEditorBlur = (event) => {
    replyEditorFocusedRef.current = false;
    const plain = extractPlainTextFromReplyHtml(String(event?.currentTarget?.innerHTML || ""));
    const formatted = plainTextToReplyHtml(plain);
    if (replyEditorRef.current && replyEditorRef.current.innerHTML !== formatted) {
      replyEditorRef.current.innerHTML = formatted;
    }
    onBlur?.();
  };

  if (collapsed) {
    return (
      <div className="flex-none border-t border-gray-100 bg-white px-4 py-2">
        <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-[12px] font-medium text-gray-600">Reply box hidden</span>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
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
      <div
        className={`mx-auto w-full max-w-[900px] rounded-3xl border border-gray-200/80 bg-white shadow-sm ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200/80 px-3 py-1.5">
          <div className="flex flex-1 items-start justify-between gap-2 text-[12px] text-gray-700">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="font-medium text-gray-500">To:</span>
              {toRecipients.map((recipient) => (
                <span
                  key={recipient}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600"
                >
                  {recipient}
                  <button
                    type="button"
                    onClick={() => removeRecipient(recipient, setToRecipients)}
                    className="text-gray-400 hover:text-gray-600"
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
                className="min-w-[120px] flex-1 bg-transparent text-[13px] text-gray-700 outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pr-2 text-[12px]">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowCC((prev) => !prev)}
              className="font-medium text-gray-500 hover:text-gray-700"
            >
              Cc
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowBCC((prev) => !prev)}
              className="font-medium text-gray-500 hover:text-gray-700"
            >
              Bcc
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Hide reply box"
              title="Hide reply box"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {showCC ? (
          <div className="flex items-start gap-2 border-b border-gray-200/80 px-3 py-1.5 text-[12px] text-gray-700">
            <span className="font-medium text-gray-500">Cc:</span>
            {ccRecipients.map((recipient) => (
              <span
                key={recipient}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600"
              >
                {recipient}
                <button
                  type="button"
                  onClick={() => removeRecipient(recipient, setCcRecipients)}
                  className="text-gray-400 hover:text-gray-600"
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
              className="min-w-[120px] flex-1 bg-transparent text-[13px] text-gray-700 outline-none"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowCC(false);
                setCcRecipients([]);
                setCcInput("");
              }}
              className="text-[12px] text-gray-400 hover:text-gray-600"
            >
              Remove
            </button>
          </div>
        ) : null}
        {showBCC ? (
          <div className="flex items-start gap-2 border-b border-gray-200/80 px-3 py-1.5 text-[12px] text-gray-700">
            <span className="font-medium text-gray-500">Bcc:</span>
            {bccRecipients.map((recipient) => (
              <span
                key={`bcc-${recipient}`}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600"
              >
                {recipient}
                <button
                  type="button"
                  onClick={() => removeRecipient(recipient, setBccRecipients)}
                  className="text-gray-400 hover:text-gray-600"
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
              className="min-w-[120px] flex-1 bg-transparent text-[13px] text-gray-700 outline-none"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowBCC(false);
                setBccRecipients([]);
                setBccInput("");
              }}
              className="text-[12px] text-gray-400 hover:text-gray-600"
            >
              Remove
            </button>
          </div>
        ) : null}
        {attachments.length ? (
          <div className="mb-1 flex flex-wrap items-center gap-2 px-3 text-[12px]">
            {attachments.map((file) => (
              <span
                key={`${file.name}:${file.size}:${file.lastModified}`}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600"
              >
                <span className="max-w-[220px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(file)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="relative">
          <div className="bg-white px-3 py-2">
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
                    <div className="pointer-events-none absolute left-0 top-0 text-[14px] text-gray-400">
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
                    onPaste={(event) => {
                      event.preventDefault();
                      const pasted = event.clipboardData?.getData("text/plain") || "";
                      document.execCommand("insertText", false, pasted);
                    }}
                    onClick={(event) => {
                      const target = event.target;
                      if (!(target instanceof HTMLAnchorElement)) return;
                      event.preventDefault();
                      const href = String(target.getAttribute("href") || "").trim();
                      if (!href) return;
                      window.open(href, "_blank", "noopener,noreferrer");
                    }}
                    className={`flex-1 whitespace-pre-wrap break-words p-0 text-[14px] leading-[1.55] text-gray-900 outline-none [&_a]:cursor-pointer [&_a]:text-blue-600 [&_a]:underline [&_a:hover]:text-blue-700 ${replyEditorMinHeightClassName}`}
                  />
                </div>
              </div>
            )}
            {isNote && mentionState.open && mentionCandidates.length ? (
              <div
                className="absolute z-20 w-[320px] rounded-xl border border-gray-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-[2px]"
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
                        isActive ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="truncate text-[13px] font-medium">{candidate.label}</span>
                      <span className="ml-2 truncate text-[12px] text-gray-400">{candidate.email}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {!isNote ? (
              <>
                {showSignatureEditor ? (
                  <>
                    <div className="mt-2 border-t border-gray-200 pt-2" />
                    <div className="mb-1.5 text-[12px] font-medium text-gray-500">Signature</div>
                    <textarea
                      value={signatureValue}
                      onChange={(event) => onSignatureChange?.(event.target.value)}
                      onBlur={onSignatureBlur}
                      placeholder="Your signature..."
                      rows={3}
                      disabled={disabled}
                      className="w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-[1.55] text-gray-700 outline-none"
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-gray-200/80 px-3 py-1.5 text-[12px] text-gray-500">
            <div className="flex items-center gap-2">
              {!isNote ? (
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
                    className="rounded-md p-1.5 text-gray-500 hover:bg-white hover:text-gray-700"
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
                    className="rounded-md p-1.5 text-gray-500 hover:bg-white hover:text-gray-700"
                  >
                    <Zap className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || showDraftLoadingState}
                    onClick={() => setShowSignatureEditor((prev) => !prev)}
                    aria-label={showSignatureEditor ? "Hide signature" : "Show signature"}
                    title={showSignatureEditor ? "Hide signature" : "Show signature"}
                    className={showSignatureEditor
                      ? "rounded-md bg-indigo-50 p-1.5 text-indigo-600 hover:bg-indigo-100"
                      : "rounded-md p-1.5 text-gray-500 hover:bg-white hover:text-gray-700"}
                  >
                    <PenLine className="h-4 w-4" />
                  </button>
                  {typeof onGenerateDraft === "function" ? (
                    <button
                      type="button"
                      disabled={disabled || showDraftLoadingState || isGeneratingDraft}
                      onClick={onGenerateDraft}
                      className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-600 hover:border-gray-300 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGeneratingDraft ? "Generating..." : "Generate draft"}
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
                        ? "bg-yellow-50 text-yellow-700"
                        : "bg-white text-gray-600"
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
                    signature: signatureValue,
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
          {showDraftLoadingState ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-b-[28px] bg-white/86 backdrop-blur-[3px]">
              <div
                key="draft-loading-state"
                className={`flex h-full w-full flex-col items-center justify-center rounded-b-[28px] bg-gradient-to-b from-slate-50 to-white px-6 py-7 ${loadingStateMinHeightClassName}`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 ring-1 ring-indigo-100">
                  <SonaLogo size={24} speed="working" />
                </div>
                <div className="mt-3 text-center">
                  <div className="text-sm font-semibold text-slate-900">Sona is drafting your reply</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-600">
                    Analyzing policy context and building a precise response.
                  </div>
                </div>
                <div className="mt-4 h-1.5 w-32 overflow-hidden rounded-full bg-indigo-100">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-indigo-500" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="mx-auto mt-2 w-full max-w-[900px] text-center text-[12px] text-gray-500">
        Sona can make mistakes. Please verify important information.
      </p>
      <Dialog open={savedRepliesOpen} onOpenChange={setSavedRepliesOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Saved Replies</DialogTitle>
            <DialogDescription>
              Choose an approved reply and apply it to your draft.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={savedRepliesQuery}
              onChange={(event) => setSavedRepliesQuery(event.target.value)}
              placeholder="Search saved replies..."
            />
            <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-md border border-gray-200 p-2">
              {savedRepliesLoading ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Loading saved replies...
                </p>
              ) : filteredSavedReplies.length ? (
                filteredSavedReplies.map((reply) => {
                  const title = String(reply?.title || "Untitled reply");
                  const category = String(reply?.category || "").trim();
                  const content = normalizeSavedReplyToPlainText(reply?.content || "");
                  const preview =
                    content.length > 180 ? `${content.slice(0, 180).trim()}...` : content;
                  return (
                    <div
                      key={reply?.id || `${title}-${preview}`}
                      className="rounded-lg border border-gray-200 bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
                            {category ? (
                              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">
                                {category}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{preview}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applySavedReplyInsert(reply)}
                          >
                            Insert
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => applySavedReplyReplace(reply)}
                            className="bg-black text-white hover:bg-slate-900"
                          >
                            Replace draft
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="px-2 py-8 text-center">
                  <p className="text-sm font-medium text-gray-700">No saved replies yet.</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Create your first saved reply in Settings.
                  </p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
