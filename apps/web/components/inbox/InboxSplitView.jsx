"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TicketList } from "@/components/inbox/TicketList";
import { TicketDetail } from "@/components/inbox/TicketDetail";
import { SonaInsightsModal } from "@/components/inbox/SonaInsightsModal";
import { TranslationModal } from "@/components/inbox/TranslationModal";
import {
  deriveThreadsFromMessages,
  useThreadMessages,
  useThreadPreviewMessages,
} from "@/hooks/useInboxData";
import {
  getInboxBucket,
  getMessageTimestamp,
  getReplyTargetEmail,
  getSenderLabel,
  isOutboundMessage,
} from "@/components/inbox/inbox-utils";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { useSiteHeaderActions } from "@/components/site-header-actions";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpRight, Bell, CheckCircle, CheckCircle2, ChevronDown, Inbox, Plus, User, X } from "lucide-react";

const DEFAULT_TICKET_STATE = {
  status: "New",
  assignee: null,
  priority: null,
};

const DEFAULT_FILTERS = {
  query: "",
  status: "All",
  unreadsOnly: false,
};

const STATUS_OPTIONS = ["New", "Open", "Pending", "Waiting", "Solved"];
const UNASSIGNED_ASSIGNEE_VALUE = "__unassigned__";
const EMAIL_CATEGORY_LABELS = [
  "Tracking",
  "Return",
  "Exchange",
  "Product question",
  "Payment",
  "Cancellation",
  "Refund",
  "Address change",
  "General",
];
const LEGACY_CATEGORY_LABEL_MAP = {
  "Order Tracking": "Tracking",
  "Address Change": "Address change",
  Cancel: "Cancellation",
};
const APPROVAL_ACTION_TYPES = new Set([
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "create_exchange_request",
  "process_exchange_return",
  "change_shipping_method",
  "hold_or_release_fulfillment",
  "edit_line_items",
  "update_customer_contact",
  "forward_email",
  "create_return_case",
  "send_return_instructions",
]);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const getAssigneeLabel = (profile, fallbackValue) => {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (profile?.email) return profile.email;
  return String(fallbackValue || "Unknown user");
};

const shortUserId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown member";
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 8)}...`;
};

const normalizeStatus = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "solved" || normalized === "resolved") return "Solved";
  if (normalized === "pending") return "Pending";
  if (normalized === "waiting") return "Waiting";
  if (normalized === "open") return "Open";
  if (normalized === "new") return "New";
  return value;
};

const toInboxTag = (slug = "") => `inbox:${String(slug || "").trim()}`;

const extractInboxSlugFromTags = (tags = []) => {
  const list = Array.isArray(tags) ? tags : [];
  const hit = list.find((tag) => String(tag || "").startsWith("inbox:"));
  if (!hit) return null;
  const slug = String(hit).slice("inbox:".length).trim();
  return slug || null;
};

const extractCategoryFromTags = (tags = []) => {
  const list = Array.isArray(tags) ? tags : [];
  for (const rawTag of list) {
    const tag = String(rawTag || "").trim();
    if (!tag || tag.startsWith("inbox:")) continue;
    if (EMAIL_CATEGORY_LABELS.includes(tag)) return tag;
    if (LEGACY_CATEGORY_LABEL_MAP[tag]) return LEGACY_CATEGORY_LABEL_MAP[tag];
  }
  return "General";
};

const extractSenderFromThreadSnippet = (thread) => {
  const snippet = String(thread?.snippet || "").replace(/\s+/g, " ").trim();
  if (!snippet) return "";

  const looksInternal = (value = "") => {
    const lower = String(value || "").toLowerCase();
    return (
      lower.includes("acezone support") ||
      lower.includes("support@acezone.io") ||
      lower.includes("@acezone.io") ||
      lower.includes("@sona-ai.dk")
    );
  };

  const fromHeaderMatch = snippet.match(
    /(?:^|\s)From\s*:\s*([^<,\n]+?)\s*(?:<([^>]+)>)?(?=\s+(?:Sent|To|Subject)\s*:|$)/i
  );
  const toHeaderMatch = snippet.match(
    /(?:^|\s)To\s*:\s*([^<,\n]+?)\s*(?:<([^>]+)>)?(?=\s+(?:From|Sent|Subject)\s*:|$)/i
  );

  const fromName = String(fromHeaderMatch?.[1] || "").trim();
  const fromEmail = String(fromHeaderMatch?.[2] || "").trim();
  const toName = String(toHeaderMatch?.[1] || "").trim();
  const toEmail = String(toHeaderMatch?.[2] || "").trim();

  if ((fromName || fromEmail) && !looksInternal(`${fromName} ${fromEmail}`)) {
    return fromName || fromEmail;
  }
  if (toName || toEmail) {
    return toName || toEmail;
  }

  const nameMatch = snippet.match(
    /(?:^|\s)(?:Name|Navn)\s*:\s*([^,:;|]+?)(?=\s+(?:Email|E-mail)\s*:|$)/i
  );
  if (nameMatch?.[1]) {
    const name = String(nameMatch[1]).trim();
    if (name && !/^unknown sender$/i.test(name)) return name;
  }

  const emailMatch = snippet.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch?.[0]) return String(emailMatch[0]).trim();

  return "";
};

function InboxHeaderActions({
  ticketState,
  assignmentOptions,
  selectedAssignmentValue,
  inboxOptions,
  selectedInboxBucket,
  selectedInboxSlug,
  tagLabel,
  onTicketStateChange,
  onAssignmentChange,
  onInboxChange,
  onOpenTranslation,
}) {
  const [inboxPickerOpen, setInboxPickerOpen] = useState(false);
  const [inboxFilter, setInboxFilter] = useState("");
  const destinationOptions = useMemo(
    () => [
      { value: "__all__", label: "All tickets", icon: Inbox },
      { value: "__notifications__", label: "Notifications", icon: Bell },
      ...((inboxOptions || []).map((option) => ({
        ...option,
        icon: Inbox,
      }))),
    ],
    [inboxOptions]
  );
  const selectedDestinationValue = useMemo(() => {
    if (selectedInboxBucket === "notification") return "__notifications__";
    if (!selectedInboxSlug) return "__all__";
    return selectedInboxSlug;
  }, [selectedInboxBucket, selectedInboxSlug]);
  const filteredInboxOptions = useMemo(() => {
    const query = String(inboxFilter || "").trim().toLowerCase();
    if (!query) return destinationOptions;
    return destinationOptions.filter((option) =>
      String(option?.label || "").toLowerCase().includes(query)
    );
  }, [destinationOptions, inboxFilter]);
  const statusStylesByStatus = {
    New: "bg-green-50 text-green-700 border-green-200",
    Open: "bg-blue-50 text-blue-700 border-blue-200",
    Pending: "bg-orange-50 text-orange-700 border-orange-200",
    Waiting: "bg-violet-50 text-violet-700 border-violet-200",
    Solved: "bg-red-50 text-red-700 border-red-200",
  };
  if (!ticketState) return null;
  const statusLabel =
    ticketState.status === "Solved" ? "Resolved" : ticketState.status;
  const statusStyles =
    statusStylesByStatus[ticketState.status] ||
    statusStylesByStatus.Open;
  return (
    <div className="flex items-center gap-2">
      <Select
        value={ticketState.status}
        onValueChange={(value) => onTicketStateChange({ status: value })}
      >
        <SelectTrigger
          className={`h-auto w-auto cursor-pointer gap-1.5 rounded-md border px-3 py-1 text-xs font-medium ${statusStyles}`}
        >
          {ticketState.status === "Solved" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5" />
          )}
          <SelectValue placeholder={statusLabel} />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={selectedAssignmentValue || UNASSIGNED_ASSIGNEE_VALUE}
        onValueChange={(value) => onAssignmentChange?.(value)}
      >
        <SelectTrigger className="h-auto w-auto cursor-pointer gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">
          <User className="h-3.5 w-3.5" />
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          {assignmentOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        className="cursor-pointer rounded-md border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700"
      >
        {tagLabel || "General"}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-300"
          >
            More
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={() => setInboxPickerOpen(true)}>
            Move
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenTranslation}>
            Translation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={inboxPickerOpen} onOpenChange={setInboxPickerOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Move conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={inboxFilter}
              onChange={(event) => setInboxFilter(event.target.value)}
              placeholder="Search destination..."
            />
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
              {filteredInboxOptions.map((option) => {
                const isActive = selectedDestinationValue === option.value;
                const OptionIcon = option.icon || Inbox;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      if (option.value === "__all__") {
                        onInboxChange?.({ inboxSlug: null, classificationKey: "support" });
                      } else if (option.value === "__notifications__") {
                        onInboxChange?.({ inboxSlug: null, classificationKey: "notification" });
                      } else {
                        onInboxChange?.({ inboxSlug: option.value, classificationKey: "support" });
                      }
                      setInboxPickerOpen(false);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-sm ${
                      isActive
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <OptionIcon className="h-4 w-4 shrink-0" />
                    {option.label}
                  </button>
                );
              })}
              {!filteredInboxOptions.length ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No inboxes found.</p>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkspaceTabsRow({
  tabs,
  activeThreadId,
  unreadByThread,
  onSelectTab,
  onCloseTab,
  onAddTab,
  inline = false,
}) {
  return (
    <div
      className={
        inline
          ? "relative min-w-0 flex-1 bg-white"
          : "border-b border-slate-200 bg-white"
      }
    >
      {inline ? <div className="absolute inset-y-0 left-0 z-10 w-2 bg-white" /> : null}
      <div
        className={
          inline
            ? "flex min-w-0 items-end overflow-x-auto pr-3 pt-0.5"
            : "mx-auto flex w-full max-w-[900px] items-center gap-1 overflow-x-auto px-4 py-1"
        }
      >
        {tabs.map((thread) => {
          const threadId = String(thread?.id || "").trim();
          if (!threadId) return null;
          const isActive = threadId === activeThreadId;
          const subject = String(thread?.subject || "").trim() || "Untitled ticket";
          const unreadCount = Number(unreadByThread?.[threadId] || 0);
          return (
            <div
              key={threadId}
              className={`group relative flex min-w-0 ${inline ? "max-w-[260px]" : "max-w-[240px]"} shrink-0 items-center gap-2 px-4 py-1.5 transition ${
                inline
                  ? isActive
                    ? "-mb-px ml-2 rounded-t-[12px] rounded-b-none bg-white text-slate-900"
                    : "rounded-t-[12px] rounded-b-none bg-white/65 text-slate-500 hover:bg-white/80 hover:text-slate-700"
                  : isActive
                  ? "-mb-px rounded-t-lg rounded-b-none border border-slate-200 border-b-0 bg-white text-slate-900 shadow-sm"
                  : "rounded-t-lg rounded-b-none border border-slate-200/80 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {isActive ? (
                <span
                  className={`absolute inset-x-0 bottom-0 h-[3px] ${inline ? "rounded-b-[12px]" : "rounded-b-lg"} bg-indigo-500`}
                />
              ) : null}
              <button
                type="button"
                onClick={() => onSelectTab?.(threadId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {unreadCount > 0 ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" /> : null}
                <span className="min-w-0 truncate pr-1 text-[12px] font-semibold leading-[18px]">
                  {subject}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onCloseTab?.(threadId)}
                className={`rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 ${
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
                aria-label={`Close ${subject}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => onAddTab?.()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
          aria-label="Open new tab"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const normalizeLookupText = (value = "") =>
  String(value || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(?:re|fw|fwd)\s*:\s*/gi, " ")
    .replace(/\bnew customer message on\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractOrderNumber = (value = "") => {
  if (!value) return null;
  const text = normalizeLookupText(value);
  const explicitMatch = text.match(
    /\b(?:ordre|ordrenummer|order)\s*(?:nr\.?|number|no\.?)?\s*#?\s*(\d{3,})\b/i
  );
  if (explicitMatch?.[1]) return explicitMatch[1];
  const compactMatch = text.match(/\b(?:order|ordre)\s*#(\d{3,})\b/i);
  if (compactMatch?.[1]) return compactMatch[1];
  const hashMatch = text.match(/#\s*(\d{3,})\b/);
  return hashMatch?.[1] || null;
};

const MOCK_ACTIONS = [
  {
    id: "action-1",
    title: "Identified order #8921 from Shopify",
    statusLabel: "Found",
    timestamp: "10:46 AM",
  },
  {
    id: "action-2",
    title: "Checking shipping status via GLS API",
    statusLabel: "In transit",
    timestamp: "10:46 AM",
  },
  {
    id: "action-3",
    title: "Estimated delivery calculation",
    statusLabel: "Wednesday, Oct 25",
    timestamp: "10:46 AM",
  },
  {
    id: "action-4",
    title: "Applying tone of voice: Friendly Danish shop",
    statusLabel: null,
    timestamp: "10:46 AM",
  },
];

const stripThreadSuffix = (value) =>
  String(value || "").replace(/\s*\|thread_id:[a-z0-9-]+\s*/i, "").trim();

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const isInternalNoteMessage = (message) =>
  String(message?.provider_message_id || "").startsWith("internal-note:");

const parsePendingLogDetail = (value) => {
  const raw = stripThreadSuffix(value);
  if (!raw) {
    return { detail: "", actionType: null, payload: {}, threadId: null };
  }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const detail =
        asString(parsed?.detail) ||
        asString(parsed?.message) ||
        asString(parsed?.summary) ||
        asString(parsed?.text) ||
        asString(parsed?.action) ||
        asString(parsed?.error) ||
        asString(parsed?.reason) ||
        asString(parsed?.status);
      const actionType = asString(parsed?.actionType || parsed?.action) || null;
      const payload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};
      const threadId = asString(parsed?.thread_id || parsed?.threadId) || null;
      return { detail: stripThreadSuffix(detail), actionType, payload, threadId };
    } catch {
      return { detail: raw, actionType: null, payload: {}, threadId: null };
    }
  }
  return { detail: raw, actionType: null, payload: {}, threadId: null };
};

const isApprovalManagedActionType = (value = "") =>
  APPROVAL_ACTION_TYPES.has(String(value || "").trim().toLowerCase());

const isOrderUpdateAction = (log) => {
  const stepName = String(log?.step_name || "").toLowerCase();
  const status = String(log?.status || "").toLowerCase();
  const parsed = parsePendingLogDetail(log?.step_detail);
  const detail = parsed.detail;
  const lower = detail.toLowerCase();
  const approvalSignals =
    lower.includes("approval") ||
    lower.includes("awaiting") ||
    lower.includes("pending") ||
    lower.includes("deaktiveret") ||
    lower.includes("disabled");

  if (stepName.includes("shopify_action_applied")) return false;
  if (stepName.includes("shopify_action_failed")) return approvalSignals;
  if (stepName.includes("shopify_action") || stepName.includes("shopify action")) {
    if (status === "warning" || status === "pending" || status === "awaiting_approval") return true;
    if (parsed.actionType) return true;
    if (parsed.payload && Object.keys(parsed.payload).length) return true;
    return approvalSignals;
  }
  return (
    lower.includes("updated shipping address") ||
    lower.includes("updated address") ||
    lower.includes("update shipping address") ||
    lower.includes("shipping address") ||
    lower.includes("cancel") ||
    lower.includes("refund")
  );
};

const isAppliedOrderUpdateAction = (log) => {
  const stepName = String(log?.step_name || "").toLowerCase();
  return stepName.includes("shopify_action_applied");
};

const getDecisionFromLog = (log) => {
  const stepName = String(log?.step_name || "").toLowerCase();
  if (stepName.includes("shopify_action_applied")) return "accepted";
  return null;
};

const getDecisionFromActionStatus = (status = "") => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "applied" || normalized === "approved" || normalized === "approved_test_mode") {
    return "accepted";
  }
  if (normalized === "declined" || normalized === "denied") return "denied";
  return null;
};

const normalizeActionDetail = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const stripHtml = (value = "") =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();

const extractAddressCandidate = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    if (
      lower.includes("ny leveringsadresse") ||
      lower.includes("new shipping address") ||
      lower.includes("updated shipping address")
    ) {
      const inline = line.split(":").slice(1).join(":").trim();
      if (inline && inline.length > 6) return inline;
      const nextLine = lines[index + 1] || "";
      if (nextLine && nextLine.length > 6) return nextLine;
    }
  }
  const correctionMatch =
    text.match(/det\s+skal\s+v[æa]re\s+(.+?)(?:\n|$)/i) ||
    text.match(/should\s+be\s+(.+?)(?:\n|$)/i);
  if (correctionMatch?.[1]) {
    return correctionMatch[1].trim().replace(/[.!?]\s*$/, "");
  }
  return "";
};

