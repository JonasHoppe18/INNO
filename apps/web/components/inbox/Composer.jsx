import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  X,
  Loader2,
  Mail,
  Maximize2,
  Paperclip,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SonaLogo } from "@/components/ui/SonaLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
}) {
  const isNote = mode === "note";
  const initialTo = useMemo(() => {
    if (!toLabel) return [];
    const match = String(toLabel).match(/<([^>]+)>/);
    const email = match?.[1] ? match[1].trim() : String(toLabel).trim();
    return email ? [email] : [];
  }, [toLabel]);
  const [toRecipients, setToRecipients] = useState(initialTo);
  const [ccRecipients, setCcRecipients] = useState([]);
  const [bccRecipients, setBccRecipients] = useState([]);
  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const textareaRef = useRef(null);
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
    resizeTextarea();
  }, [value]);

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

  if (collapsed) {
    return (
      <div className="flex-none border-t border-gray-100 bg-white px-4 py-2.5">
        <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-xs font-medium text-gray-600">Reply box hidden</span>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-none border-t border-gray-100 bg-white px-4 py-2.5">
      <div className={`flex flex-col gap-2 ${disabled ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-1 items-start justify-between gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-gray-400" />
              <span className="font-medium text-gray-500">To:</span>
              {toRecipients.map((recipient) => (
                <span
                  key={recipient}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
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
                className="min-w-[120px] flex-1 bg-transparent text-xs text-gray-700 outline-none"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowCC(true)}>Add CC</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowBCC(true)}>Add BCC</DropdownMenuItem>
                <DropdownMenuItem>Edit Subject</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
              >
                Reply
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Reply</DropdownMenuItem>
              <DropdownMenuItem>Reply all</DropdownMenuItem>
              <DropdownMenuItem>Forward</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Hide reply box"
            title="Hide reply box"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-gray-600 hover:bg-gray-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {showCC ? (
          <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700">
            <span className="font-medium text-gray-500">Cc:</span>
            {ccRecipients.map((recipient) => (
              <span
                key={recipient}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
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
              className="min-w-[120px] flex-1 bg-transparent text-xs text-gray-700 outline-none"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowCC(false);
                setCcRecipients([]);
                setCcInput("");
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Remove
            </button>
          </div>
        ) : null}
        {showBCC ? (
          <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700">
            <span className="font-medium text-gray-500">Bcc:</span>
            {bccRecipients.map((recipient) => (
              <span
                key={`bcc-${recipient}`}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
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
              className="min-w-[120px] flex-1 bg-transparent text-xs text-gray-700 outline-none"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowBCC(false);
                setBccRecipients([]);
                setBccInput("");
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Remove
            </button>
          </div>
        ) : null}
        {draftLoaded ? (
          <div className="mb-2 flex items-center gap-1.5 pl-1">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-indigo-600" />
            <span className="text-xs font-medium text-indigo-600">Generated by Sona</span>
          </div>
        ) : null}
        {attachments.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 pl-1 text-xs">
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
        <div className="relative rounded-md border border-gray-200 bg-white p-2.5">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              updateMentionStateFromInput(
                event.target.value,
                event.target.selectionStart,
                event.currentTarget
              );
            }}
            onClick={(event) =>
              updateMentionStateFromInput(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget
              )
            }
            onKeyUp={(event) =>
              updateMentionStateFromInput(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget
              )
            }
            onKeyDown={(event) => {
              if (!isNote || !mentionState.open || !mentionCandidates.length) return;
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
            placeholder={
              disabled
                ? disabledPlaceholder
                : mode === "reply"
                ? "Write your reply..."
                : "Leave an internal note..."
            }
            rows={2}
            disabled={disabled}
            className={`min-h-[56px] resize-y !border-0 !shadow-none !bg-transparent !p-0 text-sm leading-relaxed focus-visible:!ring-0 ${
              isNote ? "bg-yellow-50/40" : ""
            }`}
          />
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
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
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
              <div className="mt-2 border-t border-gray-200 pt-2" />
              <textarea
                value={signatureValue}
                onChange={(event) => onSignatureChange?.(event.target.value)}
                onBlur={onSignatureBlur}
                placeholder="Your signature..."
                rows={3}
                disabled={disabled}
                className="w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-gray-700 outline-none"
              />
            </>
          ) : null}
          {isDraftLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white backdrop-blur-md">
              <div className="flex flex-col items-center gap-2 px-6 text-center">
                <SonaLogo size={28} speed="working" />
                <div className="text-sm font-semibold text-gray-900">Sona is drafting your reply</div>
                <div className="text-xs text-gray-600">
                  Analyzing policy context and building a precise response.
                </div>
                <div className="mt-0.5 h-1.5 w-40 overflow-hidden rounded-full bg-indigo-100">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-indigo-500" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onModeChange(isNote ? "reply" : "note")}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
                isNote
                  ? "border-yellow-200 bg-yellow-50 text-yellow-700"
                  : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              Internal note
            </button>
            {!isNote ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleAddAttachments}
                  disabled={disabled}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
          </div>
        <div className="flex items-center">
          <Button
            type="button"
            disabled={disabled || !canSend || !value.trim() || isSending}
            onClick={() => {
              const parsedMentionIds = isNote ? resolveMentionIdsFromText(value) : [];
              const mentionUserIds = Array.from(
                new Set([...(selectedMentionIds || []), ...parsedMentionIds])
              );
              onSend?.({
                mode: isNote ? "note" : "reply",
                bodyText: value,
                signature: signatureValue,
                toRecipients: buildRecipients(toRecipients, toInput),
                ccRecipients: buildRecipients(ccRecipients, ccInput),
                bccRecipients: buildRecipients(bccRecipients, bccInput),
                attachments,
                mentionUserIds,
              });
            }}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-900"
          >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-3.5 w-3.5" />
                  {isNote ? "Save note" : "Send Reply"}
                </>
              )}
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
