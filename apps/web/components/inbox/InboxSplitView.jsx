"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TicketList } from "@/components/inbox/TicketList";
import { TicketDetail } from "@/components/inbox/TicketDetail";
import { SonaInsightsModal } from "@/components/inbox/SonaInsightsModal";
import { deriveThreadsFromMessages } from "@/hooks/useInboxData";
import { getMessageTimestamp, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
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
import { CheckCircle, CheckCircle2, User } from "lucide-react";

const DEFAULT_TICKET_STATE = {
  status: "New",
  assignee: null,
  priority: null,
};

const STATUS_OPTIONS = ["New", "Open", "Waiting", "Solved"];
const UNASSIGNED_ASSIGNEE_VALUE = "__unassigned__";
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

function InboxHeaderActions({
  ticketState,
  assignmentOptions,
  selectedAssignmentValue,
  inboxOptions,
  selectedInboxSlug,
  tagLabel,
  onTicketStateChange,
  onAssignmentChange,
  onInboxChange,
  onOpenInsights,
}) {
  const [inboxPickerOpen, setInboxPickerOpen] = useState(false);
  const [inboxFilter, setInboxFilter] = useState("");
  const selectedInboxLabel = useMemo(() => {
    if (!selectedInboxSlug) return "All tickets";
    const hit = (inboxOptions || []).find((option) => option.value === selectedInboxSlug);
    return hit?.label || selectedInboxSlug;
  }, [inboxOptions, selectedInboxSlug]);
  const filteredInboxOptions = useMemo(() => {
    const query = String(inboxFilter || "").trim().toLowerCase();
    if (!query) return inboxOptions || [];
    return (inboxOptions || []).filter((option) =>
      String(option?.label || "").toLowerCase().includes(query)
    );
  }, [inboxFilter, inboxOptions]);
  const statusStylesByStatus = {
    New: "bg-green-50 text-green-700 border-green-200",
    Open: "bg-blue-50 text-blue-700 border-blue-200",
    Waiting: "bg-orange-50 text-orange-700 border-orange-200",
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
          className={`h-auto w-auto cursor-pointer gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${statusStyles}`}
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
        <SelectTrigger className="h-auto w-auto cursor-pointer gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
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
        className="cursor-pointer rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700"
      >
        {tagLabel || "General"}
      </button>
      <button
        type="button"
        onClick={() => setInboxPickerOpen(true)}
        className="cursor-pointer rounded-md border border-dashed border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300"
      >
        Move to inbox
      </button>
      <button
        type="button"
        onClick={onOpenInsights}
        className="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300"
      >
        View actions
      </button>
      <Dialog open={inboxPickerOpen} onOpenChange={setInboxPickerOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Move ticket to inbox</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={inboxFilter}
              onChange={(event) => setInboxFilter(event.target.value)}
              placeholder="Search inbox..."
            />
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
              <button
                type="button"
                onClick={() => {
                  onInboxChange?.(null);
                  setInboxPickerOpen(false);
                }}
                className={`w-full cursor-pointer rounded px-3 py-2 text-left text-sm ${
                  !selectedInboxSlug
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                All tickets
              </button>
              {filteredInboxOptions.map((option) => {
                const isActive = selectedInboxSlug === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onInboxChange?.(option.value);
                      setInboxPickerOpen(false);
                    }}
                    className={`w-full cursor-pointer rounded px-3 py-2 text-left text-sm ${
                      isActive
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
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

const extractOrderNumber = (value = "") => {
  if (!value) return null;
  const match =
    value.match(/(?:ordre|order)?\s*#?\s*(\d{3,})/i) ?? value.match(/(\d{3,})/);
  return match ? match[1] : null;
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
  if (normalized === "applied" || normalized === "approved") return "accepted";
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
  const [liveThreads, setLiveThreads] = useState(threads || []);
  const [liveMessages, setLiveMessages] = useState(messages || []);
  const [liveAttachments, setLiveAttachments] = useState(attachments || []);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [localNewThread, setLocalNewThread] = useState(null);
  const [draftLogLoading, setDraftLogLoading] = useState(false);
  const [draftLogIdByThread, setDraftLogIdByThread] = useState({});
  const [ticketStateByThread, setTicketStateByThread] = useState({});
  const [readOverrides, setReadOverrides] = useState({});
  const [localSentMessagesByThread, setLocalSentMessagesByThread] = useState({});
  const [filters, setFilters] = useState({
    query: "",
    status: "All",
    unreadsOnly: false,
  });
  const [composerMode, setComposerMode] = useState("reply");
  const [draftValue, setDraftValue] = useState("");
  const [noteValueByThread, setNoteValueByThread] = useState({});
  const [signatureByThread, setSignatureByThread] = useState({});
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [suppressAutoDraftByThread, setSuppressAutoDraftByThread] = useState({});
  const [draftReady, setDraftReady] = useState(false);
  const [systemDraftUneditedByThread, setSystemDraftUneditedByThread] = useState({});
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [draftLogId, setDraftLogId] = useState(null);
  const sendingStartedAtRef = useRef(0);
  const [deletingThread, setDeletingThread] = useState(false);
  const [pendingOrderUpdateByThread, setPendingOrderUpdateByThread] = useState({});
  const [orderUpdateDecisionByThread, setOrderUpdateDecisionByThread] = useState({});
  const [orderUpdateSubmittingByThread, setOrderUpdateSubmittingByThread] = useState({});
  const [orderUpdateErrorByThread, setOrderUpdateErrorByThread] = useState({});
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [currentSupabaseUserId, setCurrentSupabaseUserId] = useState(null);
  const [workspaceInboxes, setWorkspaceInboxes] = useState([]);
  const headerActionsKeyRef = useRef("");
  const draftLastSavedRef = useRef("");
  const savingDraftRef = useRef(false);
  const draftValueRef = useRef("");
  const supabase = useClerkSupabase();
  const { user } = useUser();
  const searchParams = useSearchParams();
  const { setActions: setHeaderActions } = useSiteHeaderActions();
  const currentUserName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "You";
  const activeView = searchParams?.get("view") || "";

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

    const BASE_POLL_MS = 10_000;
    const HIDDEN_POLL_MS = 30_000;
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

    refreshInboxData().catch(() => null);
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
    draftValueRef.current = draftValue;
  }, [draftValue]);

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

  useEffect(() => {
    if (!localNewThread) return;
    if (selectedThreadId === localNewThread.id) return;
    setLocalNewThread(null);
  }, [localNewThread, selectedThreadId]);

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

  const mailboxEmails = useMemo(() => {
    const emails = new Set();
    liveMessages.forEach((message) => {
      (message.to_emails || []).forEach((email) => emails.add(email));
      (message.cc_emails || []).forEach((email) => emails.add(email));
      (message.bcc_emails || []).forEach((email) => emails.add(email));
    });
    return Array.from(emails);
  }, [liveMessages]);

  const customerByThread = useMemo(() => {
    const map = {};
    derivedThreads.forEach((thread) => {
      const threadMessages = messagesByThread.get(thread.id) || [];
      const inbound = threadMessages.find(
        (message) => !isOutboundMessage(message, mailboxEmails)
      );
      map[thread.id] = getSenderLabel(inbound || threadMessages[0]) || "Unknown sender";
    });
    return map;
  }, [derivedThreads, mailboxEmails, messagesByThread]);

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

        // Resolved tickets live exclusively in the "Resolved" view.
        if (isResolved && activeView !== "resolved") {
          return false;
        }
        if (!isResolved && activeView === "resolved") {
          return false;
        }

        if (!activeView && (effectiveAssignee || inboxSlug)) {
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
    if (!filteredThreads.length) {
      setSelectedThreadId((prev) => (prev === null ? prev : null));
      return;
    }
    setSelectedThreadId((prev) => {
      if (prev && filteredThreads.some((thread) => thread.id === prev)) {
        return prev;
      }
      return filteredThreads[0].id;
    });
  }, [filteredThreads]);

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
    () => filteredThreads.find((thread) => thread.id === selectedThreadId) || null,
    [filteredThreads, selectedThreadId]
  );
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
  const selectedTagLabel =
    Array.isArray(selectedThread?.tags) && selectedThread.tags.length
      ? selectedThread.tags.find((tag) => !String(tag || "").startsWith("inbox:")) || "General"
      : "General";
  const selectedInboxSlug = extractInboxSlugFromTags(selectedThread?.tags || []);
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

  useEffect(() => {
    if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
    let active = true;
    const fetchDraftLogId = async () => {
      if (draftLogIdByThread[selectedThreadId]) {
        setDraftLogId(draftLogIdByThread[selectedThreadId]);
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
        setDraftLogIdByThread((prev) => ({
          ...prev,
          [selectedThreadId]: nextId,
        }));
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

    if (!thread.is_read) {
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
    if (!thread.is_read && currentState?.status === "New") {
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
    const base = messagesByThread.get(selectedThreadId) || [];
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
  }, [localSentMessagesByThread, messagesByThread, selectedThreadId]);

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
    const inbound = threadMessages.find(
      (message) => !isOutboundMessage(message, mailboxEmails)
    );
    const email = inbound?.from_email || null;
    const subject = inbound?.subject || selectedThread?.subject || "";
    const body = inbound?.body_text || "";
    const orderNumber = extractOrderNumber(subject) || extractOrderNumber(body);
    return { email, subject, orderNumber };
  }, [mailboxEmails, selectedThread?.subject, threadMessages]);

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
      if (latestAction) {
        const normalizedStatus = String(latestAction.status || "").toLowerCase();
        const isPendingStatus =
          normalizedStatus === "pending" ||
          normalizedStatus === "warning" ||
          normalizedStatus === "awaiting_approval";
        const isFailedStatus = normalizedStatus === "failed";
        const detail =
          asString(latestAction?.detail) ||
          "Sona wants to apply an order update for this customer.";
        if (isPendingStatus) {
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(latestAction.id || ""),
              detail,
              actionType: asString(latestAction.action_type) || null,
              payload:
                latestAction?.payload && typeof latestAction.payload === "object"
                  ? latestAction.payload
                  : {},
              createdAt: latestAction.createdAt || null,
              status: asString(latestAction.status) || "pending",
              error: asString(latestAction.error) || null,
            },
          }));
        } else if (isFailedStatus) {
          const failedDetail =
            asString(latestAction?.error) ||
            asString(latestAction?.detail) ||
            "Order action could not be completed.";
          setPendingOrderUpdateByThread((prev) => ({
            ...prev,
            [selectedThreadId]: {
              id: String(latestAction.id || ""),
              detail: failedDetail,
              actionType: asString(latestAction.action_type) || null,
              payload:
                latestAction?.payload && typeof latestAction.payload === "object"
                  ? latestAction.payload
                  : {},
              createdAt: latestAction.createdAt || null,
              status: "failed",
              error: asString(latestAction.error) || failedDetail,
            },
          }));
        } else {
          setPendingOrderUpdateByThread((prev) => {
            if (!prev[selectedThreadId]) return prev;
            const next = { ...prev };
            delete next[selectedThreadId];
            return next;
          });
        }
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
    draftLastSavedRef.current = "";
  }, [selectedThreadId]);

  useEffect(() => {
    let active = true;
    const loadDraft = async () => {
      if (isLocalThreadId(selectedThreadId)) {
        setDraftReady(true);
        return;
      }
      if (!selectedThreadId) return;
      const res = await fetch(`/api/threads/${selectedThreadId}/draft`, {
        method: "GET",
      }).catch(() => null);
      if (!active) return;
      if (!res?.ok) {
        setDraftReady(true);
        return;
      }
      const payload = await res.json().catch(() => ({}));
      const draft = payload?.draft || null;
      const signature = String(payload?.signature || "");
      setSignatureByThread((prev) => ({
        ...prev,
        [selectedThreadId]: signature,
      }));
      const draftText = draft?.body_text || draft?.body_html || "";
      if (draftText) {
        setDraftValue(draftText);
        draftLastSavedRef.current = draftText.trim();
        setSystemDraftUneditedByThread((prev) => ({
          ...prev,
          [selectedThreadId]: true,
        }));
      } else {
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
  }, [isLocalThreadId, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !draftReady || !aiDraft) return;
    if (suppressAutoDraftByThread[selectedThreadId]) return;
    if (draftValueRef.current) return;
    setDraftValue(aiDraft);
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
  }, [aiDraft, draftReady, selectedThreadId, suppressAutoDraftByThread]);

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
    if (suppressAutoDraftByThread[selectedThreadId]) return;
    const draftBody = draftMessage.body_text || draftMessage.body_html || "";
    if (draftValueRef.current) return;
    setDraftValue(draftBody);
    setSystemDraftUneditedByThread((prev) => ({
      ...prev,
      [selectedThreadId]: true,
    }));
  }, [draftMessage, draftReady, selectedThreadId, suppressAutoDraftByThread]);

  const handleDraftChange = useCallback(
    (nextValue) => {
      if (composerMode === "note") {
        if (!selectedThreadId) return;
        setNoteValueByThread((prev) => ({
          ...prev,
          [selectedThreadId]: String(nextValue || ""),
        }));
        return;
      }
      setDraftValue(String(nextValue || ""));
      if (!selectedThreadId) return;
      setSystemDraftUneditedByThread((prev) => {
        if (!prev[selectedThreadId]) return prev;
        return {
          ...prev,
          [selectedThreadId]: false,
        };
      });
    },
    [composerMode, selectedThreadId]
  );

  const handleSignatureChange = useCallback(
    (nextValue) => {
      if (!selectedThreadId) return;
      setSignatureByThread((prev) => ({
        ...prev,
        [selectedThreadId]: String(nextValue || ""),
      }));
    },
    [selectedThreadId]
  );

  const handleFiltersChange = (updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

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
    (inboxSlug) => {
      if (!selectedThreadId) return;
      const normalized = typeof inboxSlug === "string" ? inboxSlug.trim() : "";
      const previousTags =
        derivedThreads.find((thread) => thread.id === selectedThreadId)?.tags || [];
      setLiveThreads((prev) =>
        (prev || []).map((thread) => {
          if (thread.id !== selectedThreadId) return thread;
          const tags = Array.isArray(thread.tags) ? thread.tags : [];
          const withoutInbox = tags.filter((tag) => !String(tag || "").startsWith("inbox:"));
          return {
            ...thread,
            tags: normalized ? [...withoutInbox, toInboxTag(normalized)] : withoutInbox,
          };
        })
      );

      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThreadId,
          inboxSlug: normalized || null,
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

  useEffect(() => {
    if (!setHeaderActions) return;
    if (!selectedThreadId) {
      headerActionsKeyRef.current = "";
      setHeaderActions(null);
      return;
    }
    const key = `${selectedThreadId}:${selectedTicketState?.status || ""}:${
      selectedTicketState?.assignee || ""
    }:${selectedInboxSlug || ""}`;
    if (headerActionsKeyRef.current === key) return;
    headerActionsKeyRef.current = key;
    setHeaderActions(
      <InboxHeaderActions
        ticketState={selectedTicketState}
        assignmentOptions={assignmentOptions}
        selectedAssignmentValue={selectedAssignmentValue}
        inboxOptions={inboxOptions}
        selectedInboxSlug={selectedInboxSlug}
        tagLabel={selectedTagLabel}
        onTicketStateChange={handleTicketStateChange}
        onAssignmentChange={handleAssignmentChange}
        onInboxChange={handleInboxChange}
        onOpenInsights={() => setInsightsOpen(true)}
      />
    );
  }, [
    assignmentOptions,
    handleAssignmentChange,
    handleTicketStateChange,
    handleInboxChange,
    inboxOptions,
    selectedAssignmentValue,
    selectedInboxSlug,
    selectedTicketState,
    selectedThreadId,
    selectedTagLabel,
    setHeaderActions,
  ]);

  useEffect(() => {
    if (!setHeaderActions) return;
    return () => setHeaderActions(null);
  }, [setHeaderActions]);

  const saveThreadDraft = useCallback(async ({ immediate = false, valueOverride } = {}) => {
    if (isLocalThreadId(selectedThreadId)) return;
    if (composerMode === "note") return;
    if (!selectedThreadId || !draftReady) return;
    const text = String(valueOverride ?? draftValueRef.current ?? "");
    const trimmed = text.trim();
    if (!trimmed) {
      if (!immediate || savingDraftRef.current) return;
      try {
        await fetch(`/api/threads/${selectedThreadId}/draft`, {
          method: "DELETE",
        });
      } catch {
        // ignore delete draft errors in UI flow
      }
      setActiveDraftId(null);
      draftLastSavedRef.current = "";
      setSuppressAutoDraftByThread((prev) => ({
        ...prev,
        [selectedThreadId]: true,
      }));
      return;
    }
    if (!immediate && trimmed === draftLastSavedRef.current) return;
    if (savingDraftRef.current) return;
    savingDraftRef.current = true;
    try {
      const res = await fetch(`/api/threads/${selectedThreadId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: text,
          subject: selectedThread?.subject || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not save draft.");
      }
      draftLastSavedRef.current = trimmed;
      if (data?.draft_id) {
        setActiveDraftId(data.draft_id);
      }
    } catch {
      // keep UI responsive; autosave retries on next change/interval
    } finally {
      savingDraftRef.current = false;
    }
  }, [composerMode, draftReady, isLocalThreadId, selectedThread?.subject, selectedThreadId]);

  useEffect(() => {
    if (isLocalThreadId(selectedThreadId)) return;
    if (!selectedThreadId || !draftReady) return;
    const timer = setInterval(() => {
      saveThreadDraft({ immediate: false, valueOverride: draftValueRef.current });
    }, 4000);
    return () => clearInterval(timer);
  }, [draftReady, isLocalThreadId, saveThreadDraft, selectedThreadId]);

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
    setSelectedThreadId(id);
    setDraftValue("");
    setActiveDraftId(null);
    setDraftReady(true);
    setComposerMode("reply");
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
    const composeMode = payload?.mode === "note" || composerMode === "note" ? "note" : "reply";
    const composeBody = String(composeMode === "note" ? activeNoteValue : draftValue || "");
    if (!composeBody.trim()) {
      toast.error("Draft is empty.");
      return;
    }
    sendingStartedAtRef.current = Date.now();
    setIsSending(true);
    const toastId = toast.loading(composeMode === "note" ? "Saving note..." : "Sending draft...");
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
            to_emails: payload.toRecipients || [],
            cc_emails: payload.ccRecipients || [],
            bcc_emails: payload.bccRecipients || [],
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
      toast.success(`Reply sent${providerId}.`, { id: toastId });
      setDraftValue("");
      setActiveDraftId(null);
      draftLastSavedRef.current = "";
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

  const handleDeleteThread = async () => {
    if (!selectedThreadId || deletingThread) return;
    if (isLocalThreadId(selectedThreadId)) {
      setLocalNewThread(null);
      setSelectedThreadId(null);
      setDraftValue("");
      setActiveDraftId(null);
      return;
    }
    const confirmed = window.confirm("Are you sure you want to delete this ticket? This cannot be undone.");
    if (!confirmed) return;
    setDeletingThread(true);
    try {
      const res = await fetch(`/api/threads/${selectedThreadId}/delete`, {
        method: "DELETE",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not delete ticket.");
      }
      toast.success("Ticket deleted.");
      setSelectedThreadId(null);
      setDraftValue("");
      setActiveDraftId(null);
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (error) {
      toast.error(error?.message || "Could not delete ticket.");
    } finally {
      setDeletingThread(false);
    }
  };

  const handleOrderUpdateDecision = useCallback(
    async (decision) => {
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
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Could not update action.");
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
              status: "failed",
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
                setDraftValue(draftText);
                draftLastSavedRef.current = draftText.trim();
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
        setOrderUpdateDecisionByThread((prev) => ({
          ...prev,
          [selectedThreadId]: normalized,
        }));
        setOrderUpdateErrorByThread((prev) => {
          const next = { ...prev };
          delete next[selectedThreadId];
          return next;
        });
        toast.success(
          normalized === "accepted" ? "Action approved and applied." : "Order update denied.",
          { id: toastId }
        );
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
    [orderUpdateSubmittingByThread, pendingOrderUpdateByThread, selectedThreadId]
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

  const isDraftGenerating =
    Boolean(selectedThreadId) &&
    !isLocalThreadId(selectedThreadId) &&
    !draftReady &&
    latestMessageIsInbound &&
    !draftMessage &&
    !aiDraft &&
    !draftValue.trim() &&
    !suppressAutoDraftByThread[selectedThreadId];

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <TicketList
        threads={filteredThreads}
        selectedThreadId={selectedThreadId}
        ticketStateByThread={ticketStateByThread}
        customerByThread={customerByThread}
        onSelectThread={setSelectedThreadId}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        getTimestamp={getThreadTimestamp}
        getUnreadCount={getThreadUnreadCount}
        onCreateTicket={handleCreateTicket}
        hideSolvedFilter={activeView === ""}
      />

      <TicketDetail
        thread={selectedThread}
        messages={threadMessages}
        attachments={threadAttachments}
        mentionUsers={effectiveMentionUsers}
        currentUserId={currentSupabaseUserId || null}
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
        onDraftBlur={() => saveThreadDraft({ immediate: true })}
        draftLoaded={
          composerMode !== "note" &&
          Boolean(selectedThreadId) &&
          Boolean(draftValue.trim()) &&
          Boolean(systemDraftUneditedByThread[selectedThreadId])
        }
        canSend={Boolean(selectedThreadId) && !isLocalThreadId(selectedThreadId)}
        onSend={handleSendDraft}
        onDeleteThread={handleDeleteThread}
        deletingThread={deletingThread}
        pendingOrderUpdate={
          selectedPendingOrderUpdate
        }
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
      />

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
      />
    </div>
  );
}