const normalizeAddressToken = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const includesAddressPart = (base = "", part = "") => {
  const normalizedBase = normalizeAddressToken(base);
  const normalizedPart = normalizeAddressToken(part);
  if (!normalizedBase || !normalizedPart) return false;
  return normalizedBase.includes(normalizedPart);
};

const enrichAddressWithOrderContext = (candidate = "", shippingAddress = null) => {
  const base = String(candidate || "").trim();
  if (!base || !shippingAddress) return base;

  const zipCity = [shippingAddress?.zip, shippingAddress?.city].filter(Boolean).join(" ").trim();
  const country = String(shippingAddress?.country || "").trim();
  const suffix = [];
  if (zipCity && !includesAddressPart(base, zipCity)) {
    suffix.push(zipCity);
  }
  if (country && !includesAddressPart(base, country)) {
    suffix.push(country);
  }
  if (!suffix.length) return base;
  return `${base}, ${suffix.join(", ")}`;
};

const isLikelyAddressUpdateText = (value = "") => {
  const lower = String(value || "").toLowerCase();
  return (
    lower.includes("shipping address") ||
    lower.includes("leveringsadresse") ||
    lower.includes("address") ||
    lower.includes("adresse")
  );
};

const formatPendingOrderUpdateDetail = ({
  pendingDetail,
  actionType,
  payload,
  draftText,
  aiDraftText,
  threadMessages,
  orderShippingAddress,
}) => {
  const base = String(pendingDetail || "").trim();
  const action = String(actionType || "").toLowerCase();

  if (action === "cancel_order") {
    return base || "Sona wants to cancel this order.";
  }
  if (action === "refund_order") {
    const amount =
      typeof payload?.amount === "number"
        ? payload.amount
        : Number.parseFloat(String(payload?.amount || ""));
    const currency = String(payload?.currency || payload?.currency_code || "").trim();
    if (Number.isFinite(amount)) {
      return `Sona wants to refund ${amount.toFixed(2)}${currency ? ` ${currency}` : ""}.`;
    }
    return base || "Sona wants to refund this order.";
  }
  if (action === "create_exchange_request") {
    return base || "Sona wants to create an exchange request.";
  }
  if (action === "process_exchange_return") {
    return base || "Sona wants to process the created return in Shopify.";
  }
  if (action === "change_shipping_method") {
    const title = String(payload?.title || payload?.shipping_title || "").trim();
    return title
      ? `Sona wants to change shipping method to: ${title}.`
      : base || "Sona wants to change the shipping method.";
  }
  if (action === "hold_or_release_fulfillment") {
    const mode = String(payload?.mode || payload?.operation || "").toLowerCase();
    return mode === "release"
      ? "Sona wants to release fulfillment hold on this order."
      : base || "Sona wants to put this order on fulfillment hold.";
  }
  if (action === "edit_line_items") {
    const summary = String(payload?.edit_summary || payload?.summary || payload?.requested_changes || "").trim();
    return summary ? `Sona wants to edit line items: ${summary}` : base || "Sona wants to edit line items on this order.";
  }
  if (action === "update_customer_contact") {
    const email = String(payload?.email || "").trim();
    const phone = String(payload?.phone || "").trim();
    if (email || phone) {
      const parts = [];
      if (email) parts.push(`email ${email}`);
      if (phone) parts.push(`phone ${phone}`);
      return `Sona wants to update customer contact: ${parts.join(", ")}.`;
    }
    return base || "Sona wants to update customer contact details.";
  }
  if (action === "resend_confirmation_or_invoice") {
    const to = String(payload?.to_email || payload?.email || "").trim();
    return to
      ? `Sona wants to resend confirmation/invoice to ${to}.`
      : base || "Sona wants to resend confirmation or invoice.";
  }
  if (action === "add_tag") {
    const tag = String(payload?.tag || "").trim();
    return tag ? `Sona wants to add the tag: ${tag}.` : base || "Sona wants to add an internal tag.";
  }
  if (action === "add_note" || action === "add_internal_note_or_tag") {
    const note = String(payload?.note || "").trim();
    return note ? `Sona wants to add an internal note: ${note}` : base || "Sona wants to add an internal note.";
  }

  if (!base) return "Sona wants to apply an order update for this customer.";
  const lower = base.toLowerCase();
  const isFailedShippingUpdate =
    lower.includes("failed update shipping address") ||
    lower.includes("ordreopdateringer er deaktiveret") ||
    lower.includes("order updates are disabled");

  const outboundBodies = (threadMessages || [])
    .filter((msg) => msg?.from_me)
    .map((msg) => msg?.body_text || stripHtml(msg?.body_html || ""))
    .filter(Boolean)
    .reverse();
  const inboundBodies = (threadMessages || [])
    .filter((msg) => !msg?.from_me)
    .map((msg) => msg?.body_text || stripHtml(msg?.body_html || ""))
    .filter(Boolean)
    .reverse();
  if (isLikelyAddressUpdateText(base)) {
    const candidate =
      extractAddressCandidate(stripHtml(draftText)) ||
      extractAddressCandidate(stripHtml(aiDraftText)) ||
      outboundBodies.map((text) => extractAddressCandidate(text)).find(Boolean) ||
      inboundBodies.map((text) => extractAddressCandidate(text)).find(Boolean) ||
      "";
    if (candidate) {
      const enriched = enrichAddressWithOrderContext(candidate, orderShippingAddress);
      return `Sona wants to update shipping address to: ${enriched}`;
    }
  }
  if (!isFailedShippingUpdate && isLikelyAddressUpdateText(base)) {
    return "Sona wants to update the shipping address for this order.";
  }
  if (!isFailedShippingUpdate) return base;
  return "Sona wants to update the shipping address for this order.";
};

