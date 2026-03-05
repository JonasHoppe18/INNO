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
            onChange={(event) => onChange(event.target.value)}
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
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-gradient-to-b from-white/95 via-indigo-50/80 to-white/95 backdrop-blur-[1px]">
              <div className="flex min-w-[260px] flex-col items-center gap-2 rounded-xl border border-indigo-100 bg-white/90 px-5 py-4 text-center shadow-sm">
                <div className="rounded-full bg-indigo-50 p-1.5 shadow-sm">
                  <SonaLogo size={26} speed="working" />
                </div>
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
          </div>
        <div className="flex items-center">
          <Button
            type="button"
            disabled={disabled || !canSend || !value.trim() || isSending}
            onClick={() =>
              onSend?.({
                bodyText: value,
                signature: signatureValue,
                toRecipients: buildRecipients(toRecipients, toInput),
                ccRecipients: buildRecipients(ccRecipients, ccInput),
                bccRecipients: buildRecipients(bccRecipients, bccInput),
                attachments,
              })
            }
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
                  Send Reply
                </>
              )}
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
