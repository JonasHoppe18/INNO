import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  ChevronDown,
  Mail,
  Paperclip,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Composer({
  value,
  onChange,
  draftLoaded = false,
  canSend = false,
  onSend,
  mode,
  onModeChange,
  toLabel,
  onBlur,
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

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 124)}px`;
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
  }, [initialTo]);

  useEffect(() => {
    resizeTextarea();
  }, [value]);

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

  return (
    <div className="flex-none border-t border-gray-100 bg-white px-4 py-2.5">
      <div className="flex flex-col gap-2">
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
                className="min-w-[120px] flex-1 bg-transparent text-xs text-gray-700 outline-none"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
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
              className="min-w-[120px] flex-1 bg-transparent text-xs text-gray-700 outline-none"
            />
            <button
              type="button"
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
              className="min-w-[120px] flex-1 bg-transparent text-xs text-gray-700 outline-none"
            />
            <button
              type="button"
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
          <div className="flex items-center gap-2 text-xs text-amber-700">
            <Sparkles className="h-3.5 w-3.5" />
            Generated by Sona
          </div>
        ) : null}
        <div className="rounded-md border border-gray-200 bg-white p-2.5">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onInput={resizeTextarea}
            onBlur={onBlur}
            placeholder={mode === "reply" ? "Write your reply..." : "Leave an internal note..."}
            rows={5}
            className={`min-h-[124px] resize-y border-0 bg-transparent p-0 text-sm leading-relaxed focus-visible:ring-0 ${
              isNote ? "bg-yellow-50/40" : ""
            }`}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onModeChange(isNote ? "reply" : "note")}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
                isNote
                  ? "border-yellow-200 bg-yellow-50 text-yellow-700"
                  : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              Internal note
            </button>
            <button type="button" className="text-gray-400 hover:text-gray-600">
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="text-gray-400 hover:text-gray-600">
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="text-xs text-gray-400 hover:text-gray-600">
              Use template
            </button>
          </div>
        <div className="flex items-center">
          <Button
            type="button"
            onClick={() =>
              onSend?.({
                bodyText: value,
                toRecipients: buildRecipients(toRecipients, toInput),
                ccRecipients: buildRecipients(ccRecipients, ccInput),
                bccRecipients: buildRecipients(bccRecipients, bccInput),
              })
            }
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-900"
          >
              <Send className="mr-2 h-3.5 w-3.5" />
              Send Reply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