export function InboxSplitView({ messages = [], threads = [], attachments = [] }) {
  const DRAFT_WAIT_TIMEOUT_MS = 12_000;
  const TAB_STATE_STORAGE_PREFIX = "inbox-open-tabs";
  const [liveThreads, setLiveThreads] = useState(threads || []);
  const [liveMessages, setLiveMessages] = useState(messages || []);
  const [liveAttachments, setLiveAttachments] = useState(attachments || []);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [openThreadIds, setOpenThreadIds] = useState([]);
  const [localNewThread, setLocalNewThread] = useState(null);
  const [draftLogLoading, setDraftLogLoading] = useState(false);
  const [draftLogIdByThread, setDraftLogIdByThread] = useState({});
  const [ticketStateByThread, setTicketStateByThread] = useState({});
  const [readOverrides, setReadOverrides] = useState({});
  const [localSentMessagesByThread, setLocalSentMessagesByThread] = useState({});
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [composerMode, setComposerMode] = useState("reply");
  const [draftValue, setDraftValue] = useState("");
  const [draftValueByThread, setDraftValueByThread] = useState({});
  const [noteValueByThread, setNoteValueByThread] = useState({});
  const [scrollPositionByThread, setScrollPositionByThread] = useState({});
  const [signatureByThread, setSignatureByThread] = useState({});
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [suppressAutoDraftByThread, setSuppressAutoDraftByThread] = useState({});
  const [proposalOnlyByThread, setProposalOnlyByThread] = useState({});
  const [draftReady, setDraftReady] = useState(false);
  const [draftWaitTimedOutByThread, setDraftWaitTimedOutByThread] = useState({});
  const [systemDraftUneditedByThread, setSystemDraftUneditedByThread] = useState({});
  const [manualDraftGeneratingByThread, setManualDraftGeneratingByThread] = useState({});
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [translationModalOpen, setTranslationModalOpen] = useState(false);
  const [draftLogId, setDraftLogId] = useState(null);
  const sendingStartedAtRef = useRef(0);
  const [deletingThread, setDeletingThread] = useState(false);
  const [pendingOrderUpdateByThread, setPendingOrderUpdateByThread] = useState({});
  const [returnCaseByThread, setReturnCaseByThread] = useState({});
  const [orderUpdateDecisionByThread, setOrderUpdateDecisionByThread] = useState({});
  const [orderUpdateSubmittingByThread, setOrderUpdateSubmittingByThread] = useState({});
  const [orderUpdateErrorByThread, setOrderUpdateErrorByThread] = useState({});
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [currentSupabaseUserId, setCurrentSupabaseUserId] = useState(null);
  const [workspaceInboxes, setWorkspaceInboxes] = useState([]);
  const [isWorkspaceTestMode, setIsWorkspaceTestMode] = useState(false);
  const [tabStateReady, setTabStateReady] = useState(false);
  const lastAutoReadThreadIdRef = useRef(null);
  const tabStateHydratedRef = useRef(false);
  const draftLastSavedRef = useRef({});
  const savingDraftRef = useRef(false);
  const draftValueRef = useRef("");
  const selectedThreadIdRef = useRef(null);
  const supabase = useClerkSupabase();
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTitleContent } = useSiteHeaderActions();
  const currentUserName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "You";
  const {
    data: selectedThreadMessagesFromDb,
    refresh: refreshSelectedThreadMessages,
  } = useThreadMessages(selectedThreadId, {
    enabled: Boolean(selectedThreadId) && !String(selectedThreadId || "").startsWith("local-new-ticket-"),
  });
  const activeView = searchParams?.get("view") || "";
  const requestedThreadId = String(searchParams?.get("thread") || "").trim();
  const tabStateStorageKey = useMemo(() => {
    const viewerId = String(currentSupabaseUserId || user?.id || "anonymous").trim();
    return `${TAB_STATE_STORAGE_PREFIX}:${viewerId}`;
  }, [currentSupabaseUserId, user?.id]);

  useEffect(() => {
    setLiveThreads(Array.isArray(threads) ? threads : []);
  }, [threads]);

  useEffect(() => {
    setLiveMessages(Array.isArray(messages) ? messages : []);
  }, [messages]);

  useEffect(() => {
    setLiveAttachments(Array.isArray(attachments) ? attachments : []);
  }, [attachments]);

  useEffect(() => {
    let active = true;
    let polling = false;
    let timerId = null;
    let consecutiveFailures = 0;

    const BASE_POLL_MS = 60_000;
    const HIDDEN_POLL_MS = 180_000;
    const MAX_BACKOFF_MS = 60_000;

    const scheduleNext = (ms) => {
      if (!active) return;
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        refreshInboxData().catch(() => null);
      }, ms);
    };

    const refreshInboxData = async () => {
      if (!active || polling) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        scheduleNext(HIDDEN_POLL_MS);
        return;
      }
      polling = true;
      try {
        const response = await fetch("/api/inbox/live", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          consecutiveFailures += 1;
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            scheduleNext(MAX_BACKOFF_MS);
            return;
          }
          const backoffMs = Math.min(
            BASE_POLL_MS * Math.max(1, 2 ** Math.min(consecutiveFailures, 3)),
            MAX_BACKOFF_MS
          );
          scheduleNext(backoffMs);
          return;
        }
        const payload = await response.json().catch(() => null);
        const threadRows = Array.isArray(payload?.threads) ? payload.threads : [];
        const messageRows = Array.isArray(payload?.messages) ? payload.messages : [];
        const attachmentRows = Array.isArray(payload?.attachments) ? payload.attachments : [];
        if (!active) return;
        if (Array.isArray(threadRows)) {
          setLiveThreads((prev) => {
            if (threadRows.length > 0) return threadRows;
            return prev.length > 0 ? prev : threadRows;
          });
        }
        if (Array.isArray(messageRows)) {
          setLiveMessages((prev) => {
            if (messageRows.length > 0) return messageRows;
            return prev.length > 0 ? prev : messageRows;
          });
        }
        if (Array.isArray(attachmentRows)) {
          setLiveAttachments(attachmentRows);
        }
        consecutiveFailures = 0;
        scheduleNext(BASE_POLL_MS);
      } catch {
        consecutiveFailures += 1;
        const backoffMs = Math.min(
          BASE_POLL_MS * Math.max(1, 2 ** Math.min(consecutiveFailures, 3)),
          MAX_BACKOFF_MS
        );
        scheduleNext(backoffMs);
      } finally {
        polling = false;
      }
    };

    scheduleNext(BASE_POLL_MS);
    const onFocus = () => {
      if (!active || polling) return;
      scheduleNext(0);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user?.id) return;
    const channel = supabase
      .channel(`inbox-thread-updates:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mail_threads" },
        (payload) => {
          const nextThread = payload?.new;
          const nextThreadId = String(nextThread?.id || "").trim();
          if (!nextThreadId) return;
          setLiveThreads((prev) => {
            if (!Array.isArray(prev) || !prev.length) return prev;
            let found = false;
            const updated = prev.map((thread) => {
              if (String(thread?.id || "") !== nextThreadId) return thread;
              found = true;
              return {
                ...thread,
                ...nextThread,
              };
            });
            return found ? updated : prev;
          });
        }
      )
      .subscribe();

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        // noop
      }
      supabase?.removeChannel?.(channel);
    };
  }, [supabase, user?.id]);

  useEffect(() => {
    if (!supabase || !user?.id) return;
    const channel = supabase
      .channel(`inbox-message-updates:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mail_messages" },
        (payload) => {
          const nextMessage = payload?.new;
          const nextMessageId = String(nextMessage?.id || "").trim();
          if (!nextMessageId) return;
          setLiveMessages((prev) => {
            const existing = Array.isArray(prev) ? prev : [];
            if (existing.some((message) => String(message?.id || "") === nextMessageId)) {
              return existing;
            }
            return [...existing, nextMessage];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mail_messages" },
        (payload) => {
          const nextMessage = payload?.new;
          const nextMessageId = String(nextMessage?.id || "").trim();
          if (!nextMessageId) return;
          setLiveMessages((prev) => {
            const existing = Array.isArray(prev) ? prev : [];
            let found = false;
            const updated = existing.map((message) => {
              if (String(message?.id || "") !== nextMessageId) return message;
              found = true;
              return { ...message, ...nextMessage };
            });
            return found ? updated : [...existing, nextMessage];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mail_attachments" },
        (payload) => {
          const nextAttachment = payload?.new;
          const nextAttachmentId = String(nextAttachment?.id || "").trim();
          if (!nextAttachmentId) return;
          setLiveAttachments((prev) => {
            const existing = Array.isArray(prev) ? prev : [];
            if (existing.some((attachment) => String(attachment?.id || "") === nextAttachmentId)) {
              return existing;
            }
            return [...existing, nextAttachment];
          });
        }
      )
      .subscribe();

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        // noop
      }
      supabase?.removeChannel?.(channel);
    };
  }, [supabase, user?.id]);

  useEffect(() => {
    draftValueRef.current = draftValue;
  }, [draftValue]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  const activeNoteValue = selectedThreadId ? noteValueByThread[selectedThreadId] || "" : "";
  const composerValue = composerMode === "note" ? activeNoteValue : draftValue;

  const isLocalThreadId = useCallback(
    (threadId) => String(threadId || "").startsWith("local-new-ticket-"),
    []
  );

  const derivedThreads = useMemo(() => {
    const base = liveThreads?.length
      ? liveThreads
      : deriveThreadsFromMessages(liveMessages);
    return localNewThread ? [localNewThread, ...base] : base;
  }, [liveMessages, liveThreads, localNewThread]);

  const previewThreadIds = useMemo(
    () =>
      derivedThreads
        .map((thread) => String(thread?.id || "").trim())
        .filter(Boolean),
    [derivedThreads]
  );

  const { data: previewMessages } = useThreadPreviewMessages(previewThreadIds, {
    enabled: previewThreadIds.length > 0,
  });

  useEffect(() => {
    setReadOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      derivedThreads.forEach((thread) => {
        const threadId = String(thread?.id || "").trim();
        if (!threadId || !next[threadId]) return;
        const hasUnreadActivity =
          thread?.is_read === false || Number(thread?.unread_count ?? 0) > 0;
        if (!hasUnreadActivity) return;
        delete next[threadId];
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [derivedThreads]);

  useEffect(() => {
    if (!localNewThread) return;
    if (selectedThreadId === localNewThread.id) return;
    setLocalNewThread(null);
  }, [localNewThread, selectedThreadId]);

  useEffect(() => {
    if (tabStateHydratedRef.current) return;
    if (typeof window === "undefined") return;
    if (!derivedThreads.length) return;

    const raw = window.localStorage.getItem(tabStateStorageKey);
    tabStateHydratedRef.current = true;
    if (!raw) {
      setTabStateReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const validIds = new Set(
        derivedThreads
          .map((thread) => String(thread?.id || "").trim())
          .filter((threadId) => threadId && !isLocalThreadId(threadId))
      );
      const savedOpenIds = Array.isArray(parsed?.openThreadIds)
        ? parsed.openThreadIds
            .map((threadId) => String(threadId || "").trim())
            .filter((threadId) => validIds.has(threadId))
        : [];
      const savedSelectedId = String(parsed?.selectedThreadId || "").trim();

      if (savedOpenIds.length) {
        setOpenThreadIds(savedOpenIds);
        setSelectedThreadId(
          savedSelectedId && savedOpenIds.includes(savedSelectedId) ? savedSelectedId : savedOpenIds[0]
        );
      }
    } catch {
      // noop
    } finally {
      setTabStateReady(true);
    }
  }, [derivedThreads, isLocalThreadId, tabStateStorageKey]);

  useEffect(() => {
    if (selectedThreadId) return;
    lastAutoReadThreadIdRef.current = null;
  }, [selectedThreadId]);

  useEffect(() => {
    if (!derivedThreads.length) return;
    setTicketStateByThread((prev) => {
      let changed = false;
      const next = { ...prev };
      derivedThreads.forEach((thread) => {
        if (!thread?.id || isLocalThreadId(thread.id)) return;
        const normalizedStatus = normalizeStatus(thread.status) || "New";
        const normalizedPriority = thread.priority ?? DEFAULT_TICKET_STATE.priority;
        const normalizedAssignee = thread.assignee_id ?? DEFAULT_TICKET_STATE.assignee;
        const existing = next[thread.id];
        if (
          existing &&
          existing.status === normalizedStatus &&
          existing.priority === normalizedPriority &&
          existing.assignee === normalizedAssignee
        ) {
          return;
        }
        next[thread.id] = {
          ...(existing || DEFAULT_TICKET_STATE),
          status: normalizedStatus,
          priority: normalizedPriority,
          assignee: normalizedAssignee,
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [derivedThreads, isLocalThreadId]);

  const messagesByThread = useMemo(() => {
    const map = new Map();
    liveMessages.forEach((message) => {
      const threadId = message.thread_id || message.id;
      if (!threadId) return;
      if (!map.has(threadId)) map.set(threadId, []);
      map.get(threadId).push(message);
    });
    map.forEach((list, key) => {
      map.set(
        key,
        [...list].sort((a, b) => {
          const aTime = new Date(getMessageTimestamp(a)).getTime();
          const bTime = new Date(getMessageTimestamp(b)).getTime();
          return aTime - bTime;
        })
      );
    });
    return map;
  }, [liveMessages]);

  const previewMessagesByThread = useMemo(() => {
    const map = new Map();
    (previewMessages || []).forEach((message) => {
      const threadId = String(message?.thread_id || "").trim();
      if (!threadId) return;
      if (!map.has(threadId)) map.set(threadId, []);
      map.get(threadId).push(message);
    });
    map.forEach((list, key) => {
      map.set(
        key,
        [...list].sort((a, b) => {
          const aTime = new Date(getMessageTimestamp(a)).getTime();
          const bTime = new Date(getMessageTimestamp(b)).getTime();
          return aTime - bTime;
        })
      );
    });
    return map;
  }, [previewMessages]);

  const mailboxEmails = useMemo(() => {
    const emails = new Set();
    liveMessages.forEach((message) => {
      (message.to_emails || []).forEach((email) => emails.add(email));
      (message.cc_emails || []).forEach((email) => emails.add(email));
      (message.bcc_emails || []).forEach((email) => emails.add(email));
    });
    return Array.from(emails);
  }, [liveMessages]);

  const internalSenderNames = useMemo(() => {
    const names = new Set();
    (workspaceMembers || []).forEach((member) => {
      const fullName = [member?.first_name, member?.last_name].filter(Boolean).join(" ").trim();
      if (fullName) names.add(fullName.toLowerCase());
      const email = String(member?.email || "").trim().toLowerCase();
      if (email) names.add(email);
    });
    const currentName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim().toLowerCase();
    if (currentName) names.add(currentName);
    names.add("sona");
    names.add("sona ai");
    return names;
  }, [user?.firstName, user?.lastName, workspaceMembers]);

  const isLikelyInternalSender = useCallback(
    (message) => {
      if (!message) return false;
      if (message?.from_me === true) return true;
      const senderEmail = String(message?.from_email || "").trim().toLowerCase();
      const replyTarget = String(getReplyTargetEmail(message) || "").trim().toLowerCase();
      const senderLabel = String(getSenderLabel(message) || "").trim().toLowerCase();
      const isMailboxEmail = (email = "") =>
        mailboxEmails.some((candidate) => String(candidate || "").trim().toLowerCase() === email);
      const isInternalDomain = (email = "") =>
        /@(acezone\.io|sona-ai\.dk)$/i.test(String(email || ""));

      if (senderEmail && (isMailboxEmail(senderEmail) || isInternalDomain(senderEmail))) return true;
      if (replyTarget && (isMailboxEmail(replyTarget) || isInternalDomain(replyTarget))) return true;
      if (senderLabel && internalSenderNames.has(senderLabel)) return true;
      return false;
    },
    [internalSenderNames, mailboxEmails]
  );

  const isLikelyInternalIdentity = useCallback(
    (nameOrEmail = "") => {
      const value = String(nameOrEmail || "").trim().toLowerCase();
      if (!value) return false;
      if (internalSenderNames.has(value)) return true;
      if (value.includes("acezone support")) return true;
      if (value.includes("support@acezone.io")) return true;
      if (value.endsWith("@acezone.io") || value.endsWith("@sona-ai.dk")) return true;
      return false;
    },
    [internalSenderNames]
  );

  const customerByThread = useMemo(() => {
    const map = {};
    derivedThreads.forEach((thread) => {
      const threadCustomerName = String(thread?.customer_name || "").trim();
      const threadCustomerEmail = String(thread?.customer_email || "").trim();
      const threadSender = threadCustomerName || threadCustomerEmail;
      const threadIdentityIsInternal =
        isLikelyInternalIdentity(threadCustomerName) ||
        isLikelyInternalIdentity(threadCustomerEmail);
      if (
        threadSender &&
        !/^unknown sender$/i.test(threadSender) &&
        !threadIdentityIsInternal
      ) {
        map[thread.id] = threadSender;
        return;
      }

      const liveThreadMessages = messagesByThread.get(thread.id) || [];
      const previewThreadMessages = previewMessagesByThread.get(thread.id) || [];
      const dedupedById = new Map();
      [...liveThreadMessages, ...previewThreadMessages].forEach((message) => {
        const key = String(message?.id || "").trim();
        if (!key) return;
        if (!dedupedById.has(key)) dedupedById.set(key, message);
      });
      const threadMessages = Array.from(dedupedById.values()).sort((a, b) => {
        const aTime = new Date(getMessageTimestamp(a)).getTime();
        const bTime = new Date(getMessageTimestamp(b)).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });

      const latestExternalInbound =
        threadMessages.find(
          (message) =>
            !isLikelyInternalSender(message) &&
            !isOutboundMessage(message, mailboxEmails)
        ) || null;
      const latestExternalAny =
        threadMessages.find((message) => !isLikelyInternalSender(message)) || null;
      const externalCandidate = latestExternalInbound || latestExternalAny || null;
      const senderFromMessages = getSenderLabel(externalCandidate || threadMessages[0]) || "";
      const senderFallback = extractSenderFromThreadSnippet(thread);
      map[thread.id] =
        senderFromMessages && !/^unknown sender$/i.test(senderFromMessages)
          ? senderFromMessages
          : senderFallback || "Unknown sender";
    });
    return map;
  }, [
    derivedThreads,
    isLikelyInternalIdentity,
    isLikelyInternalSender,
    mailboxEmails,
    messagesByThread,
    previewMessagesByThread,
  ]);

  const filteredThreads = useMemo(() => {
    return derivedThreads
      .filter((thread) => {
        const hasLocalState = Object.prototype.hasOwnProperty.call(ticketStateByThread, thread.id);
        const uiState = hasLocalState
          ? ticketStateByThread[thread.id]
          : DEFAULT_TICKET_STATE;
        const effectiveAssignee = hasLocalState
          ? uiState?.assignee ?? null
          : thread.assignee_id ?? null;
        const effectiveStatus = normalizeStatus(
          (hasLocalState ? uiState?.status : null) || thread.status || DEFAULT_TICKET_STATE.status
        );
        const inboxSlug = extractInboxSlugFromTags(thread?.tags || []);
        const isResolved = effectiveStatus === "Solved";
        const inboxBucket = getInboxBucket(thread);

        // Resolved tickets live exclusively in the "Resolved" view.
        if (isResolved && activeView !== "resolved") {
          return false;
        }
        if (!isResolved && activeView === "resolved") {
          return false;
        }

        if (!activeView && inboxBucket === "notification") {
          return false;
        }
        if (activeView === "notifications" && inboxBucket !== "notification") {
          return false;
        }
        if (activeView === "mine") {
          const assignee = String(effectiveAssignee || "");
          const mineIds = new Set([
            String(currentSupabaseUserId || ""),
            String(user?.id || ""),
          ]);
          if (!assignee || !mineIds.has(assignee)) {
            return false;
          }
        }
        if (activeView.startsWith("inbox:")) {
          const targetInbox = activeView.slice("inbox:".length);
          if (!targetInbox || inboxSlug !== targetInbox) return false;
        }
        if (filters.status !== "All" && effectiveStatus !== filters.status) {
          return false;
        }
        const unreadCount = thread.unread_count ?? 0;
        if (filters.unreadsOnly && unreadCount === 0) return false;
        if (filters.query) {
          const query = filters.query.toLowerCase();
          const subject = (thread.subject || "").toLowerCase();
          const snippet = (thread.snippet || "").toLowerCase();
          const customer = (customerByThread[thread.id] || "").toLowerCase();
          if (!subject.includes(query) && !snippet.includes(query) && !customer.includes(query)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const aTs = Date.parse(a?.last_message_at || a?.updated_at || a?.created_at || 0);
        const bTs = Date.parse(b?.last_message_at || b?.updated_at || b?.created_at || 0);
        return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
      });
  }, [
    activeView,
    currentSupabaseUserId,
    customerByThread,
    derivedThreads,
    filters,
    ticketStateByThread,
    user?.id,
  ]);

  useEffect(() => {
    setOpenThreadIds((prev) => {
      if (!prev.length) return prev;
      const validIds = new Set(derivedThreads.map((thread) => String(thread?.id || "").trim()).filter(Boolean));
      const next = prev.filter((threadId) => validIds.has(String(threadId || "").trim()));
      return next.length === prev.length ? prev : next;
    });
  }, [derivedThreads]);

  useEffect(() => {
    if (!requestedThreadId) return;
    const validIds = new Set(
      derivedThreads.map((thread) => String(thread?.id || "").trim()).filter(Boolean)
    );
    if (!validIds.has(requestedThreadId)) return;
    setOpenThreadIds((prev) => (prev.includes(requestedThreadId) ? prev : [requestedThreadId, ...prev]));
    setSelectedThreadId(requestedThreadId);
  }, [derivedThreads, requestedThreadId]);

  useEffect(() => {
    if (!tabStateReady) return;
    if (openThreadIds.length) {
      if (selectedThreadId && openThreadIds.includes(selectedThreadId)) return;
      setSelectedThreadId(openThreadIds[0] || null);
      return;
    }
    const fallbackThreadId = filteredThreads[0]?.id || derivedThreads[0]?.id || null;
    if (!fallbackThreadId) {
      setSelectedThreadId(null);
      return;
    }
    setOpenThreadIds([fallbackThreadId]);
    setSelectedThreadId(fallbackThreadId);
  }, [derivedThreads, filteredThreads, openThreadIds, selectedThreadId, tabStateReady]);

  useEffect(() => {
    if (!tabStateReady) return;
    if (typeof window === "undefined") return;

    const persistedOpenIds = openThreadIds
      .map((threadId) => String(threadId || "").trim())
      .filter((threadId) => threadId && !isLocalThreadId(threadId));
    const persistedSelectedId = String(selectedThreadId || "").trim();
    const payload = {
      openThreadIds: persistedOpenIds,
      selectedThreadId:
        persistedSelectedId && persistedOpenIds.includes(persistedSelectedId)
          ? persistedSelectedId
          : persistedOpenIds[0] || null,
      };
    window.localStorage.setItem(tabStateStorageKey, JSON.stringify(payload));
  }, [isLocalThreadId, openThreadIds, selectedThreadId, tabStateReady, tabStateStorageKey]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    const loadWorkspaceMembers = async () => {
      const response = await fetch("/api/settings/members", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (!active || !response?.ok) {
        if (active) setWorkspaceMembers([]);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      const rows = Array.isArray(payload?.members) ? payload.members : [];
      setWorkspaceMembers(rows);
    };

    loadWorkspaceMembers().catch(() => null);
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!supabase || !user?.id) return;
    let active = true;
    const loadCurrentSupabaseUserId = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("clerk_user_id", user.id)
        .maybeSingle();
      if (!active || error) return;
      setCurrentSupabaseUserId(data?.user_id || null);
    };
    loadCurrentSupabaseUserId().catch(() => null);
    return () => {
      active = false;
    };
  }, [supabase, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const loadWorkspaceInboxes = async () => {
      const response = await fetch("/api/inboxes", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (!active || !response?.ok) return;
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      const inboxes = Array.isArray(payload?.inboxes) ? payload.inboxes : [];
      setWorkspaceInboxes(inboxes);
    };
    loadWorkspaceInboxes().catch(() => null);
    return () => {
      active = false;
    };
  }, [user?.id]);

  const selectedThread = useMemo(
    () => derivedThreads.find((thread) => thread.id === selectedThreadId) || null,
    [derivedThreads, selectedThreadId]
  );
  const openThreads = useMemo(() => {
    return openThreadIds
      .map((threadId) => derivedThreads.find((thread) => thread.id === threadId) || null)
      .filter(Boolean);
  }, [derivedThreads, openThreadIds]);
  const selectedTicketState = ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE;
  const memberLookupById = useMemo(() => {
    const map = new Map();
    (workspaceMembers || []).forEach((member) => {
      const userId = String(member?.user_id || "").trim();
      const clerkUserId = String(member?.clerk_user_id || "").trim();
      if (userId) map.set(userId, member);
      if (clerkUserId) map.set(clerkUserId, member);
    });
    return map;
  }, [workspaceMembers]);
  const knownUserLabelById = useMemo(() => {
    const map = new Map();
    (liveMessages || []).forEach((message) => {
      const userId = String(message?.user_id || "").trim();
      if (!userId || map.has(userId)) return;
      const label = String(getSenderLabel(message) || "").trim();
      if (label) map.set(userId, label);
    });
    (workspaceMembers || []).forEach((member) => {
      const userId = String(member?.user_id || "").trim();
      if (!userId) return;
      const label = getAssigneeLabel(member, userId);
      if (label) map.set(userId, label);
    });
    return map;
  }, [liveMessages, workspaceMembers]);
  const assigneeOptions = useMemo(() => {
    const values = new Set();
    values.add(UNASSIGNED_ASSIGNEE_VALUE);
    (workspaceMembers || []).forEach((member) => {
      const userId = String(member?.user_id || "").trim();
      if (userId) values.add(userId);
    });
    derivedThreads.forEach((thread) => {
      if (thread?.assignee_id) values.add(String(thread.assignee_id));
    });
    if (selectedTicketState?.assignee) {
      values.add(String(selectedTicketState.assignee));
    }

    const resolved = Array.from(values)
      .filter(Boolean)
      .map((value) => {
        if (value === UNASSIGNED_ASSIGNEE_VALUE) {
          return { value, label: "Unassigned" };
        }
        const profile = memberLookupById.get(String(value));
        const knownLabel = knownUserLabelById.get(String(value));
        return {
          value,
          label: profile ? getAssigneeLabel(profile, value) : knownLabel || shortUserId(value),
        };
      });

    const [unassigned, ...rest] = resolved;
    rest.sort((a, b) => a.label.localeCompare(b.label));
    return [unassigned, ...rest];
  }, [
    derivedThreads,
    knownUserLabelById,
    memberLookupById,
    selectedTicketState?.assignee,
    workspaceMembers,
  ]);
  const effectiveMentionUsers = useMemo(() => {
    return (workspaceMembers || [])
      .map((member) => {
        const userId = String(member?.user_id || "").trim();
        if (!userId) return null;
        const fullName = [member?.first_name, member?.last_name].filter(Boolean).join(" ").trim();
        const email = String(member?.email || "").trim();
        return {
          id: userId,
          label: fullName || email || userId,
          email,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [workspaceMembers]);
  const selectedTagLabel = extractCategoryFromTags(selectedThread?.tags || []);
  const selectedInboxSlug = extractInboxSlugFromTags(selectedThread?.tags || []);
  const selectedInboxBucket = getInboxBucket(selectedThread);
  const inboxOptions = useMemo(
    () =>
      (workspaceInboxes || [])
        .map((inbox) => {
          const slug = String(inbox?.slug || "").trim();
          if (!slug) return null;
          return {
            value: slug,
            label: String(inbox?.name || slug),
          };
        })
        .filter(Boolean),
    [workspaceInboxes]
  );
  const assignmentOptions = useMemo(() => {
    const combined = [{ value: UNASSIGNED_ASSIGNEE_VALUE, label: "Unassigned" }];
    assigneeOptions
      .filter((option) => option.value !== UNASSIGNED_ASSIGNEE_VALUE)
      .forEach((option) => {
        combined.push({
          value: `user:${option.value}`,
          label: option.label,
        });
      });
    return combined;
  }, [assigneeOptions]);
  const selectedAssignmentValue = useMemo(() => {
    if (selectedTicketState?.assignee) {
      return `user:${selectedTicketState.assignee}`;
    }
    return UNASSIGNED_ASSIGNEE_VALUE;
  }, [selectedTicketState?.assignee]);
  const unreadThreadCount = useMemo(() => {
    return filteredThreads.filter((thread) => Number(thread?.unread_count ?? 0) > 0).length;
  }, [filteredThreads]);
  const unreadByThread = useMemo(() => {
    const map = {};
    derivedThreads.forEach((thread) => {
      map[thread.id] = Number(thread?.unread_count ?? 0);
    });
    return map;
  }, [derivedThreads]);

  useEffect(() => {
    if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
    let active = true;
    const fetchDraftLogId = async () => {
      const cachedDraftLogId = draftLogIdByThread[selectedThreadId] ?? null;
      if (cachedDraftLogId !== null) {
        setDraftLogId(cachedDraftLogId);
        setDraftLogLoading(false);
        return;
      }
      setDraftLogLoading(true);
      const draftThreadId =
        selectedThread?.provider_thread_id || selectedThread?.id || null;
      if (!supabase || !draftThreadId) {
        if (active) {
          setDraftLogId(null);
          setDraftLogLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("drafts")
        .select("id")
        .eq("thread_id", draftThreadId)
        .eq("platform", selectedThread?.provider || "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setDraftLogId(null);
        setDraftLogLoading(false);
        return;
      }
      const nextId = typeof data?.id === "number" ? data.id : null;
      setDraftLogId(nextId);
      if (nextId) {
        setDraftLogIdByThread((prev) => {
          if (prev?.[selectedThreadId] === nextId) return prev;
          return {
            ...(prev || {}),
            [selectedThreadId]: nextId,
          };
        });
      }
      setDraftLogLoading(false);
    };
    fetchDraftLogId();
    return () => {
      active = false;
    };
  }, [
    isLocalThreadId,
    selectedThread?.id,
    selectedThread?.provider,
    selectedThread?.provider_thread_id,
    selectedThreadId,
    supabase,
    draftLogIdByThread,
  ]);

  useEffect(() => {
    if (isLocalThreadId(selectedThreadId)) return;
    if (!supabase || !selectedThreadId) return;
    const thread = derivedThreads.find((item) => item.id === selectedThreadId);
    if (!thread) return;
    const isNewSelection = lastAutoReadThreadIdRef.current !== selectedThreadId;

    if (isNewSelection && !thread.is_read) {
      setReadOverrides((prev) => ({ ...prev, [selectedThreadId]: true }));
      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThreadId,
          isRead: true,
          unreadCount: 0,
        }),
      }).catch(() => null);
    }

    const currentState = ticketStateByThread[selectedThreadId];
    if (isNewSelection && !thread.is_read && currentState?.status === "New") {
      setTicketStateByThread((prev) => ({
        ...prev,
        [selectedThreadId]: {
          ...prev[selectedThreadId],
          status: "Open",
        },
      }));
      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selectedThreadId, status: "Open" }),
      }).catch(() => null);
    }
    lastAutoReadThreadIdRef.current = selectedThreadId;
  }, [
    currentSupabaseUserId,
    derivedThreads,
    isLocalThreadId,
    selectedThreadId,
    supabase,
    ticketStateByThread,
  ]);

  const rawThreadMessages = useMemo(() => {
    if (!selectedThreadId) return [];
    const base =
      Array.isArray(selectedThreadMessagesFromDb) && selectedThreadMessagesFromDb.length
        ? selectedThreadMessagesFromDb
        : messagesByThread.get(selectedThreadId) || [];
    const local = localSentMessagesByThread[selectedThreadId] || [];
    const byId = new Map();
    [...base, ...local].forEach((message) => {
      const key = message?.id || `${message?.thread_id || "thread"}:${message?.created_at || ""}`;
      if (!key) return;
      byId.set(key, message);
    });
    return Array.from(byId.values()).sort((a, b) => {
      const aTime = new Date(getMessageTimestamp(a)).getTime();
      const bTime = new Date(getMessageTimestamp(b)).getTime();
      return aTime - bTime;
    });
  }, [
    localSentMessagesByThread,
    messagesByThread,
    selectedThreadId,
    selectedThreadMessagesFromDb,
  ]);

  const threadMessages = useMemo(() => {
    return rawThreadMessages.filter((message) => {
      if (message?.is_draft) return false;
      // Hide unsent local draft artifacts (old rows without is_draft flag).
      if (
        message?.from_me &&
        !message?.sent_at &&
        !message?.received_at &&
        !isInternalNoteMessage(message)
      ) {
        return false;
      }
      return true;
    });
  }, [rawThreadMessages]);

  const threadAttachments = useMemo(() => {
    if (!selectedThreadId) return [];
    const messageIdSet = new Set(rawThreadMessages.map((message) => message?.id).filter(Boolean));
    if (!messageIdSet.size) return [];
    return (liveAttachments || []).filter((attachment) =>
      messageIdSet.has(attachment?.message_id)
    );
  }, [liveAttachments, rawThreadMessages, selectedThreadId]);

  const draftMessage = useMemo(() => {
    const reversed = [...rawThreadMessages].reverse();
    return reversed.find((message) => message?.is_draft && message?.from_me) || null;
  }, [rawThreadMessages]);

  const aiDraft = useMemo(() => {
    if (draftMessage) return "";
    const reversed = [...rawThreadMessages].reverse();
    const match = reversed.find((message) => message.ai_draft_text?.trim());
    return match?.ai_draft_text?.trim() || "";
  }, [draftMessage, rawThreadMessages]);

  const customerLookupParams = useMemo(() => {
    const inboundCandidates = [...threadMessages]
      .filter((message) => !isOutboundMessage(message, mailboxEmails))
      .reverse();
    const pickMessageBody = (message) =>
      message?.clean_body_text || message?.body_text || "";
    const inboundWithOrder = inboundCandidates.find((message) => {
      const body = pickMessageBody(message);
      return (
        extractOrderNumber(message?.subject || "") ||
        extractOrderNumber(body)
      );
    });
    const inbound = inboundWithOrder || inboundCandidates[0] || null;
    const email = getReplyTargetEmail(inbound) || null;
    const subject = inbound?.subject || selectedThread?.subject || "";
    const body = pickMessageBody(inbound);
    const orderNumber = extractOrderNumber(subject) || extractOrderNumber(body);
    return {
      email,
      subject,
      orderNumber,
      threadId: selectedThreadId || null,
      sourceMessageId: inbound?.id || null,
    };
  }, [mailboxEmails, selectedThread?.subject, selectedThreadId, threadMessages]);

  const {
    data: customerLookup,
    loading: customerLookupLoading,
    error: customerLookupError,
    refresh: refreshCustomerLookup,
  } = useCustomerLookup({
    ...customerLookupParams,
    enabled:
      Boolean(selectedThreadId) &&
      (insightsOpen || Boolean(pendingOrderUpdateByThread[selectedThreadId])),
  });

  const actions = useMemo(() => {
    return MOCK_ACTIONS.map((action) => ({
      ...action,
      id: `${selectedThreadId || "thread"}-${action.id}`,
      threadId: selectedThreadId || "",
    }));
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    if (isLocalThreadId(selectedThreadId)) return;

    let active = true;
    const loadPendingOrderUpdate = async () => {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(selectedThreadId)}/order-updates/accept`,
        { method: "GET" }
      ).catch(() => null);
      if (!active) return;
      if (!res?.ok) return;
      const payload = await res.json().catch(() => ({}));
      if (!active) return;
      const latestAction = payload?.action || null;
      const latestReturnCase = payload?.returnCase && typeof payload.returnCase === "object"
        ? payload.returnCase
        : null;
      if (latestReturnCase) {
        setReturnCaseByThread((prev) => ({
          ...prev,
          [selectedThreadId]: latestReturnCase,
        }));
      } else {
        setReturnCaseByThread((prev) => {
          if (!prev[selectedThreadId]) return prev;
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
      }
      if (latestAction) {
        const normalizedStatus = String(
          latestAction.normalizedStatus || latestAction.status || ""
        ).toLowerCase();
        const actionType = asString(latestAction.actionType || latestAction.action_type).toLowerCase();
        const actionPayload =
          latestAction?.payload && typeof latestAction.payload === "object"
            ? latestAction.payload
            : {};
        const shouldShowActionCardForType =
          isApprovalManagedActionType(actionType) ||
          normalizedStatus === "pending" ||
          normalizedStatus === "awaiting_approval" ||
          normalizedStatus === "requires_approval";
        if (!shouldShowActionCardForType) {
          setPendingOrderUpdateByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
          setOrderUpdateDecisionByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
          setOrderUpdateErrorByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
          return;
        }
        const isTestModeAction =
          latestAction?.testMode === true ||
          normalizedStatus === "approved_test_mode" ||
          actionPayload?.test_mode === true ||
          actionPayload?.simulated === true;
        const isFailedStatus = normalizedStatus === "failed";
        const actionDetail = isFailedStatus
          ? asString(latestAction?.error) ||
            asString(latestAction?.detail) ||
            "Order action could not be completed."
          : asString(latestAction?.detail) ||
            "Sona wants to apply an order update for this customer.";
        setPendingOrderUpdateByThread((prev) => ({
          ...prev,
          [selectedThreadId]: {
            id: String(latestAction.id || ""),
            detail: actionDetail,
            actionType: actionType || null,
            payload: actionPayload,
            createdAt: latestAction.createdAt || null,
            updatedAt: latestAction.updatedAt || latestAction.createdAt || null,
            status: asString(latestAction.status || latestAction.normalizedStatus) || "pending",
            testMode: isTestModeAction,
            approvedBy: asString(latestAction.approvedBy) || "",
            error: isFailedStatus ? asString(latestAction.error) || actionDetail : null,
          },
        }));
        const decisionFromAction = getDecisionFromActionStatus(latestAction.status);
        setOrderUpdateDecisionByThread((prev) => {
          const next = { ...prev };
          if (decisionFromAction) next[selectedThreadId] = decisionFromAction;
          else delete next[selectedThreadId];
          return next;
        });
        setOrderUpdateErrorByThread((prev) => {
          const next = { ...prev };
          if (String(latestAction.status || "").toLowerCase() === "failed" && latestAction.error) {
            next[selectedThreadId] = String(latestAction.error);
          } else {
            delete next[selectedThreadId];
          }
          return next;
        });
        return;
      }
      setPendingOrderUpdateByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      setOrderUpdateDecisionByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      setOrderUpdateErrorByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
    };

    loadPendingOrderUpdate().catch(() => null);
    return () => {
      active = false;
    };
  }, [
    isLocalThreadId,
    selectedThreadId,
  ]);

  useEffect(() => {
    setDraftValue("");
    setActiveDraftId(null);
    setDraftReady(false);
    if (selectedThreadId) {
      draftLastSavedRef.current[selectedThreadId] = "";
    }
    if (!selectedThreadId) return;
    setDraftValue(String(draftValueByThread[selectedThreadId] || ""));
    if (Object.prototype.hasOwnProperty.call(draftValueByThread, selectedThreadId)) {
      setDraftReady(true);
    }
    setDraftWaitTimedOutByThread((prev) => {
      if (prev[selectedThreadId] === false || !(selectedThreadId in prev)) return prev;
      const next = { ...prev };
      next[selectedThreadId] = false;
      return next;
    });
  }, [draftValueByThread, selectedThreadId]);

  useEffect(() => {
    let active = true;
    const loadDraft = async () => {
      if (isLocalThreadId(selectedThreadId)) {
        setDraftReady(true);
        return;
      }
      if (!selectedThreadId) return;
      if (Object.prototype.hasOwnProperty.call(draftValueByThread, selectedThreadId)) {
        setDraftReady(true);
        return;
      }
      const res = await fetch(`/api/threads/${selectedThreadId}/draft`, {
        method: "GET",
      }).catch(() => null);
      if (!active) return;
      if (!res?.ok) {
        setDraftReady(true);
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!active) return;
      const draft = payload?.draft || null;
      const proposalOnly = payload?.proposal_only === true;
      const signature = String(payload?.signature || "");
      setSignatureByThread((prev) => ({
        ...prev,
        [selectedThreadId]: signature,
      }));
      setProposalOnlyByThread((prev) => ({
        ...prev,
        [selectedThreadId]: proposalOnly,
      }));
      if (proposalOnly) {
        setSuppressAutoDraftByThread((prev) => ({
          ...prev,
          [selectedThreadId]: true,
        }));
        if (selectedThreadIdRef.current === selectedThreadId) {
          setDraftValue("");
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: "",
        }));
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
        setActiveDraftId(null);
        setDraftReady(true);
        return;
      }
      setSuppressAutoDraftByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      const draftText = draft?.body_text || draft?.body_html || "";
      if (draftText) {
        if (selectedThreadIdRef.current === selectedThreadId) {
          setDraftValue(draftText);
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: draftText,
        }));
        draftLastSavedRef.current[selectedThreadId] = draftText.trim();
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: true,
        }));
      } else {
        setDraftValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: "",
        }));
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
      }
      if (draft?.id) {
        setActiveDraftId(draft.id);
      }
      setDraftReady(true);
    };
    loadDraft();
    return () => {
      active = false;
    };
  }, [draftValueByThread, isLocalThreadId, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !draftReady || !aiDraft) return;
    if (proposalOnlyByThread[selectedThreadId]) return;
    if (pendingOrderUpdateByThread[selectedThreadId]) return;
    if (suppressAutoDraftByThread[selectedThreadId]) return;
    if (draftValueRef.current) return;
    setDraftValue(aiDraft);
    setDraftValueByThread((prev) => ({
      ...prev,
      [selectedThreadId]: aiDraft,
    }));
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
  }, [
    aiDraft,
    draftReady,
    pendingOrderUpdateByThread,
    proposalOnlyByThread,
    selectedThreadId,
    suppressAutoDraftByThread,
  ]);

  useEffect(() => {
    if (!selectedThreadId) return;
    if (!suppressAutoDraftByThread[selectedThreadId]) return;
    if (aiDraft || draftMessage) return;
    setSuppressAutoDraftByThread((prev) => {
      if (!prev[selectedThreadId]) return prev;
      const next = { ...prev };
      delete next[selectedThreadId];
      return next;
    });
  }, [aiDraft, draftMessage, selectedThreadId, suppressAutoDraftByThread]);

  useEffect(() => {
    if (!selectedThreadId || !draftReady || !draftMessage) return;
    if (proposalOnlyByThread[selectedThreadId]) return;
    if (pendingOrderUpdateByThread[selectedThreadId]) return;
    if (suppressAutoDraftByThread[selectedThreadId]) return;
    const draftBody = draftMessage.body_text || draftMessage.body_html || "";
    if (draftValueRef.current) return;
    setDraftValue(draftBody);
    setDraftValueByThread((prev) => ({
      ...prev,
      [selectedThreadId]: draftBody,
    }));
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
  }, [
    draftMessage,
    draftReady,
    pendingOrderUpdateByThread,
    proposalOnlyByThread,
    selectedThreadId,
    suppressAutoDraftByThread,
  ]);

  const handleGenerateDraft = useCallback(async () => {
    if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
    if (manualDraftGeneratingByThread[selectedThreadId]) return;
    const threadId = selectedThreadId;

    setManualDraftGeneratingByThread((prev) => ({
      ...prev,
      [threadId]: true,
    }));
    setDraftWaitTimedOutByThread((prev) => ({
      ...prev,
      [threadId]: false,
    }));
    setSuppressAutoDraftByThread((prev) => {
      if (!prev[threadId]) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });

    try {
      const res = await fetch(`/api/threads/${threadId}/generate-draft`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not generate draft.");
      }

      const signature = String(payload?.signature || "");
      if (signature) {
        setSignatureByThread((prev) => ({
          ...prev,
          [threadId]: signature,
        }));
      }

      const draft = payload?.draft || null;
      const proposalOnly = payload?.proposal_only === true;
      setProposalOnlyByThread((prev) => ({
        ...prev,
        [threadId]: proposalOnly,
      }));
      if (proposalOnly) {
        const approvalRes = await fetch(
          `/api/threads/${encodeURIComponent(threadId)}/order-updates/accept`,
          { method: "GET" }
        ).catch(() => null);
        const approvalPayload = approvalRes?.ok
          ? await approvalRes.json().catch(() => ({}))
          : {};
        const latestAction = approvalPayload?.action || null;
        const latestReturnCase =
          approvalPayload?.returnCase && typeof approvalPayload.returnCase === "object"
            ? approvalPayload.returnCase
            : null;
        if (latestReturnCase) {
          setReturnCaseByThread((prev) => ({
            ...prev,
            [threadId]: latestReturnCase,
          }));
        }
        if (latestAction) {
          const normalizedStatus = String(
            latestAction.normalizedStatus || latestAction.status || ""
          ).toLowerCase();
          const actionType = asString(
            latestAction.actionType || latestAction.action_type
          ).toLowerCase();
          const actionPayload =
            latestAction?.payload && typeof latestAction.payload === "object"
              ? latestAction.payload
              : {};
          const isTestModeAction =
            latestAction?.testMode === true ||
            normalizedStatus === "approved_test_mode" ||
            actionPayload?.test_mode === true ||
            actionPayload?.simulated === true;
          const isFailedStatus = normalizedStatus === "failed";
          const actionDetail = isFailedStatus
            ? asString(latestAction?.error) ||
              asString(latestAction?.detail) ||
              "Order action could not be completed."
            : asString(latestAction?.detail) ||
              "Sona wants to apply an order update for this customer.";
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [threadId]: {
              id: String(latestAction.id || ""),
              detail: actionDetail,
              actionType: actionType || null,
              payload: actionPayload,
              createdAt: latestAction.createdAt || null,
              updatedAt: latestAction.updatedAt || latestAction.createdAt || null,
              status:
                asString(latestAction.status || latestAction.normalizedStatus) || "pending",
              testMode: isTestModeAction,
              approvedBy: asString(latestAction.approvedBy) || "",
              error: isFailedStatus ? asString(latestAction.error) || actionDetail : null,
            },
          }));
          const decisionFromAction = getDecisionFromActionStatus(latestAction.status);
          setOrderUpdateDecisionByThread((prev) => {
            const next = { ...prev };
            if (decisionFromAction) next[threadId] = decisionFromAction;
            else delete next[threadId];
            return next;
          });
          setOrderUpdateErrorByThread((prev) => {
            const next = { ...prev };
            if (String(latestAction.status || "").toLowerCase() === "failed" && latestAction.error) {
              next[threadId] = String(latestAction.error);
            } else {
              delete next[threadId];
            }
            return next;
          });
        }
        setSuppressAutoDraftByThread((prev) => ({
          ...prev,
          [threadId]: true,
        }));
        if (selectedThreadIdRef.current === threadId) {
          setDraftValue("");
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [threadId]: "",
        }));
        draftValueRef.current = "";
        draftLastSavedRef.current[threadId] = "";
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [threadId]: false,
        }));
        setActiveDraftId(null);
        toast.success("Action proposal created and is awaiting approval.");
        return;
      }
      setSuppressAutoDraftByThread((prev) => {
        if (!prev[threadId]) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      const draftText = draft?.body_text || draft?.body_html || "";
      if (draftText) {
        if (selectedThreadIdRef.current === threadId) {
          setDraftValue(draftText);
        }
        setDraftValueByThread((prev) => ({
          ...prev,
          [threadId]: draftText,
        }));
        draftValueRef.current = draftText;
        draftLastSavedRef.current[threadId] = draftText.trim();
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [threadId]: true,
        }));
        if (draft?.id) {
          setActiveDraftId(draft.id);
        }
        toast.success("Draft generated.");
      } else if (payload?.skipped) {
        throw new Error(payload?.explanation || payload?.reason || "Draft generation was skipped.");
      } else {
        throw new Error("Draft generation returned no content.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate draft.");
    } finally {
      setManualDraftGeneratingByThread((prev) => {
        if (!prev[threadId]) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
    }
  }, [isLocalThreadId, manualDraftGeneratingByThread, selectedThreadId]);

  const handleDraftChange = useCallback(
    (nextValue, threadIdOverride = null) => {
      const targetThreadId = String(threadIdOverride || selectedThreadId || "").trim();
      if (!targetThreadId) return;
      if (composerMode === "note") {
        setNoteValueByThread((prev) => ({
          ...prev,
          [targetThreadId]: String(nextValue || ""),
        }));
        return;
      }
      if (selectedThreadIdRef.current === targetThreadId) {
        setDraftValue(String(nextValue || ""));
      }
      setDraftValueByThread((prev) => ({
        ...prev,
        [targetThreadId]: String(nextValue || ""),
      }));
      setSystemDraftUneditedByThread((prev) => {
        if (!prev[targetThreadId]) return prev;
        return {
          ...prev,
          [targetThreadId]: false,
        };
      });
    },
    [composerMode, selectedThreadId]
  );

  const handleSignatureChange = useCallback(
    (nextValue, threadIdOverride = null) => {
      const targetThreadId = String(threadIdOverride || selectedThreadId || "").trim();
      if (!targetThreadId) return;
      setSignatureByThread((prev) => ({
        ...prev,
        [targetThreadId]: String(nextValue || ""),
      }));
    },
    [selectedThreadId]
  );

  const handleFiltersChange = (updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const handleViewAllTickets = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    if (typeof window !== "undefined") {
      window.open("/inbox/tickets", "_blank", "noopener,noreferrer");
      return;
    }
    router.push("/inbox/tickets");
  }, [router]);

  const openThreadInWorkspace = useCallback(
    (threadId, options = {}) => {
      const nextThreadId = String(threadId || "").trim();
      if (!nextThreadId) return;
      const shouldOpenInNewTab = Boolean(options?.newTab);

      setOpenThreadIds((prev) => {
        if (prev.includes(nextThreadId)) return prev;
        if (!prev.length) return [nextThreadId];

        const currentIndex = prev.indexOf(selectedThreadId);
        if (shouldOpenInNewTab || currentIndex === -1 || !selectedThreadId) {
          const next = [...prev];
          const insertAt = currentIndex === -1 ? next.length : currentIndex + 1;
          next.splice(insertAt, 0, nextThreadId);
          return next;
        }

        const next = [...prev];
        next[currentIndex] = nextThreadId;
        return Array.from(new Set(next));
      });

      setSelectedThreadId(nextThreadId);
    },
    [selectedThreadId]
  );

  const closeThreadTab = useCallback(
    (threadId) => {
      const closingThreadId = String(threadId || "").trim();
      if (!closingThreadId) return;
      if (isLocalThreadId(closingThreadId)) {
        setLocalNewThread((prev) => (prev?.id === closingThreadId ? null : prev));
      }
      setOpenThreadIds((prev) => {
        const currentIndex = prev.indexOf(closingThreadId);
        if (currentIndex === -1) return prev;
        const next = prev.filter((id) => id !== closingThreadId);
        if (selectedThreadId === closingThreadId) {
          const replacement = next[currentIndex] || next[currentIndex - 1] || null;
          setSelectedThreadId(replacement);
        }
        return next;
      });
    },
    [isLocalThreadId, selectedThreadId]
  );

  const handleCreateTicket = useCallback(() => {
    const nowIso = new Date().toISOString();
    const id = `local-new-ticket-${Date.now()}`;
    const nextThread = {
      id,
      subject: "New ticket",
      snippet: "",
      status: "New",
      unread_count: 0,
      is_read: true,
      last_message_at: nowIso,
      updated_at: nowIso,
      created_at: nowIso,
      tags: [],
      is_local: true,
    };
    setLocalNewThread(nextThread);
    setOpenThreadIds((prev) => [...prev, id]);
    setSelectedThreadId(id);
    setDraftValue("");
    setDraftValueByThread((prev) => ({ ...prev, [id]: "" }));
    setActiveDraftId(null);
    setDraftReady(true);
    setComposerMode("reply");
  }, []);

  useEffect(() => {
    setTitleContent(
      <div className="flex min-w-0 flex-1 items-center">
        <div className="hidden h-10 shrink-0 items-center justify-end gap-3 bg-white px-3 lg:flex lg:w-[clamp(18rem,20vw,24rem)] lg:min-w-[clamp(18rem,20vw,24rem)] lg:max-w-[clamp(18rem,20vw,24rem)]">
          <button
            type="button"
            onClick={handleViewAllTickets}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition hover:text-slate-800"
          >
            View all
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          {unreadThreadCount > 0 ? (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">
              {unreadThreadCount}
            </span>
          ) : null}
        </div>
        <WorkspaceTabsRow
          tabs={openThreads}
          activeThreadId={selectedThreadId}
          unreadByThread={unreadByThread}
          onSelectTab={setSelectedThreadId}
          onCloseTab={closeThreadTab}
          onAddTab={handleCreateTicket}
          inline
        />
      </div>
    );
    return () => setTitleContent(null);
  }, [
    closeThreadTab,
    handleViewAllTickets,
    handleCreateTicket,
    openThreads,
    selectedThreadId,
    setTitleContent,
    unreadByThread,
    unreadThreadCount,
  ]);

  useEffect(() => {
    if (activeView === "" && filters.status === "Solved") {
      setFilters((prev) => ({ ...prev, status: "All" }));
    }
  }, [activeView, filters.status]);

  const handleTicketStateChange = useCallback((updates) => {
    if (!selectedThreadId) return;
    setTicketStateByThread((prev) => ({
      ...prev,
      [selectedThreadId]: {
        ...prev[selectedThreadId],
        ...updates,
      },
    }));
    const payload = {};
    if (typeof updates.status === "string") {
      payload.status = updates.status;
    }
    if (typeof updates.priority === "string" || updates.priority === null) {
      payload.priority = updates.priority;
    }
    if (typeof updates.assignee === "string" || updates.assignee === null) {
      payload.assigneeId = updates.assignee;
    }
    if (!Object.keys(payload).length) return;

    fetch("/api/inbox/thread-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: selectedThreadId,
        ...payload,
      }),
    })
      .then(async (response) => {
        if (response.ok) return;
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not update ticket status.");
      })
      .catch((error) => {
        toast.error(error.message || "Could not update ticket status.");
      });
  }, [selectedThreadId]);

  const handleInboxChange = useCallback(
    (destination) => {
      if (!selectedThreadId) return;
      const normalized =
        typeof destination?.inboxSlug === "string" ? destination.inboxSlug.trim() : "";
      const nextClassificationKey =
        String(destination?.classificationKey || "support").trim().toLowerCase() ===
        "notification"
          ? "notification"
          : "support";
      const previousThread =
        derivedThreads.find((thread) => thread.id === selectedThreadId) || null;
      const previousTags = previousThread?.tags || [];
      const previousClassificationKey = previousThread?.classification_key || null;
      const previousClassificationConfidence = previousThread?.classification_confidence ?? null;
      const previousClassificationReason = previousThread?.classification_reason || null;
      setLiveThreads((prev) =>
        (prev || []).map((thread) => {
          if (thread.id !== selectedThreadId) return thread;
          const tags = Array.isArray(thread.tags) ? thread.tags : [];
          const withoutInbox = tags.filter((tag) => !String(tag || "").startsWith("inbox:"));
          return {
            ...thread,
            tags: normalized ? [...withoutInbox, toInboxTag(normalized)] : withoutInbox,
            classification_key: nextClassificationKey,
            classification_confidence: 1,
            classification_reason:
              nextClassificationKey === "notification"
                ? "manual_move_to_notifications"
                : "manual_move_to_tickets",
          };
        })
      );

      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThreadId,
          inboxSlug: normalized || null,
          classificationKey: nextClassificationKey,
        }),
      })
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (response.ok && data?.thread?.id) return;
          throw new Error(data?.error || "Could not update inbox.");
        })
        .catch((error) => {
          setLiveThreads((prev) =>
            (prev || []).map((thread) => {
              if (thread.id !== selectedThreadId) return thread;
              return {
                ...thread,
                tags: Array.isArray(previousTags) ? previousTags : [],
                classification_key: previousClassificationKey,
                classification_confidence: previousClassificationConfidence,
                classification_reason: previousClassificationReason,
              };
            })
          );
          toast.error(error.message || "Could not update inbox.");
        });
    },
    [derivedThreads, selectedThreadId]
  );
  const handleAssignmentChange = useCallback(
    (value) => {
      const selected = String(value || "");
      if (!selected || selected === UNASSIGNED_ASSIGNEE_VALUE) {
        handleTicketStateChange({ assignee: null });
        return;
      }
      if (selected.startsWith("user:")) {
        handleTicketStateChange({ assignee: selected.slice("user:".length) || null });
      }
    },
    [handleTicketStateChange]
  );

  const saveThreadDraft = useCallback(async ({ immediate = false, valueOverride, threadIdOverride } = {}) => {
    const threadId = String(threadIdOverride || selectedThreadId || "").trim();
    if (!threadId) return;
    if (isLocalThreadId(threadId)) return;
    if (composerMode === "note") return;
    if (!draftReady) return;
    const fallbackValue =
      threadId === selectedThreadIdRef.current ? draftValueRef.current : draftValueByThread[threadId] || "";
    const text = String(valueOverride ?? fallbackValue ?? "");
    const trimmed = text.trim();
    if (!trimmed) {
      if (!immediate || savingDraftRef.current) return;
      let deleteSucceeded = false;
      try {
        const res = await fetch(`/api/threads/${threadId}/draft`, {
          method: "DELETE",
        });
        deleteSucceeded = Boolean(res?.ok);
      } catch {
        // ignore delete draft errors in UI flow
      }
      if (selectedThreadIdRef.current === threadId) {
        setActiveDraftId(null);
        setDraftValue("");
      }
      setDraftValueByThread((prev) => ({
        ...prev,
        [threadId]: "",
      }));
      setSystemDraftUneditedByThread((prev) => ({
        ...prev,
        [threadId]: false,
      }));
      draftLastSavedRef.current[threadId] = "";
      setSuppressAutoDraftByThread((prev) => ({
        ...prev,
        [threadId]: true,
      }));
      if (deleteSucceeded && threadId === selectedThreadIdRef.current) {
        refreshSelectedThreadMessages?.().catch(() => null);
      }
      return;
    }
    if (!immediate && trimmed === String(draftLastSavedRef.current[threadId] || "")) return;
    if (savingDraftRef.current) return;
    savingDraftRef.current = true;
    try {
      const subject =
        derivedThreads.find((thread) => String(thread?.id || "").trim() === threadId)?.subject || "";
      const res = await fetch(`/api/threads/${threadId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: text,
          subject,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not save draft.");
      }
      draftLastSavedRef.current[threadId] = trimmed;
      if (data?.draft_id && selectedThreadIdRef.current === threadId) {
        setActiveDraftId(data.draft_id);
      }
    } catch {
      // keep UI responsive; autosave retries on next change/interval
    } finally {
      savingDraftRef.current = false;
    }
  }, [
    composerMode,
    draftReady,
    draftValueByThread,
    derivedThreads,
    isLocalThreadId,
    selectedThreadId,
    refreshSelectedThreadMessages,
  ]);

  const handleSelectThreadInWorkspace = useCallback(
    (threadId, options = {}) => {
      saveThreadDraft({ immediate: true, valueOverride: draftValueRef.current });
      openThreadInWorkspace(threadId, options);
    },
    [openThreadInWorkspace, saveThreadDraft]
  );

  useEffect(() => {
    if (isLocalThreadId(selectedThreadId)) return;
    if (!selectedThreadId || !draftReady) return;
    const timer = setInterval(() => {
      saveThreadDraft({ immediate: false, valueOverride: draftValueRef.current });
    }, 4000);
    return () => clearInterval(timer);
  }, [draftReady, isLocalThreadId, saveThreadDraft, selectedThreadId]);

  useEffect(() => {
    let active = true;
    const loadTestMode = async () => {
      const res = await fetch("/api/settings/test-mode", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (!active || !res?.ok) return;
      const payload = await res.json().catch(() => ({}));
      if (!active) return;
      setIsWorkspaceTestMode(Boolean(payload?.test_mode));
    };
    loadTestMode().catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  const handleSendDraft = async (payload = {}) => {
    if (isSending) return;
    if (!selectedThreadId) {
      toast.error("No thread selected.");
      return;
    }
    if (isLocalThreadId(selectedThreadId)) {
      toast.error("Saving/sending brand new tickets is not ready yet.");
      return;
    }
    const composeMode =
      payload?.mode === "note" || composerMode === "note"
        ? "note"
        : payload?.mode === "forward" || composerMode === "forward"
        ? "forward"
        : "reply";
    const composeBody = String(composeMode === "note" ? activeNoteValue : draftValue || "");
    if (!composeBody.trim()) {
      toast.error("Draft is empty.");
      return;
    }
    sendingStartedAtRef.current = Date.now();
    setIsSending(true);
    const toastId = toast.loading(
      composeMode === "note"
        ? "Saving note..."
        : composeMode === "forward"
        ? "Forwarding email..."
        : "Sending draft..."
    );
    try {
      if (composeMode === "note") {
        const res = await fetch(`/api/threads/${selectedThreadId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body_text: composeBody,
            mention_user_ids: Array.isArray(payload?.mentionUserIds)
              ? payload.mentionUserIds.filter((value) => isUuid(value))
              : [],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Could not save internal note.");
        }
        const nowIso = new Date().toISOString();
        const noteMessage = data?.message
          ? data.message
          : {
              id: `local-note-${Date.now()}`,
              provider_message_id: `internal-note:local-${Date.now()}`,
              thread_id: selectedThreadId,
              user_id: currentSupabaseUserId || null,
              from_name: currentUserName,
              from_email: null,
              from_me: true,
              body_text: composeBody,
              body_html: null,
              is_read: true,
              is_draft: false,
              sent_at: null,
              received_at: null,
              created_at: nowIso,
            };
        setLocalSentMessagesByThread((prev) => ({
          ...prev,
          [selectedThreadId]: [...(prev[selectedThreadId] || []), noteMessage],
        }));
        toast.success("Internal note saved.", { id: toastId });
        setNoteValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: "",
        }));
        return;
      }

      const rawAttachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      const serializedAttachments = await Promise.all(
        rawAttachments.map(async (file) => {
          if (!file || typeof file.arrayBuffer !== "function") return null;
          const name = String(file.name || "").trim() || "attachment";
          const mimeType = String(file.type || "").trim() || "application/octet-stream";
          const sizeBytes = Number(file.size || 0);
          if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
          if (sizeBytes > 15 * 1024 * 1024) {
            throw new Error(`Attachment "${name}" is larger than 15 MB.`);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const chunkSize = 0x8000;
          let binary = "";
          for (let index = 0; index < bytes.length; index += chunkSize) {
            const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
            binary += String.fromCharCode(...chunk);
          }
          const contentBase64 = btoa(binary);
          return {
            filename: name,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            content_base64: contentBase64,
          };
        })
      );
      const attachmentsPayload = serializedAttachments.filter(Boolean);

      const res = await fetch(`/api/threads/${selectedThreadId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: composeBody,
          signature: typeof payload?.signature === "string" ? payload.signature : "",
          to_emails: payload.toRecipients,
          cc_emails: payload.ccRecipients,
          bcc_emails: payload.bccRecipients,
          attachments: attachmentsPayload,
          sender_name: currentUserName,
          draft_message_id: draftMessage?.id || activeDraftId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not send reply.");
      }
      const nowIso = new Date().toISOString();
      const localMessageId = data?.message_id || `local-sent-${Date.now()}`;
      const redirectedTo =
        data?.redirected_to && typeof data.redirected_to === "string"
          ? [String(data.redirected_to)]
          : null;
      const localTo = redirectedTo || payload.toRecipients || [];
      const localCc = redirectedTo ? [] : payload.ccRecipients || [];
      const localBcc = redirectedTo ? [] : payload.bccRecipients || [];
      setLocalSentMessagesByThread((prev) => ({
        ...prev,
        [selectedThreadId]: [
          ...(prev[selectedThreadId] || []),
          {
            id: localMessageId,
            thread_id: selectedThreadId,
            user_id: currentSupabaseUserId || null,
            from_name: currentUserName,
            from_email: mailboxEmails[0] || "",
            from_me: true,
            to_emails: localTo,
            cc_emails: localCc,
            bcc_emails: localBcc,
            body_text: String(payload?.signature || "").trim()
              ? `${composeBody}\n\n${String(payload.signature).trim()}`
              : composeBody,
            body_html: null,
            is_read: true,
            sent_at: nowIso,
            received_at: null,
            created_at: nowIso,
            attachments: attachmentsPayload.map((attachment, index) => ({
              id: `local-attachment-${Date.now()}-${index}`,
              message_id: localMessageId,
              filename: attachment.filename,
              mime_type: attachment.mime_type,
              size_bytes: attachment.size_bytes,
            })),
          },
        ],
      }));
      const providerId = data?.provider_message_id ? ` (${data.provider_message_id})` : "";
      if (data?.simulated) {
        toast.success(
          data?.message ||
            "Email simulated: Test Mode is enabled and no Test Email Address is configured.",
          { id: toastId }
        );
      } else if (data?.test_mode && data?.redirected_to) {
        toast.success(`Reply sent to ${data.redirected_to} (Test Mode).${providerId}`, {
          id: toastId,
        });
      } else {
        toast.success(
          composeMode === "forward"
            ? `Forward sent${providerId}.`
            : `Reply sent${providerId}.`,
          { id: toastId }
        );
      }
      if (composeMode !== "note") {
        setTicketStateByThread((prev) => ({
          ...prev,
          [selectedThreadId]: {
            ...(prev[selectedThreadId] || DEFAULT_TICKET_STATE),
            status: "Pending",
          },
        }));
        setLiveThreads((prev) =>
          (prev || []).map((thread) =>
            thread?.id === selectedThreadId
              ? { ...thread, status: "pending", updated_at: nowIso }
              : thread
          )
        );
        fetch("/api/inbox/thread-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: selectedThreadId, status: "Pending" }),
        }).catch(() => null);
      }
      if (selectedThreadIdRef.current === selectedThreadId) {
        setDraftValue("");
      }
      setDraftValueByThread((prev) => ({
        ...prev,
        [selectedThreadId]: "",
      }));
      setActiveDraftId(null);
      draftLastSavedRef.current[selectedThreadId] = "";
      setSystemDraftUneditedByThread((prev) => ({
        ...prev,
        [selectedThreadId]: false,
      }));
      setSuppressAutoDraftByThread((prev) => ({
        ...prev,
        [selectedThreadId]: true,
      }));
    } catch (err) {
      toast.error(err?.message || "Could not send draft.", { id: toastId });
    } finally {
      const elapsed = Date.now() - (sendingStartedAtRef.current || 0);
      const delay = Math.max(0, 600 - elapsed);
      if (delay) {
        setTimeout(() => setIsSending(false), delay);
      } else {
        setIsSending(false);
      }
    }
  };

  const deleteThreadById = useCallback(async (threadId) => {
    if (!threadId || deletingThread) return;
    if (isLocalThreadId(threadId)) {
      setLocalNewThread(null);
      setOpenThreadIds((prev) => prev.filter((openThreadId) => openThreadId !== threadId));
      if (selectedThreadId === threadId) {
        setSelectedThreadId(null);
      }
      setDraftValue("");
      setDraftValueByThread((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      setActiveDraftId(null);
      return;
    }
    const confirmed = window.confirm("Are you sure you want to delete this ticket? This cannot be undone.");
    if (!confirmed) return;
    setDeletingThread(true);
    try {
      const res = await fetch(`/api/threads/${threadId}/delete`, {
        method: "DELETE",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not delete ticket.");
      }
      toast.success("Ticket deleted.");
      setOpenThreadIds((prev) => prev.filter((openThreadId) => openThreadId !== threadId));
      if (selectedThreadId === threadId) {
        setSelectedThreadId(null);
      }
      setDraftValue("");
      setDraftValueByThread((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      setActiveDraftId(null);
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (error) {
      toast.error(error?.message || "Could not delete ticket.");
    } finally {
      setDeletingThread(false);
    }
  }, [deletingThread, isLocalThreadId, selectedThreadId]);

  const handleDeleteThread = useCallback(() => {
    if (!selectedThreadId) return;
    deleteThreadById(selectedThreadId);
  }, [deleteThreadById, selectedThreadId]);

  const handleOrderUpdateDecision = useCallback(
    async (decision, options = undefined) => {
      if (!selectedThreadId) return;
      const normalized = decision === "accepted" ? "accepted" : "denied";
      const pending = pendingOrderUpdateByThread[selectedThreadId];
      if (!pending) {
        toast.error("No pending order update found.");
        return;
      }

      if (orderUpdateSubmittingByThread[selectedThreadId]) return;
      setOrderUpdateSubmittingByThread((prev) => ({
        ...prev,
        [selectedThreadId]: true,
      }));
      setOrderUpdateErrorByThread((prev) => {
        const next = { ...prev };
        delete next[selectedThreadId];
        return next;
      });
      const toastId = toast.loading("Applying action...");
      try {
        const nowIso = new Date().toISOString();
        const pendingId = String(pending.id || "").trim();
        const pendingLooksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          pendingId
        );
        const res = await fetch(`/api/threads/${selectedThreadId}/order-updates/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: normalized === "accepted" ? "accepted" : "declined",
            actionId: pendingLooksLikeUuid ? pendingId : null,
            proposalLogId: pendingLooksLikeUuid ? null : pending.id || null,
            proposalText: pending.detail || "",
            payloadOverride:
              options && typeof options === "object" && Object.keys(options).length
                ? options
                : null,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Could not update action.");
        }
        if (normalized === "accepted" && (payload?.testMode || payload?.simulated)) {
          const testModeMessage = String(
            payload?.message ||
              "Action approved, but no changes were made because Test Mode is enabled."
          );
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(pending.id || ""),
              detail: testModeMessage,
              actionType: pending.actionType || null,
              payload:
                pending.payload && typeof pending.payload === "object" ? pending.payload : {},
              createdAt: pending.createdAt || null,
              updatedAt: payload?.approvedAt || nowIso,
              status: "approved_test_mode",
              testMode: true,
              approvedBy: currentUserName,
              error: null,
            },
          }));
        }
        if (payload?.blocked) {
          const blockedReason = String(
            payload?.reason || "Action could not be applied because the order cannot be changed."
          );
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(pending.id || ""),
              detail: blockedReason,
              actionType: pending.actionType || null,
              payload: pending.payload && typeof pending.payload === "object" ? pending.payload : {},
              createdAt: pending.createdAt || null,
              updatedAt: payload?.approvedAt || nowIso,
              status: "failed",
              testMode: false,
              error: blockedReason,
            },
          }));
          setOrderUpdateErrorByThread((prev) => ({
            ...prev,
            [selectedThreadId]: blockedReason,
          }));
          setOrderUpdateDecisionByThread((prev) => {
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });

          if (payload?.draftGenerated) {
            const draftRes = await fetch(`/api/threads/${selectedThreadId}/draft`, {
              method: "GET",
            }).catch(() => null);
            if (draftRes?.ok) {
              const draftPayload = await draftRes.json().catch(() => ({}));
              const draft = draftPayload?.draft || null;
              const draftText = draft?.body_text || draft?.body_html || "";
              if (draftText) {
                if (selectedThreadIdRef.current === selectedThreadId) {
                  setDraftValue(draftText);
                }
                draftLastSavedRef.current[selectedThreadId] = draftText.trim();
                setSystemDraftUneditedByThread((prev) => ({
                  ...prev,
                  [selectedThreadId]: true,
                }));
              }
              if (draft?.id) setActiveDraftId(draft.id);
            }
          }

          toast.error(blockedReason, { id: toastId });
          return;
        }
        if (payload?.returnCase && typeof payload.returnCase === "object") {
          setReturnCaseByThread((prev) => ({
            ...prev,
            [selectedThreadId]: payload.returnCase,
          }));
        }
        const followUp = payload?.followUpAction || null;
        if (
          followUp &&
          typeof followUp === "object" &&
          String(followUp?.status || "").toLowerCase() === "pending"
        ) {
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(followUp.id || ""),
              detail: asString(followUp.detail) || "Process return in Shopify.",
              actionType: asString(followUp.actionType || followUp.action_type) || null,
              payload:
                followUp?.payload && typeof followUp.payload === "object" ? followUp.payload : {},
              createdAt: followUp.createdAt || null,
              updatedAt: followUp.updatedAt || followUp.createdAt || null,
              status: "pending",
              testMode: false,
              error: null,
            },
          }));
          setOrderUpdateDecisionByThread((prev) => {
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
        } else {
          if (normalized === "accepted") {
            setPendingOrderUpdateByThread((prev) => ({
              ...prev,
              [selectedThreadId]: {
                ...pending,
                status: payload?.testMode || payload?.simulated ? "approved_test_mode" : "applied",
                detail: asString(payload?.detail) || pending.detail || "",
                updatedAt: payload?.approvedAt || nowIso,
                approvedBy: currentUserName,
                testMode: Boolean(payload?.testMode || payload?.simulated),
                error: null,
              },
            }));
          }
          setOrderUpdateDecisionByThread((prev) => ({
            ...prev,
            [selectedThreadId]: normalized,
          }));
        }
        setOrderUpdateErrorByThread((prev) => {
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
        if (normalized === "accepted") {
          if (payload?.testMode || payload?.simulated) {
            toast.success(
              payload?.message ||
                "Action approved, but no changes were made because Test Mode is enabled.",
              { id: toastId }
            );
          } else {
            toast.success("Action approved and applied.", { id: toastId });
          }
          if (payload?.draftGenerated) {
            const draftRes = await fetch(`/api/threads/${selectedThreadId}/draft`, {
              method: "GET",
            }).catch(() => null);
            if (draftRes?.ok) {
              const draftPayload = await draftRes.json().catch(() => ({}));
              const draft = draftPayload?.draft || null;
              const sig = String(draftPayload?.signature || "");
              const draftText = draft?.rendered_body_text || draft?.body_text || draft?.body_html || "";
              if (draftText) {
                if (selectedThreadIdRef.current === selectedThreadId) {
                  setDraftValue(draftText);
                }
                draftValueRef.current = draftText;
                draftLastSavedRef.current[selectedThreadId] = draftText.trim();
                setDraftValueByThread((prev) => ({ ...prev, [selectedThreadId]: draftText }));
                setSystemDraftUneditedByThread((prev) => ({ ...prev, [selectedThreadId]: true }));
              }
              if (draft?.id) setActiveDraftId(draft.id);
              if (sig) setSignatureByThread((prev) => ({ ...prev, [selectedThreadId]: sig }));
            }
          }
        } else {
          toast.success("Order update denied.", { id: toastId });
        }
      } catch (error) {
        const message = error?.message || "Could not update action.";
        setOrderUpdateErrorByThread((prev) => ({
          ...prev,
          [selectedThreadId]: message,
        }));
        toast.error(error?.message || "Could not update action.", { id: toastId });
      } finally {
        setOrderUpdateSubmittingByThread((prev) => ({
          ...prev,
          [selectedThreadId]: false,
        }));
      }
    },
    [currentUserName, orderUpdateSubmittingByThread, pendingOrderUpdateByThread, selectedThreadId]
  );


  const getThreadTimestamp = (thread) => thread.last_message_at || "";

  const getThreadUnreadCount = (thread) => {
    if (readOverrides[thread.id] || thread.is_read) return 0;
    return thread.unread_count || 0;
  };

  const selectedPendingOrderUpdate = useMemo(() => {
    if (!selectedThreadId) return null;
    const pending = pendingOrderUpdateByThread[selectedThreadId];
    if (!pending) return null;
    return {
      ...pending,
      detail: formatPendingOrderUpdateDetail({
        pendingDetail: pending.detail,
        actionType: pending.actionType,
        payload: pending.payload,
        draftText: draftValue,
        aiDraftText: aiDraft,
        threadMessages: rawThreadMessages,
        orderShippingAddress: customerLookup?.orders?.[0]?.shippingAddress || null,
      }),
    };
  }, [
    aiDraft,
    customerLookup?.orders,
    draftValue,
    pendingOrderUpdateByThread,
    rawThreadMessages,
    selectedThreadId,
  ]);

  const latestThreadMessage = useMemo(
    () => (threadMessages.length ? threadMessages[threadMessages.length - 1] : null),
    [threadMessages]
  );
  const latestMessageIsInbound = latestThreadMessage
    ? !isOutboundMessage(latestThreadMessage, mailboxEmails)
    : false;
  const hasDraftContentReady =
    Boolean(draftMessage) || Boolean(aiDraft) || Boolean(String(draftValue || "").trim());
  const pendingDecisionForSelectedThread = selectedThreadId
    ? pendingOrderUpdateByThread[selectedThreadId]
    : null;
  const isWaitingForApproval =
    Boolean(pendingDecisionForSelectedThread) &&
    !["accepted", "denied"].includes(
      String(orderUpdateDecisionByThread[selectedThreadId] || "").toLowerCase()
    );

  const isDraftGenerating =
    Boolean(selectedThreadId) &&
    !isLocalThreadId(selectedThreadId) &&
    Boolean(manualDraftGeneratingByThread[selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    if (isLocalThreadId(selectedThreadId)) return;
    if (suppressAutoDraftByThread[selectedThreadId]) return;
    if (draftWaitTimedOutByThread[selectedThreadId]) return;
    if (!latestMessageIsInbound) return;
    if (hasDraftContentReady) return;
    if (isWaitingForApproval) return;

    const timerId = setTimeout(() => {
      setDraftWaitTimedOutByThread((prev) => ({
        ...prev,
        [selectedThreadId]: true,
      }));
    }, DRAFT_WAIT_TIMEOUT_MS);

    return () => clearTimeout(timerId);
  }, [
    DRAFT_WAIT_TIMEOUT_MS,
    draftWaitTimedOutByThread,
    hasDraftContentReady,
    isLocalThreadId,
    isWaitingForApproval,
    latestMessageIsInbound,
    selectedThreadId,
    suppressAutoDraftByThread,
  ]);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-sidebar lg:flex-row">
      <TicketList
        threads={filteredThreads}
        selectedThreadId={selectedThreadId}
        ticketStateByThread={ticketStateByThread}
        customerByThread={customerByThread}
        onSelectThread={handleSelectThreadInWorkspace}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        getTimestamp={getThreadTimestamp}
        getUnreadCount={getThreadUnreadCount}
        onCreateTicket={handleCreateTicket}
        onOpenInNewTab={(threadId) => handleSelectThreadInWorkspace(threadId, { newTab: true })}
        onDeleteThread={deleteThreadById}
        hideSolvedFilter={activeView === ""}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar">
        <TicketDetail
          thread={selectedThread}
          messages={threadMessages}
          attachments={threadAttachments}
          customerLookup={customerLookup}
          threadOrderNumber={customerLookupParams.orderNumber || ""}
          mentionUsers={effectiveMentionUsers}
          currentUserName={currentUserName}
          ticketState={ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE}
          onTicketStateChange={handleTicketStateChange}
          onOpenInsights={() => setInsightsOpen(true)}
          showThinkingCard={isDraftGenerating}
          draftValue={composerValue}
          onDraftChange={handleDraftChange}
          signatureValue={selectedThreadId ? signatureByThread[selectedThreadId] || "" : ""}
          onSignatureChange={handleSignatureChange}
          onSignatureBlur={() => null}
          onDraftBlur={(threadId) =>
            saveThreadDraft({
              immediate: true,
              threadIdOverride: threadId,
              valueOverride:
                String(threadId || "") === String(selectedThreadIdRef.current || "")
                  ? draftValueRef.current
                  : draftValueByThread[String(threadId || "").trim()] || "",
            })}
          draftLoaded={
            composerMode !== "note" &&
            Boolean(selectedThreadId) &&
            Boolean(draftValue.trim()) &&
            Boolean(systemDraftUneditedByThread[selectedThreadId])
          }
          canSend={Boolean(selectedThreadId) && !isLocalThreadId(selectedThreadId)}
          onSend={handleSendDraft}
          pendingOrderUpdate={
            selectedPendingOrderUpdate
          }
          returnCase={selectedThreadId ? returnCaseByThread[selectedThreadId] || null : null}
          orderUpdateDecision={
            selectedThreadId ? orderUpdateDecisionByThread[selectedThreadId] || null : null
          }
          onOrderUpdateDecision={handleOrderUpdateDecision}
          orderUpdateSubmitting={
            selectedThreadId ? Boolean(orderUpdateSubmittingByThread[selectedThreadId]) : false
          }
          orderUpdateError={
            selectedThreadId ? orderUpdateErrorByThread[selectedThreadId] || null : null
          }
          isSending={isSending}
          composerMode={composerMode}
          onComposerModeChange={setComposerMode}
          mailboxEmails={mailboxEmails}
          isWorkspaceTestMode={isWorkspaceTestMode}
          conversationScrollTop={selectedThreadId ? scrollPositionByThread[selectedThreadId] || 0 : 0}
          onConversationScroll={(scrollTop) => {
            if (!selectedThreadId) return;
            setScrollPositionByThread((prev) => ({
              ...prev,
              [selectedThreadId]: scrollTop,
            }));
          }}
          headerActions={
            selectedThreadId ? (
              <InboxHeaderActions
                ticketState={selectedTicketState}
                assignmentOptions={assignmentOptions}
                selectedAssignmentValue={selectedAssignmentValue}
                inboxOptions={inboxOptions}
                selectedInboxBucket={selectedInboxBucket}
                selectedInboxSlug={selectedInboxSlug}
                tagLabel={selectedTagLabel}
                onTicketStateChange={handleTicketStateChange}
                onAssignmentChange={handleAssignmentChange}
                onInboxChange={handleInboxChange}
                onOpenTranslation={() => setTranslationModalOpen(true)}
              />
            ) : null
          }
          rightHeaderActions={
            selectedThreadId ? (
              <button
                type="button"
                onClick={() => setInsightsOpen(true)}
                className="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-300"
              >
                View actions
              </button>
            ) : null
          }
          onGenerateDraft={handleGenerateDraft}
          isGeneratingDraft={Boolean(
            selectedThreadId && manualDraftGeneratingByThread[selectedThreadId]
          )}
        />
      </div>

      <SonaInsightsModal
        open={insightsOpen}
        onOpenChange={setInsightsOpen}
        actions={actions}
        draftId={draftLogId}
        threadId={selectedThread?.id || null}
        draftLoading={draftLogLoading}
        customerLookup={customerLookup}
        customerLookupLoading={customerLookupLoading}
        customerLookupError={customerLookupError}
        onCustomerRefresh={refreshCustomerLookup}
        customerLookupParams={customerLookupParams}
      />

      <TranslationModal
        open={translationModalOpen}
        onOpenChange={setTranslationModalOpen}
        threadId={selectedThread?.id || null}
      />
    </div>
  );
}
