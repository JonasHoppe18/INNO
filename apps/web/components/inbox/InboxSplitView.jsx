"use client";

import {
  Component,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { TicketList } from "@/components/inbox/TicketList";
import { TicketDetail } from "@/components/inbox/TicketDetail";
import { SonaInsightsModal } from "@/components/inbox/SonaInsightsModal";
import { TranslationModal } from "@/components/inbox/TranslationModal";
import {
  deriveThreadsFromMessages,
  useThreadAttachments,
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
import { reportClientEvent } from "@/lib/client-events";
import { toLegacyUiStatus } from "@/lib/inbox/status-model";
import { isAutomated, threadTab } from "@/lib/inbox/view-model";
import { DEFAULT_FILTERS, useThreadFilters } from "@/lib/inbox/useThreadFilters";
import { useThreadSelection } from "@/lib/inbox/useThreadSelection";
import { useThreadActions } from "@/lib/inbox/useThreadActions";
import { useComposerState } from "@/lib/inbox/useComposerState";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  ArrowUpRight,
  Bell,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  Inbox,
  Plus,
  User,
  X,
} from "lucide-react";

const DEFAULT_TICKET_STATE = {
  status: "New",
  assignee: null,
  priority: null,
};

class InboxContentBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[InboxContentBoundary] failed to render ticket", {
      resetKey: this.props.resetKey,
      error,
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-sidebar px-6 text-center">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          This ticket hit a rendering error. Select another ticket and come back, or refresh the page.
        </div>
      </section>
    );
  }
}

const STATUS_OPTIONS = ["New", "Open", "Pending", "Waiting", "Solved"];
const UNASSIGNED_ASSIGNEE_VALUE = "__unassigned__";
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
const PREVIEW_CUSTOMER_LOOKUP_LIMIT = 30;
const SECONDARY_THREAD_FETCH_DELAY_MS = 250;
const DRAFT_FETCH_DELAY_MS = 150;
const firstTagCache = new Map();

const deferAfterInteraction = (callback) => {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 1200 });
    return;
  }
  setTimeout(callback, 0);
};

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const getAssigneeLabel = (profile, fallbackValue) => {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
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

const normalizeStatus = (value) => toLegacyUiStatus(value);

const toInboxTag = (slug = "") => `inbox:${String(slug || "").trim()}`;

const extractInboxSlugFromTags = (tags = []) => {
  const list = Array.isArray(tags) ? tags : [];
  const hit = list.find((tag) => String(tag || "").startsWith("inbox:"));
  if (!hit) return null;
  const slug = String(hit).slice("inbox:".length).trim();
  return slug || null;
};

function FirstTagPill({ threadId, refreshTrigger }) {
  const [tag, setTag] = useState(null);

  useEffect(() => {
    if (!threadId) return;
    const cacheKey = `${threadId}:${refreshTrigger || 0}`;
    if (firstTagCache.has(cacheKey)) {
      setTag(firstTagCache.get(cacheKey));
      return;
    }
    let active = true;
    fetch(`/api/threads/${threadId}/tags`)
      .then((response) => response.json())
      .then((json) => {
        if (!active) return;
        const nextTag = json?.tags?.[0] ?? null;
        firstTagCache.set(cacheKey, nextTag);
        setTag(nextTag);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [threadId, refreshTrigger]);

  if (!tag) return null;

  return (
    <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600">
      {tag.name}
    </span>
  );
}

const extractSenderFromThreadSnippet = (thread) => {
  const snippet = String(thread?.snippet || "")
    .replace(/\s+/g, " ")
    .trim();
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
    /(?:^|\s)From\s*:\s*([^<,\n]+?)\s*(?:<([^>]+)>)?(?=\s+(?:Sent|To|Subject)\s*:|$)/i,
  );
  const toHeaderMatch = snippet.match(
    /(?:^|\s)To\s*:\s*([^<,\n]+?)\s*(?:<([^>]+)>)?(?=\s+(?:From|Sent|Subject)\s*:|$)/i,
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
    /(?:^|\s)(?:Name|Navn)\s*:\s*([^,:;|]+?)(?=\s+(?:Email|E-mail)\s*:|$)/i,
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
  threadId,
  senderRuleSourceEmail,
  tagsRefreshTrigger,
  ticketState,
  assignmentOptions,
  selectedAssignmentValue,
  inboxOptions,
  selectedInboxBucket,
  selectedInboxSlug,
  onTicketStateChange,
  onAssignmentChange,
  onInboxChange,
  onOpenTranslation,
}) {
  const [inboxPickerOpen, setInboxPickerOpen] = useState(false);
  const [inboxFilter, setInboxFilter] = useState("");
  const [applySenderRule, setApplySenderRule] = useState(false);
  const destinationOptions = useMemo(
    () => [
      { value: "__all__", label: "All tickets", icon: Inbox },
      { value: "__notifications__", label: "Notifications", icon: Bell },
      ...(inboxOptions || []).map((option) => ({
        ...option,
        icon: Inbox,
      })),
    ],
    [inboxOptions],
  );
  const selectedDestinationValue = useMemo(() => {
    if (selectedInboxBucket === "notification") return "__notifications__";
    if (!selectedInboxSlug) return "__all__";
    return selectedInboxSlug;
  }, [selectedInboxBucket, selectedInboxSlug]);
  const filteredInboxOptions = useMemo(() => {
    const query = String(inboxFilter || "")
      .trim()
      .toLowerCase();
    if (!query) return destinationOptions;
    return destinationOptions.filter((option) =>
      String(option?.label || "")
        .toLowerCase()
        .includes(query),
    );
  }, [destinationOptions, inboxFilter]);
  const selectedInboxLabel = useMemo(() => {
    if (selectedDestinationValue === "__notifications__")
      return "Notifications";
    if (!selectedInboxSlug) return null;
    const hit = (inboxOptions || []).find(
      (option) =>
        String(option?.value || "").trim() ===
        String(selectedInboxSlug || "").trim(),
    );
    return String(hit?.label || selectedInboxSlug).trim() || null;
  }, [inboxOptions, selectedDestinationValue, selectedInboxSlug]);
  const normalizedSenderRuleEmail = useMemo(() => {
    const value = String(senderRuleSourceEmail || "")
      .trim()
      .toLowerCase();
    if (!value) return "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
  }, [senderRuleSourceEmail]);
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
    statusStylesByStatus[ticketState.status] || statusStylesByStatus.Open;
  return (
    <div className="flex items-center gap-2">
      <Select
        value={ticketState.status}
        onValueChange={(value) => onTicketStateChange({ status: value })}
      >
        <SelectTrigger
          aria-label="Ticket status"
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
        <SelectTrigger
          aria-label="Ticket assignee"
          className="h-auto w-auto cursor-pointer gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More ticket actions"
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
      <FirstTagPill threadId={threadId} refreshTrigger={tagsRefreshTrigger} />
      {selectedInboxLabel ? (
        <button
          type="button"
          onClick={() => setInboxPickerOpen(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:border-amber-400 hover:bg-amber-100"
          title="Change tag"
        >
          {selectedInboxLabel}
        </button>
      ) : null}
      <Dialog
        open={inboxPickerOpen}
        onOpenChange={(open) => {
          setInboxPickerOpen(open);
          if (!open) {
            setApplySenderRule(false);
            setInboxFilter("");
          }
        }}
      >
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
                      if (isActive) {
                        setInboxPickerOpen(false);
                        return;
                      }
                      const ruleEmail = normalizedSenderRuleEmail;
                      const shouldApplySenderRule = Boolean(
                        applySenderRule && ruleEmail,
                      );
                      if (option.value === "__all__") {
                        onInboxChange?.({
                          inboxSlug: null,
                          classificationKey: "support",
                          destinationLabel: option.label,
                          applySenderRule: shouldApplySenderRule,
                          senderRuleEmail: ruleEmail,
                        });
                      } else if (option.value === "__notifications__") {
                        onInboxChange?.({
                          inboxSlug: null,
                          classificationKey: "notification",
                          destinationLabel: option.label,
                          applySenderRule: shouldApplySenderRule,
                          senderRuleEmail: ruleEmail,
                        });
                      } else {
                        onInboxChange?.({
                          inboxSlug: option.value,
                          classificationKey: "support",
                          destinationLabel: option.label,
                          applySenderRule: shouldApplySenderRule,
                          senderRuleEmail: ruleEmail,
                        });
                      }
                      setApplySenderRule(false);
                      setInboxPickerOpen(false);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors duration-150 ${
                      isActive
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <OptionIcon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {isActive ? (
                      <span className="text-xs font-medium opacity-80">
                        Current
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {!filteredInboxOptions.length ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No inboxes found.
                </p>
              ) : null}
            </div>
            {normalizedSenderRuleEmail ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <Checkbox
                  checked={applySenderRule}
                  onCheckedChange={(checked) =>
                    setApplySenderRule(Boolean(checked))
                  }
                  className="mt-0.5"
                />
                <span>
                  Apply this destination for all future emails from{" "}
                  <span className="font-medium">
                    {normalizedSenderRuleEmail}
                  </span>
                </span>
              </label>
            ) : null}
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
          ? "relative min-w-0 flex-1 bg-background"
          : "border-b border-border bg-background"
      }
    >
      {inline ? (
        <div className="absolute inset-y-0 left-0 z-10 w-2 bg-background" />
      ) : null}
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
          const subject =
            String(thread?.subject || "").trim() || "Untitled ticket";
          const unreadCount = Number(unreadByThread?.[threadId] || 0);
          return (
            <div
              key={threadId}
              className={`group relative flex min-w-0 ${inline ? "max-w-[260px]" : "max-w-[240px]"} shrink-0 items-center gap-2 px-4 py-1.5 transition ${
                inline
                  ? isActive
                    ? "-mb-px ml-2 rounded-t-[12px] rounded-b-none bg-background text-foreground"
                    : "rounded-t-[12px] rounded-b-none bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                  : isActive
                    ? "-mb-px rounded-t-lg rounded-b-none border border-border border-b-0 bg-background text-foreground shadow-sm"
                    : "rounded-t-lg rounded-b-none border border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
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
                {unreadCount > 0 ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                ) : null}
                <div className="min-w-0 pr-1">
                  <span className="block min-w-0 truncate text-[12px] font-semibold leading-[16px]">
                    {subject}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onCloseTab?.(threadId)}
                className={`rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground ${
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
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
    /\b(?:ordre|ordrenummer|order)\s*(?:nr\.?|number|no\.?)?\s*#?\s*(\d{3,})\b/i,
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
  String(value || "")
    .replace(/\s*\|thread_id:[a-z0-9-]+\s*/i, "")
    .trim();

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
      const payload =
        parsed?.payload && typeof parsed.payload === "object"
          ? parsed.payload
          : {};
      const threadId = asString(parsed?.thread_id || parsed?.threadId) || null;
      return {
        detail: stripThreadSuffix(detail),
        actionType,
        payload,
        threadId,
      };
    } catch {
      return { detail: raw, actionType: null, payload: {}, threadId: null };
    }
  }
  return { detail: raw, actionType: null, payload: {}, threadId: null };
};

const isApprovalManagedActionType = (value = "") =>
  APPROVAL_ACTION_TYPES.has(
    String(value || "")
      .trim()
      .toLowerCase(),
  );

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
  if (
    stepName.includes("shopify_action") ||
    stepName.includes("shopify action")
  ) {
    if (
      status === "warning" ||
      status === "pending" ||
      status === "awaiting_approval"
    )
      return true;
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
  if (
    normalized === "applied" ||
    normalized === "approved" ||
    normalized === "approved_test_mode"
  ) {
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

const enrichAddressWithOrderContext = (
  candidate = "",
  shippingAddress = null,
) => {
  const base = String(candidate || "").trim();
  if (!base || !shippingAddress) return base;

  const zipCity = [shippingAddress?.zip, shippingAddress?.city]
    .filter(Boolean)
    .join(" ")
    .trim();
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
    const currency = String(
      payload?.currency || payload?.currency_code || "",
    ).trim();
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
    const title = String(
      payload?.title || payload?.shipping_title || "",
    ).trim();
    return title
      ? `Sona wants to change shipping method to: ${title}.`
      : base || "Sona wants to change the shipping method.";
  }
  if (action === "hold_or_release_fulfillment") {
    const mode = String(
      payload?.mode || payload?.operation || "",
    ).toLowerCase();
    return mode === "release"
      ? "Sona wants to release fulfillment hold on this order."
      : base || "Sona wants to put this order on fulfillment hold.";
  }
  if (action === "edit_line_items") {
    const summary = String(
      payload?.edit_summary ||
        payload?.summary ||
        payload?.requested_changes ||
        "",
    ).trim();
    return summary
      ? `Sona wants to edit line items: ${summary}`
      : base || "Sona wants to edit line items on this order.";
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
    return tag
      ? `Sona wants to add the tag: ${tag}.`
      : base || "Sona wants to add an internal tag.";
  }
  if (action === "add_note" || action === "add_internal_note_or_tag") {
    const note = String(payload?.note || "").trim();
    return note
      ? `Sona wants to add an internal note: ${note}`
      : base || "Sona wants to add an internal note.";
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
      outboundBodies
        .map((text) => extractAddressCandidate(text))
        .find(Boolean) ||
      inboundBodies
        .map((text) => extractAddressCandidate(text))
        .find(Boolean) ||
      "";
    if (candidate) {
      const enriched = enrichAddressWithOrderContext(
        candidate,
        orderShippingAddress,
      );
      return `Sona wants to update shipping address to: ${enriched}`;
    }
  }
  if (!isFailedShippingUpdate && isLikelyAddressUpdateText(base)) {
    return "Sona wants to update the shipping address for this order.";
  }
  if (!isFailedShippingUpdate) return base;
  return "Sona wants to update the shipping address for this order.";
};

export function InboxSplitView({
  messages = [],
  threads = [],
  attachments = [],
}) {
  const DRAFT_WAIT_TIMEOUT_MS = 12_000;
  const [liveThreads, setLiveThreads] = useState(threads || []);
  const [liveMessages, setLiveMessages] = useState(messages || []);
  const [liveAttachments, setLiveAttachments] = useState(attachments || []);
  const [localNewThread, setLocalNewThread] = useState(null);
  const [sentDraftStatsByThread, setSentDraftStatsByThread] = useState({});
  const [readOverrides, setReadOverrides] = useState({});
  const [localSentMessagesByThread, setLocalSentMessagesByThread] = useState(
    {},
  );
  const [scrollPositionByThread, setScrollPositionByThread] = useState({});
  // Shadow preview (v2 pipeline) — per thread
  // Shape: { [threadId]: { loading: boolean, draft_text: string|null, confidence: number, sources: [], proposed_actions: [], error: string|null } }
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [translationModalOpen, setTranslationModalOpen] = useState(false);
  const [translationCache, setTranslationCache] = useState({});
  // Shape: { [threadId]: { loading: boolean, items: Array<{id, translatedText, originalLanguage, role}>, draft: {translatedText} | null } }
  const [deletingThread, setDeletingThread] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [currentSupabaseUserId, setCurrentSupabaseUserId] = useState(null);
  const [workspaceInboxes, setWorkspaceInboxes] = useState([]);
  const [isWorkspaceTestMode, setIsWorkspaceTestMode] = useState(false);
  const lastAutoReadThreadIdRef = useRef(null);
  const ticketSwitchStartedAtRef = useRef(new Map());
  const scrollPositionByThreadRef = useRef({});
  const scrollSaveFrameRef = useRef(null);
  const [, startInboxTransition] = useTransition();
  const supabase = useClerkSupabase();
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTitleContent } = useSiteHeaderActions();
  const currentUserName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "You";
  const { activeView, filters, setFilters, effectiveFilters } =
    useThreadFilters({ searchParams });

  useEffect(() => {
    setLiveThreads(Array.isArray(threads) ? threads : []);
  }, [threads]);

  useEffect(() => {
    setLiveMessages(Array.isArray(messages) ? messages : []);
  }, [messages]);

  useEffect(() => {
    setLiveAttachments(Array.isArray(attachments) ? attachments : []);
  }, [attachments]);

  const refreshInboxDataRef = useRef(null);

  useEffect(() => {
    let active = true;
    let lastFetchAt = 0;
    const REFETCH_COOLDOWN_MS = 30_000;

    const fetchInboxData = async (force = false) => {
      if (!active) return;
      if (!force && Date.now() - lastFetchAt < REFETCH_COOLDOWN_MS) return;
      lastFetchAt = Date.now();
      try {
        const response = await fetch("/api/inbox/live", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok || !active) return;
        const payload = await response.json().catch(() => null);
        if (!active) return;
        const threadRows = Array.isArray(payload?.threads)
          ? payload.threads
          : [];
        const messageRows = Array.isArray(payload?.messages)
          ? payload.messages
          : [];
        const attachmentRows = Array.isArray(payload?.attachments)
          ? payload.attachments
          : [];
        if (threadRows.length > 0) setLiveThreads(threadRows);
        if (messageRows.length > 0) setLiveMessages(messageRows);
        if (attachmentRows.length > 0) setLiveAttachments(attachmentRows);
      } catch {
        // realtime handles ongoing updates — no retry loop needed
      }
    };

    // Initial load
    fetchInboxData();

    // Re-fetch on focus so stale data after a long idle gets refreshed
    const onFocus = () => {
      if (!active) return;
      fetchInboxData();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    refreshInboxDataRef.current = () => fetchInboxData(true);

    return () => {
      active = false;
      refreshInboxDataRef.current = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user?.id || !currentSupabaseUserId) return;
    let hasSubscribedOnceRef = { current: false };
    const upsertThread = (incomingThread) => {
      const nextThreadId = String(incomingThread?.id || "").trim();
      if (!nextThreadId) return;
      setLiveThreads((prev) => {
        const existing = Array.isArray(prev) ? prev : [];
        let found = false;
        const updated = existing.map((thread) => {
          if (String(thread?.id || "") !== nextThreadId) return thread;
          found = true;
          return {
            ...thread,
            ...incomingThread,
          };
        });
        return found ? updated : [incomingThread, ...updated];
      });
    };

    const channel = supabase
      .channel(`inbox-thread-updates:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mail_threads",
          filter: `user_id=eq.${currentSupabaseUserId}`,
        },
        (payload) => {
          upsertThread(payload?.new);
          // Trigger an immediate poll so the full thread list (with correct sorting/scope) refreshes
          refreshInboxDataRef.current?.();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "mail_threads",
          filter: `user_id=eq.${currentSupabaseUserId}`,
        },
        (payload) => {
          upsertThread(payload?.new);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "mail_threads" },
        (payload) => {
          const deletedThreadId = String(payload?.old?.id || "").trim();
          if (!deletedThreadId) return;
          setLiveThreads((prev) => {
            const existing = Array.isArray(prev) ? prev : [];
            if (!existing.length) return existing;
            return existing.filter(
              (thread) => String(thread?.id || "") !== deletedThreadId,
            );
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (hasSubscribedOnceRef.current) {
            // Re-fetch after reconnect to catch events missed during disconnect
            refreshInboxDataRef.current?.();
          } else {
            hasSubscribedOnceRef.current = true;
          }
        }
      });

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        // noop
      }
      supabase?.removeChannel?.(channel);
    };
  }, [supabase, user?.id, currentSupabaseUserId]);

  useEffect(
    () => () => {
      if (scrollSaveFrameRef.current) {
        cancelAnimationFrame(scrollSaveFrameRef.current);
        scrollSaveFrameRef.current = null;
      }
    },
    [],
  );

  const isLocalThreadId = useCallback(
    (threadId) => String(threadId || "").startsWith("local-new-ticket-"),
    [],
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
        .filter((thread) => {
          const customerName = String(thread?.customer_name || "").trim();
          const customerEmail = String(thread?.customer_email || "").trim();
          if (customerName && !/^unknown sender$/i.test(customerName)) {
            return false;
          }
          if (customerEmail && !/^unknown sender$/i.test(customerEmail)) {
            return false;
          }
          return true;
        })
        .slice(0, PREVIEW_CUSTOMER_LOOKUP_LIMIT)
        .map((thread) => String(thread?.id || "").trim())
        .filter(Boolean),
    [derivedThreads],
  );

  const { data: previewMessages } = useThreadPreviewMessages(previewThreadIds, {
    enabled: previewThreadIds.length > 0,
  });
  const deferredPreviewMessages = useDeferredValue(previewMessages);

  useEffect(() => {
    setReadOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      derivedThreads.forEach((thread) => {
        const threadId = String(thread?.id || "").trim();
        if (!threadId || !next[threadId]) return;
        // Only clear the local "read" override when a NEW message has arrived
        // (unread_count > 0). Don't use is_read — the server briefly still says
        // false during the window between local mark-as-read and server confirmation,
        // which causes the unread badge to flash back on.
        const hasNewUnreadMessages = Number(thread?.unread_count ?? 0) > 0;
        if (!hasNewUnreadMessages) return;
        delete next[threadId];
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [derivedThreads]);

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
        }),
      );
    });
    return map;
  }, [liveMessages]);

  const previewMessagesByThread = useMemo(() => {
    const map = new Map();
    (deferredPreviewMessages || []).forEach((message) => {
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
        }),
      );
    });
    return map;
  }, [deferredPreviewMessages]);

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
      const fullName = [member?.first_name, member?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (fullName) names.add(fullName.toLowerCase());
      const email = String(member?.email || "")
        .trim()
        .toLowerCase();
      if (email) names.add(email);
    });
    const currentName = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
    if (currentName) names.add(currentName);
    names.add("sona");
    names.add("sona ai");
    return names;
  }, [user?.firstName, user?.lastName, workspaceMembers]);

  const isLikelyInternalSender = useCallback(
    (message) => {
      if (!message) return false;
      if (message?.from_me === true) return true;
      const senderEmail = String(message?.from_email || "")
        .trim()
        .toLowerCase();
      const replyTarget = String(getReplyTargetEmail(message) || "")
        .trim()
        .toLowerCase();
      const senderLabel = String(getSenderLabel(message) || "")
        .trim()
        .toLowerCase();
      const isMailboxEmail = (email = "") =>
        mailboxEmails.some(
          (candidate) =>
            String(candidate || "")
              .trim()
              .toLowerCase() === email,
        );
      const isInternalDomain = (email = "") =>
        /@(acezone\.io|sona-ai\.dk)$/i.test(String(email || ""));

      if (
        senderEmail &&
        (isMailboxEmail(senderEmail) || isInternalDomain(senderEmail))
      )
        return true;
      if (
        replyTarget &&
        (isMailboxEmail(replyTarget) || isInternalDomain(replyTarget))
      )
        return true;
      if (senderLabel && internalSenderNames.has(senderLabel)) return true;
      return false;
    },
    [internalSenderNames, mailboxEmails],
  );

  const isLikelyInternalIdentity = useCallback(
    (nameOrEmail = "") => {
      const value = String(nameOrEmail || "")
        .trim()
        .toLowerCase();
      if (!value) return false;
      if (internalSenderNames.has(value)) return true;
      if (value.includes("acezone support")) return true;
      if (value.includes("support@acezone.io")) return true;
      if (value.endsWith("@acezone.io") || value.endsWith("@sona-ai.dk"))
        return true;
      return false;
    },
    [internalSenderNames],
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
      const previewThreadMessages =
        previewMessagesByThread.get(thread.id) || [];
      const dedupedById = new Map();
      [...liveThreadMessages, ...previewThreadMessages].forEach((message) => {
        const key = String(message?.id || "").trim();
        if (!key) return;
        if (!dedupedById.has(key)) dedupedById.set(key, message);
      });
      const threadMessages = Array.from(dedupedById.values()).sort((a, b) => {
        const aTime = new Date(getMessageTimestamp(a)).getTime();
        const bTime = new Date(getMessageTimestamp(b)).getTime();
        return (
          (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0)
        );
      });

      const latestExternalInbound =
        threadMessages.find(
          (message) =>
            !isLikelyInternalSender(message) &&
            !isOutboundMessage(message, mailboxEmails),
        ) || null;
      const latestExternalAny =
        threadMessages.find((message) => !isLikelyInternalSender(message)) ||
        null;
      const externalCandidate =
        latestExternalInbound || latestExternalAny || null;
      const senderFromMessages =
        getSenderLabel(externalCandidate || threadMessages[0]) || "";
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
        const threadId = String(thread?.id || "").trim();
        const hasLocalState = Object.prototype.hasOwnProperty.call(
          ticketStateByThread,
          thread.id,
        );
        const uiState = hasLocalState
          ? ticketStateByThread[thread.id]
          : DEFAULT_TICKET_STATE;
        const effectiveAssignee = hasLocalState
          ? (uiState?.assignee ?? null)
          : (thread.assignee_id ?? null);
        const effectiveStatus = normalizeStatus(
          (hasLocalState ? uiState?.status : null) ||
            thread.status ||
            DEFAULT_TICKET_STATE.status,
        );
        const inboxSlug = extractInboxSlugFromTags(thread?.tags || []);
        // effectiveStatus already folds in any local optimistic override
        // (ticketStateByThread) on top of thread.status — threadTab() only
        // sees raw thread fields, so we route the *effective* legacy status
        // through it rather than the raw thread, to keep the optimistic-UI
        // behavior identical to before this refactor.
        const isResolved =
          threadTab({ ...thread, status: effectiveStatus, close_pending: false }) ===
          "resolved";
        const isNotification = isAutomated(thread);

        // Resolved tickets live exclusively in the "Resolved" view.
        if (isResolved && activeView !== "resolved") {
          return false;
        }
        if (!isResolved && activeView === "resolved") {
          return false;
        }

        if (!activeView && (isNotification || inboxSlug)) {
          return false;
        }
        if (activeView === "notifications" && !isNotification) {
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
        const selectedStatuses = Array.isArray(effectiveFilters.statuses)
          ? effectiveFilters.statuses
          : effectiveFilters.status && effectiveFilters.status !== "All"
              ? [effectiveFilters.status]
              : [];
        if (selectedStatuses.length && !selectedStatuses.includes(effectiveStatus)) {
          return false;
        }
        const unreadCount =
          readOverrides[threadId] || thread?.is_read
            ? 0
            : Number(thread?.unread_count ?? 0);
        if (effectiveFilters.unreadsOnly && unreadCount === 0) return false;
        if (effectiveFilters.query) {
          const query = effectiveFilters.query.toLowerCase();
          const subject = (thread.subject || "").toLowerCase();
          const snippet = (thread.snippet || "").toLowerCase();
          const customer = (customerByThread[thread.id] || "").toLowerCase();
          const ticketNumber = Number(thread?.ticket_number);
          const hasTicketNumber =
            Number.isFinite(ticketNumber) && ticketNumber > 0;
          const ticketRefDisplay = hasTicketNumber
            ? `t-${String(ticketNumber).padStart(6, "0")}`
            : "";
          const ticketRefRaw = hasTicketNumber ? `t-${ticketNumber}` : "";
          const shouldMatchTicketRef = query.startsWith("t-");
          if (
            !subject.includes(query) &&
            !snippet.includes(query) &&
            !customer.includes(query) &&
            !(
              shouldMatchTicketRef &&
              (ticketRefDisplay.includes(query) || ticketRefRaw.includes(query))
            )
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const getTs = (thread) => {
          const value =
            effectiveFilters.sortBy === "oldest_updated" ||
            effectiveFilters.sortBy === "newest_updated"
              ? thread?.updated_at || thread?.last_message_at || thread?.created_at || 0
              : thread?.last_message_at || thread?.updated_at || thread?.created_at || 0;
          const parsed = Date.parse(value);
          return Number.isFinite(parsed) ? parsed : 0;
        };
        const aTs = getTs(a);
        const bTs = getTs(b);
        if (effectiveFilters.sortBy === "oldest_updated") {
          return aTs - bTs;
        }
        return bTs - aTs;
      });
  }, [
    activeView,
    currentSupabaseUserId,
    customerByThread,
    derivedThreads,
    effectiveFilters,
    readOverrides,
    ticketStateByThread,
    user?.id,
  ]);

  const markThreadReadInstantly = useCallback(
    (threadId) => {
      const nextThreadId = String(threadId || "").trim();
      if (!nextThreadId || isLocalThreadId(nextThreadId)) return;

      const thread = derivedThreads.find(
        (item) => String(item?.id || "").trim() === nextThreadId,
      );
      const hasUnreadMessages = Number(thread?.unread_count ?? 0) > 0;
      const isMarkedRead = Boolean(thread?.is_read);
      if (!hasUnreadMessages && isMarkedRead) return;

      setReadOverrides((prev) =>
        prev[nextThreadId] ? prev : { ...prev, [nextThreadId]: true },
      );
      startInboxTransition(() => {
        setLiveThreads((prev) =>
          (prev || []).map((item) =>
            String(item?.id || "").trim() === nextThreadId
              ? { ...item, unread_count: 0, is_read: true }
              : item,
          ),
        );
      });

      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("sona:thread-read"));

        fetch("/api/inbox/thread-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: nextThreadId,
            isRead: true,
            unreadCount: 0,
          }),
        }).catch(() => null);
      }, 0);
    },
    [derivedThreads, isLocalThreadId, startInboxTransition],
  );

  const {
    selectedThreadId,
    setSelectedThreadId,
    selectedThreadIdRef,
    openThreadIds,
    setOpenThreadIds,
    tabStateReady,
    tabStateStorageKey,
    messagesCacheRef,
    draftCacheRef,
    prefetchingRef,
    openThreadInWorkspace,
    closeThreadTab,
    handlePrefetchThread,
    selectNext,
  } = useThreadSelection({
    threads: derivedThreads,
    sortedThreads: filteredThreads,
    searchParams,
    isLocalThreadId,
    currentSupabaseUserId,
    userId: user?.id,
    startInboxTransition,
    markThreadReadInstantly,
    setLocalNewThread,
  });

  const {
    data: selectedThreadMessagesFromDb,
    attachments: selectedThreadAttachmentsFromDb,
    detail: selectedThreadDetail,
    loading: selectedThreadMessagesLoading,
    refresh: refreshSelectedThreadMessages,
    fetchedThreadId: messagesFetchedForThreadId,
  } = useThreadMessages(selectedThreadId, {
    enabled:
      Boolean(selectedThreadId) &&
      !String(selectedThreadId || "").startsWith("local-new-ticket-"),
  });
  const refreshSelectedThreadMessagesRef = useRef(
    refreshSelectedThreadMessages,
  );
  useEffect(() => {
    refreshSelectedThreadMessagesRef.current = refreshSelectedThreadMessages;
  }, [refreshSelectedThreadMessages]);

  useEffect(() => {
    if (!supabase || !user?.id || !currentSupabaseUserId) return;
    let hasSubscribedOnceRef = { current: false };
    const channel = supabase
      .channel(`inbox-message-updates:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mail_messages",
          filter: `user_id=eq.${currentSupabaseUserId}`,
        },
        (payload) => {
          const nextMessage = payload?.new;
          const nextMessageId = String(nextMessage?.id || "").trim();
          if (!nextMessageId) return;
          const nextThreadId = String(nextMessage?.thread_id || "").trim();
          if (nextThreadId) {
            messagesCacheRef.current.delete(nextThreadId);
            draftCacheRef.current.delete(nextThreadId);
          }
          setLiveMessages((prev) => {
            const existing = Array.isArray(prev) ? prev : [];
            if (
              existing.some(
                (message) => String(message?.id || "") === nextMessageId,
              )
            ) {
              return existing;
            }
            return [...existing, nextMessage];
          });
          // New AI draft for the selected thread: liveMessages already contains
          // the row, so just drop stale prefetched message cache.
          if (
            nextMessage?.is_draft &&
            nextMessage?.from_me &&
            String(nextMessage?.thread_id || "") === selectedThreadIdRef.current
          ) {
            messagesCacheRef.current.delete(String(nextMessage.thread_id || ""));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "mail_messages",
          filter: `user_id=eq.${currentSupabaseUserId}`,
        },
        (payload) => {
          const nextMessage = payload?.new;
          const prevMessage = payload?.old;
          const nextMessageId = String(nextMessage?.id || "").trim();
          if (!nextMessageId) return;
          const nextThreadId = String(nextMessage?.thread_id || "").trim();
          if (nextThreadId) {
            messagesCacheRef.current.delete(nextThreadId);
            draftCacheRef.current.delete(nextThreadId);
          }
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
          // When the pipeline writes ai_draft_text on an inbound message, the primary
          // rawThreadMessages source (selectedThreadMessagesFromDb) is stale because it
          // was fetched before the pipeline finished. Re-fetching picks up the new draft.
          const aiDraftChanged = nextMessage?.ai_draft_text !== undefined &&
            nextMessage?.ai_draft_text !== (prevMessage?.ai_draft_text ?? null) &&
            String(nextMessage?.thread_id || "") === selectedThreadIdRef.current;
          if (aiDraftChanged) {
            refreshSelectedThreadMessagesRef.current?.().catch(() => null);
          }
        },
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
            if (
              existing.some(
                (attachment) =>
                  String(attachment?.id || "") === nextAttachmentId,
              )
            ) {
              return existing;
            }
            return [...existing, nextAttachment];
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (hasSubscribedOnceRef.current) {
            refreshInboxDataRef.current?.();
          } else {
            hasSubscribedOnceRef.current = true;
          }
        }
      });

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        // noop
      }
      supabase?.removeChannel?.(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftCacheRef, messagesCacheRef, selectedThreadIdRef are refs returned by useThreadSelection (backed by useRef); identity never changes, and their .current is read fresh inside the realtime callbacks at fire-time, not captured at effect-setup-time.
  }, [supabase, user?.id, currentSupabaseUserId]);

  useEffect(() => {
    if (selectedThreadId) return;
    lastAutoReadThreadIdRef.current = null;
  }, [selectedThreadId]);

  useEffect(() => {
    if (!localNewThread) return;
    if (selectedThreadId === localNewThread.id) return;
    setLocalNewThread(null);
  }, [localNewThread, selectedThreadId]);

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
      if (!active) return;
      if (error) {
        console.warn(
          "InboxSplitView: failed to load supabase user id — realtime subscriptions will not activate",
          error,
        );
        return;
      }
      if (!data?.user_id) {
        console.warn(
          "InboxSplitView: no profile found for clerk user",
          user.id,
          "— realtime subscriptions will not activate",
        );
        return;
      }
      setCurrentSupabaseUserId(data.user_id);
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
    () =>
      derivedThreads.find((thread) => thread.id === selectedThreadId) || null,
    [derivedThreads, selectedThreadId],
  );
  const openThreads = useMemo(() => {
    return openThreadIds
      .map(
        (threadId) =>
          derivedThreads.find((thread) => thread.id === threadId) || null,
      )
      .filter(Boolean);
  }, [derivedThreads, openThreadIds]);
  const selectedTicketState =
    ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE;
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
          label: profile
            ? getAssigneeLabel(profile, value)
            : knownLabel || shortUserId(value),
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
        const fullName = [member?.first_name, member?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
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
  const selectedInboxSlug = extractInboxSlugFromTags(
    selectedThread?.tags || [],
  );
  const selectedInboxBucket = getInboxBucket(selectedThread);

  // Awaiting return: thread tagged awaiting_return and no active pending action card
  const isAwaitingReturn = useMemo(() => {
    if (!selectedThread) return false;
    const tags = Array.isArray(selectedThread.tags) ? selectedThread.tags : [];
    return tags.includes("awaiting_return");
  }, [selectedThread]);
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
    [workspaceInboxes],
  );
  const assignmentOptions = useMemo(() => {
    const combined = [
      { value: UNASSIGNED_ASSIGNEE_VALUE, label: "Unassigned" },
    ];
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
    return filteredThreads.filter((thread) => {
      const threadId = String(thread?.id || "").trim();
      if (!threadId) return false;
      if (readOverrides[threadId] || thread?.is_read) return false;
      return Number(thread?.unread_count ?? 0) > 0;
    }).length;
  }, [filteredThreads, readOverrides]);
  const unreadByThread = useMemo(() => {
    const map = {};
    derivedThreads.forEach((thread) => {
      const threadId = String(thread?.id || "").trim();
      if (!threadId) return;
      map[threadId] =
        readOverrides[threadId] || thread?.is_read
          ? 0
          : Number(thread?.unread_count ?? 0);
    });
    return map;
  }, [derivedThreads, readOverrides]);

  // NOTE: Previously a separate fetch to /api/threads/[id]/draft-stats was made
  // here as a fallback for the AI-edit badge. Removed — the detail endpoint at
  // /api/inbox/threads/[id]/detail already returns `draftStats` in its payload,
  // and the effect at line ~2340 wires it into sentDraftStatsByThread. One
  // round-trip instead of two, and one fewer place that could leak across
  // threads if the scope query is ever loosened. — 2026-05-26

  useEffect(() => {
    if (isLocalThreadId(selectedThreadId)) return;
    if (!supabase || !selectedThreadId) return;
    const thread = derivedThreads.find((item) => item.id === selectedThreadId);
    if (!thread) return;
    const isNewSelection = lastAutoReadThreadIdRef.current !== selectedThreadId;
    const hasUnreadMessages = Number(thread?.unread_count ?? 0) > 0;
    const hasLocalReadOverride = Boolean(readOverrides[selectedThreadId]);

    if (hasUnreadMessages && !hasLocalReadOverride) {
      setReadOverrides((prev) => ({ ...prev, [selectedThreadId]: true }));
      setLiveThreads((prev) =>
        (prev || []).map((item) =>
          String(item?.id || "") === String(selectedThreadId)
            ? { ...item, unread_count: 0, is_read: true }
            : item,
        ),
      );
      fetch("/api/inbox/thread-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThreadId,
          isRead: true,
          unreadCount: 0,
        }),
      }).catch(() => null);
      window.dispatchEvent(new CustomEvent("sona:thread-read"));
    }

    const currentState = ticketStateByThread[selectedThreadId];
    if (
      isNewSelection &&
      (hasUnreadMessages || !thread.is_read) &&
      currentState?.status === "New"
    ) {
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

    if (isNewSelection && isUuid(selectedThreadId)) {
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: selectedThreadId }),
        keepalive: true,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((payload) => {
          if (Number(payload?.marked || 0) > 0) {
            window.dispatchEvent(new CustomEvent("sona:thread-read"));
          }
        })
        .catch(() => null);
    }

    lastAutoReadThreadIdRef.current = selectedThreadId;
  }, [
    currentSupabaseUserId,
    derivedThreads,
    isLocalThreadId,
    readOverrides,
    selectedThreadId,
    supabase,
    ticketStateByThread,
  ]);

  const rawThreadMessages = useMemo(() => {
    if (!selectedThreadId) return [];
    const dbDataIsForCurrentThread =
      messagesFetchedForThreadId === selectedThreadId;
    const rawBase =
      dbDataIsForCurrentThread &&
      Array.isArray(selectedThreadMessagesFromDb) &&
      selectedThreadMessagesFromDb.length
        ? selectedThreadMessagesFromDb
        : messagesCacheRef.current.get(selectedThreadId) ||
          messagesByThread.get(selectedThreadId) ||
          [];
    // Hard filter: never let a message belonging to a different mail_threads
    // row pollute this composer. Defends against any upstream source (cached
    // sibling-thread results, stray realtime payloads, etc.) silently bleeding
    // another customer's draft into the open ticket. — 2026-05-26
    const base = rawBase.filter(
      (message) => String(message?.thread_id || "") === String(selectedThreadId),
    );
    const local = localSentMessagesByThread[selectedThreadId] || [];
    const byId = new Map();
    [...base, ...local].forEach((message) => {
      const key =
        message?.id ||
        `${message?.thread_id || "thread"}:${message?.created_at || ""}`;
      if (!key) return;
      byId.set(key, message);
    });
    return Array.from(byId.values()).sort((a, b) => {
      const aTime = new Date(getMessageTimestamp(a)).getTime();
      const bTime = new Date(getMessageTimestamp(b)).getTime();
      return aTime - bTime;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messagesCacheRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
  }, [
    localSentMessagesByThread,
    messagesFetchedForThreadId,
    messagesByThread,
    selectedThreadId,
    selectedThreadMessagesFromDb,
  ]);

  const hasSelectedThreadMessageCache = useMemo(() => {
    if (!selectedThreadId) return false;
    return (
      messagesCacheRef.current.has(selectedThreadId) ||
      (messagesByThread.get(selectedThreadId) || []).length > 0
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messagesCacheRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
  }, [messagesByThread, selectedThreadId]);

  const isSelectedConversationLoading = Boolean(
    selectedThreadId &&
    !isLocalThreadId(selectedThreadId) &&
    (selectedThreadMessagesLoading ||
      messagesFetchedForThreadId !== selectedThreadId) &&
    !hasSelectedThreadMessageCache,
  );

  useEffect(() => {
    if (
      selectedThreadId &&
      messagesFetchedForThreadId === selectedThreadId &&
      Array.isArray(selectedThreadMessagesFromDb) &&
      selectedThreadMessagesFromDb.length
    ) {
      messagesCacheRef.current.set(
        selectedThreadId,
        selectedThreadMessagesFromDb,
      );
      const startedAt = ticketSwitchStartedAtRef.current.get(selectedThreadId);
      if (startedAt) {
        reportClientEvent({
          event: "ticket_switch_completed",
          threadId: selectedThreadId,
          status: "loaded",
          durationMs:
            (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            startedAt,
        });
        ticketSwitchStartedAtRef.current.delete(selectedThreadId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messagesCacheRef is a ref returned by useThreadSelection (backed by useRef); identity never changes.
  }, [
    messagesFetchedForThreadId,
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

  const selectedThreadMessageIds = useMemo(
    () =>
      rawThreadMessages
        .map((message) => String(message?.id || "").trim())
        .filter(Boolean),
    [rawThreadMessages],
  );

  const { data: selectedThreadAttachments } = useThreadAttachments(
    selectedThreadMessageIds,
    {
      enabled:
        Boolean(selectedThreadId) &&
        !String(selectedThreadId || "").startsWith("local-new-ticket-") &&
        messagesFetchedForThreadId !== selectedThreadId &&
        selectedThreadMessageIds.length > 0,
    },
  );

  const threadAttachments = useMemo(() => {
    if (!selectedThreadId) return [];
    const messageIdSet = new Set(selectedThreadMessageIds);
    if (!messageIdSet.size) return [];
    const byId = new Map();
    [
      ...(liveAttachments || []),
      ...(selectedThreadAttachmentsFromDb || []),
      ...(selectedThreadAttachments || []),
    ].forEach((attachment) => {
      const attachmentId = String(attachment?.id || "").trim();
      const attachmentMessageId = String(attachment?.message_id || "").trim();
      if (!attachmentMessageId || !messageIdSet.has(attachmentMessageId))
        return;
      const dedupeKey =
        attachmentId ||
        [
          attachmentMessageId,
          String(attachment?.provider_attachment_id || "").trim(),
          String(attachment?.filename || "")
            .trim()
            .toLowerCase(),
        ].join("::");
      if (!byId.has(dedupeKey)) byId.set(dedupeKey, attachment);
    });
    return Array.from(byId.values());
  }, [
    liveAttachments,
    selectedThreadAttachments,
    selectedThreadAttachmentsFromDb,
    selectedThreadId,
    selectedThreadMessageIds,
  ]);

  const draftMessage = useMemo(() => {
    const reversed = [...rawThreadMessages].reverse();
    return (
      reversed.find((message) => message?.is_draft && message?.from_me) || null
    );
  }, [rawThreadMessages]);

  const latestRealMessage = useMemo(() => {
    const reversed = [...rawThreadMessages].reverse();
    return reversed.find((message) => !message?.is_draft) || null;
  }, [rawThreadMessages]);
  const latestRealMessageIsOutbound = Boolean(latestRealMessage?.from_me);

  const aiDraft = useMemo(() => {
    if (draftMessage) return "";
    if (latestRealMessageIsOutbound) return "";
    const reversed = [...rawThreadMessages].reverse();
    const match = reversed.find((message) => message.ai_draft_text?.trim());
    return match?.ai_draft_text?.trim() || "";
  }, [draftMessage, latestRealMessageIsOutbound, rawThreadMessages]);

  // Count of real inbound messages — used to detect when a new customer message arrives.
  const inboundMessageCount = useMemo(
    () => rawThreadMessages.filter((m) => !m.from_me && !m.is_draft).length,
    [rawThreadMessages],
  );

  const {
    ticketStateByThread,
    setTicketStateByThread,
    pendingUpdateThreadIds,
    pendingOrderUpdateByThread,
    setPendingOrderUpdateByThread,
    returnCaseByThread,
    setReturnCaseByThread,
    orderUpdateDecisionByThread,
    setOrderUpdateDecisionByThread,
    orderUpdateSubmittingByThread,
    setOrderUpdateSubmittingByThread,
    orderUpdateErrorByThread,
    setOrderUpdateErrorByThread,
    markReturnReceivedLoadingByThread,
    setMarkReturnReceivedLoadingByThread,
    refreshPendingActionByThread,
    setRefreshPendingActionByThread,
    handleMarkReturnReceived,
    handleTicketStateChange,
    handleOrderUpdateDecision,
  } = useThreadActions({
    derivedThreads,
    selectedThreadId,
    selectedThreadIdRef,
    selectedThreadDetail,
    messagesFetchedForThreadId,
    selectedThreadMessagesLoading,
    threadMessages,
    filteredThreads,
    isLocalThreadId,
    supabase,
    mailboxEmails,
    currentUserName,
    setOpenThreadIds,
    setSelectedThreadId,
    setDraftValue: null,
    setDraftValueByThread: null,
    setSystemDraftUneditedByThread: null,
    setActiveDraftId: null,
    setSignatureByThread: null,
    setPostApprovalDraftLoadingByThread: null,
    draftValueRef: null,
    draftLastSavedRef: null,
    asString,
    isApprovalManagedActionType,
    getDecisionFromActionStatus,
    DEFAULT_TICKET_STATE,
  });

  const {
    composerMode,
    setComposerMode,
    draftValue,
    setDraftValue,
    draftValueByThread,
    setDraftValueByThread,
    noteValueByThread,
    setNoteValueByThread,
    setSignatureByThread,
    activeDraftId,
    setActiveDraftId,
    isSending,
    setIsSending,
    suppressAutoDraftByThread,
    setSuppressAutoDraftByThread,
    proposalOnlyByThread,
    setProposalOnlyByThread,
    draftReady,
    setDraftReady,
    draftWaitTimedOutByThread,
    setDraftWaitTimedOutByThread,
    systemDraftUneditedByThread,
    setSystemDraftUneditedByThread,
    manualDraftGeneratingByThread,
    setManualDraftGeneratingByThread,
    postApprovalDraftLoadingByThread,
    setPostApprovalDraftLoadingByThread,
    refineDraftLoadingByThread,
    setRefineDraftLoadingByThread,
    tagsRefreshTriggerByThread,
    setTagsRefreshTriggerByThread,
    staleDraftByThread,
    setStaleDraftByThread,
    draftLogId,
    setDraftLogId,
    draftLogLoading,
    setDraftLogLoading,
    draftLogIdByThread,
    setDraftLogIdByThread,
    sendingStartedAtRef,
    draftLastSavedRef,
    savingDraftThreadIdsRef,
    draftValueRef,
    activeNoteValue,
    composerValue,
    handleGenerateDraft,
    handleRefineDraft,
    handleDraftChange,
    saveThreadDraft,
    handleSendDraft,
  } = useComposerState({
    selectedThreadId,
    selectedThreadIdRef,
    selectedThread,
    selectedThreadDetail,
    messagesFetchedForThreadId,
    selectedThreadMessagesLoading,
    isLocalThreadId,
    supabase,
    derivedThreads,
    aiDraft,
    draftMessage,
    latestRealMessageIsOutbound,
    inboundMessageCount,
    mailboxEmails,
    currentSupabaseUserId,
    currentUserName,
    draftCacheRef,
    refreshSelectedThreadMessages,
    refreshSelectedThreadMessagesRef,
    pendingOrderUpdateByThread,
    setPendingOrderUpdateByThread,
    setReturnCaseByThread,
    setOrderUpdateDecisionByThread,
    setLiveThreads,
    setTicketStateByThread,
    setSentDraftStatsByThread,
    setLocalSentMessagesByThread,
    asString,
    getDecisionFromActionStatus,
    DEFAULT_TICKET_STATE,
  });

  const customerLookupParams = useMemo(() => {
    const inboundCandidates = [...threadMessages]
      .filter((message) => !isOutboundMessage(message, mailboxEmails))
      .reverse();
    const pickMessageBody = (message) =>
      message?.clean_body_text || message?.body_text || "";
    const inboundWithOrder = inboundCandidates.find((message) => {
      const body = pickMessageBody(message);
      return (
        extractOrderNumber(message?.subject || "") || extractOrderNumber(body)
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
  }, [
    mailboxEmails,
    selectedThread?.subject,
    selectedThreadId,
    threadMessages,
  ]);

  const {
    data: customerLookup,
    loading: customerLookupLoading,
    error: customerLookupError,
    refresh: refreshCustomerLookup,
  } = useCustomerLookup({
    ...customerLookupParams,
    enabled:
      Boolean(selectedThreadId) &&
      (Boolean(pendingOrderUpdateByThread[selectedThreadId]) ||
        (Array.isArray(selectedThread?.tags) &&
          selectedThread.tags.includes("Tracking") &&
          !selectedThread.tags.some((t) => /^return/i.test(String(t || ""))) &&
          !["return", "exchange"].includes(
            String(selectedThread?.classification_key || "").toLowerCase(),
          ))),
  });

  const actions = useMemo(() => {
    return MOCK_ACTIONS.map((action) => ({
      ...action,
      id: `${selectedThreadId || "thread"}-${action.id}`,
      threadId: selectedThreadId || "",
    }));
  }, [selectedThreadId]);

  const fetchTranslationForThread = useCallback(async (threadId) => {
    if (!threadId) return;
    setTranslationCache((prev) => {
      if (prev[threadId]?.loading) return prev;
      return { ...prev, [threadId]: { loading: true, items: [], draft: null } };
    });
    try {
      const res = await fetch(
        `/api/inbox/threads/${encodeURIComponent(threadId)}/translation`,
        { method: "GET", cache: "no-store", credentials: "include" },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Translation failed.");
      setTranslationCache((prev) => ({
        ...prev,
        [threadId]: {
          loading: false,
          items: Array.isArray(payload?.conversation?.items)
            ? payload.conversation.items
            : [],
          draft: payload?.draft || null,
        },
      }));
    } catch {
      setTranslationCache((prev) => ({
        ...prev,
        [threadId]: { loading: false, items: [], draft: null },
      }));
    }
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFilters is the stable setter returned by useThreadFilters (backed by useState); identity never changes, so omitting it matches the pre-extraction behavior when it was a local useState setter.
  }, [router]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpenThreadIds and setSelectedThreadId are the stable setters returned by useThreadSelection (backed by useState); identity never changes, so omitting them matches the pre-extraction behavior when they were local useState setters.
  }, []);

  useEffect(() => {
    setTitleContent(
      <InboxContentBoundary resetKey={`tabs:${selectedThreadId || "no-thread"}`}>
        <div className="flex min-w-0 flex-1 items-center">
          <div className="hidden h-10 shrink-0 items-center justify-end gap-3 bg-background px-3 lg:flex lg:w-[clamp(18rem,20vw,24rem)] lg:min-w-[clamp(18rem,20vw,24rem)] lg:max-w-[clamp(18rem,20vw,24rem)]">
            <button
              type="button"
              onClick={handleViewAllTickets}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              View all
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            {unreadThreadCount > 0 ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
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
      </InboxContentBoundary>,
    );
    return () => setTitleContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSelectedThreadId is the stable setter returned by useThreadSelection (backed by useState); identity never changes, so omitting it matches the pre-extraction behavior when it was a local useState setter.
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
    const selectedStatuses = Array.isArray(filters.statuses)
      ? filters.statuses
      : filters.status && filters.status !== "All"
          ? [filters.status]
          : [];
    if (activeView === "" && selectedStatuses.includes("Solved")) {
      setFilters((prev) => ({
        ...prev,
        statuses: selectedStatuses.filter((status) => status !== "Solved"),
        status: "All",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFilters is the stable setter returned by useThreadFilters (backed by useState); identity never changes, so omitting it matches the pre-extraction behavior when it was a local useState setter.
  }, [activeView, filters.status, filters.statuses]);

  const handleInboxChange = useCallback(
    (destination) => {
      if (!selectedThreadId) return;
      const normalized =
        typeof destination?.inboxSlug === "string"
          ? destination.inboxSlug.trim()
          : "";
      const nextClassificationKey =
        String(destination?.classificationKey || "support")
          .trim()
          .toLowerCase() === "notification"
          ? "notification"
          : "support";
      const shouldApplySenderRule = Boolean(destination?.applySenderRule);
      const senderRuleEmail = String(destination?.senderRuleEmail || "")
        .trim()
        .toLowerCase();
      const previousThread =
        derivedThreads.find((thread) => thread.id === selectedThreadId) || null;
      const previousTags = previousThread?.tags || [];
      const previousClassificationKey =
        previousThread?.classification_key || null;
      const previousClassificationConfidence =
        previousThread?.classification_confidence ?? null;
      const previousClassificationReason =
        previousThread?.classification_reason || null;
      setLiveThreads((prev) =>
        (prev || []).map((thread) => {
          if (thread.id !== selectedThreadId) return thread;
          const tags = Array.isArray(thread.tags) ? thread.tags : [];
          const withoutInbox = tags.filter(
            (tag) => !String(tag || "").startsWith("inbox:"),
          );
          return {
            ...thread,
            tags: normalized
              ? [...withoutInbox, toInboxTag(normalized)]
              : withoutInbox,
            classification_key: nextClassificationKey,
            classification_confidence: 1,
            classification_reason:
              nextClassificationKey === "notification"
                ? "manual_move_to_notifications"
                : "manual_move_to_tickets",
          };
        }),
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
          if (response.ok && data?.thread?.id) {
            return;
          }
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
            }),
          );
          toast.error(error.message || "Could not update inbox.");
        });

      if (shouldApplySenderRule && senderRuleEmail) {
        const senderRuleDestinationType = normalized
          ? "inbox"
          : "classification";
        const senderRuleDestinationValue = normalized || nextClassificationKey;
        fetch("/api/settings/email-sender-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            matcher_type: "email",
            matcher_value: senderRuleEmail,
            destination_type: senderRuleDestinationType,
            destination_value: senderRuleDestinationValue,
            is_active: true,
          }),
        })
          .then(async (response) => {
            const data = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(data?.error || "Could not save sender rule.");
            }
            toast.success(`Sender rule saved for ${senderRuleEmail}.`);
          })
          .catch((error) => {
            toast.error(error.message || "Could not save sender rule.");
          });
      }
    },
    [derivedThreads, selectedThreadId],
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key.toLowerCase() !== "e") return;
      if (!selectedThreadId || isLocalThreadId(selectedThreadId)) return;
      event.preventDefault();
      handleTicketStateChange({ status: "Solved" });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleTicketStateChange, isLocalThreadId, selectedThreadId]);

  const handleAssignmentChange = useCallback(
    (value) => {
      const selected = String(value || "");
      if (!selected || selected === UNASSIGNED_ASSIGNEE_VALUE) {
        handleTicketStateChange({ assignee: null });
        return;
      }
      if (selected.startsWith("user:")) {
        handleTicketStateChange({
          assignee: selected.slice("user:".length) || null,
        });
      }
    },
    [handleTicketStateChange],
  );

  const handleSelectThreadInWorkspace = useCallback(
    (threadId, options = {}) => {
      const nextThreadId = String(threadId || "").trim();
      const previousThreadId = String(selectedThreadIdRef.current || "").trim();
      const previousDraftValue = draftValueRef.current;
      if (nextThreadId) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        ticketSwitchStartedAtRef.current.set(nextThreadId, now);
        reportClientEvent({
          event: "ticket_switch_started",
          threadId: nextThreadId,
          status: messagesCacheRef.current.has(nextThreadId) ? "cache_hit" : "cold",
        });
        if (messagesCacheRef.current.has(nextThreadId)) {
          reportClientEvent({
            event: "ticket_switch_completed",
            threadId: nextThreadId,
            status: "cache_hit",
            durationMs: 0,
          });
          ticketSwitchStartedAtRef.current.delete(nextThreadId);
        }
      }
      openThreadInWorkspace(threadId, options);
      if (previousThreadId && previousThreadId !== nextThreadId) {
        deferAfterInteraction(() => {
          saveThreadDraft({
            immediate: true,
            threadIdOverride: previousThreadId,
            valueOverride: previousDraftValue,
          });
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messagesCacheRef and selectedThreadIdRef are refs returned by useThreadSelection (backed by useRef); identity never changes.
    [openThreadInWorkspace, saveThreadDraft],
  );

  const handleOpenPreviousTicket = useCallback(
    (threadId) => {
      const nextThreadId = String(threadId || "").trim();
      if (!nextThreadId) return;
      handleSelectThreadInWorkspace(nextThreadId, { newTab: false });
      setInsightsOpen(false);
    },
    [handleSelectThreadInWorkspace],
  );

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

  const deleteThreadById = useCallback(
    async (threadId) => {
      if (!threadId || deletingThread) return;
      if (isLocalThreadId(threadId)) {
        setLocalNewThread(null);
        setOpenThreadIds((prev) =>
          prev.filter((openThreadId) => openThreadId !== threadId),
        );
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
      const confirmed = window.confirm(
        "Are you sure you want to delete this ticket? This cannot be undone.",
      );
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
        setOpenThreadIds((prev) =>
          prev.filter((openThreadId) => openThreadId !== threadId),
        );
        if (selectedThreadId === threadId) {
          setSelectedThreadId(null);
        }
        setDraftValue("");
        setDraftValueByThread((prev) => {
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
        setLocalSentMessagesByThread((prev) => {
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
        setTicketStateByThread((prev) => {
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
        setLiveThreads((prev) =>
          (prev || []).filter(
            (thread) => String(thread?.id || "") !== String(threadId || ""),
          ),
        );
        setLiveMessages((prev) =>
          (prev || []).filter(
            (message) =>
              String(message?.thread_id || "") !== String(threadId || ""),
          ),
        );
        setActiveDraftId(null);
      } catch (error) {
        toast.error(error?.message || "Could not delete ticket.");
      } finally {
        setDeletingThread(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpenThreadIds and setSelectedThreadId are the stable setters returned by useThreadSelection (backed by useState); identity never changes, so omitting them matches the pre-extraction behavior when they were local useState setters.
    [deletingThread, isLocalThreadId, selectedThreadId],
  );

  const handleDeleteThread = useCallback(() => {
    if (!selectedThreadId) return;
    deleteThreadById(selectedThreadId);
  }, [deleteThreadById, selectedThreadId]);

  const getThreadTimestamp = useCallback((thread) => thread.last_message_at || "", []);

  const getThreadUnreadCount = useCallback(
    (thread) => {
      if (readOverrides[thread.id] || thread.is_read) return 0;
      return thread.unread_count || 0;
    },
    [readOverrides],
  );

  const handleConversationScroll = useCallback(
    (scrollTop) => {
      if (!selectedThreadId) return;
      const threadId = selectedThreadId;
      scrollPositionByThreadRef.current[threadId] = scrollTop;
      if (scrollSaveFrameRef.current) return;
      scrollSaveFrameRef.current = requestAnimationFrame(() => {
        scrollSaveFrameRef.current = null;
        const nextScrollTop = scrollPositionByThreadRef.current[threadId] || 0;
        setScrollPositionByThread((prev) =>
          prev[threadId] === nextScrollTop
            ? prev
            : {
                ...prev,
                [threadId]: nextScrollTop,
              },
        );
      });
    },
    [selectedThreadId],
  );

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
        orderShippingAddress:
          customerLookup?.orders?.[0]?.shippingAddress || null,
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
    () =>
      threadMessages.length ? threadMessages[threadMessages.length - 1] : null,
    [threadMessages],
  );
  const latestMessageIsInbound = latestThreadMessage
    ? !isOutboundMessage(latestThreadMessage, mailboxEmails)
    : false;
  const hasDraftContentReady =
    Boolean(draftMessage) ||
    Boolean(aiDraft) ||
    Boolean(String(draftValue || "").trim());
  const pendingDecisionForSelectedThread = selectedThreadId
    ? pendingOrderUpdateByThread[selectedThreadId]
    : null;
  const isWaitingForApproval =
    Boolean(pendingDecisionForSelectedThread) &&
    !["accepted", "denied"].includes(
      String(orderUpdateDecisionByThread[selectedThreadId] || "").toLowerCase(),
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
        key={activeView}
        threads={filteredThreads}
        selectedThreadId={selectedThreadId}
        ticketStateByThread={ticketStateByThread}
        customerByThread={customerByThread}
        onSelectThread={handleSelectThreadInWorkspace}
        onPrefetchThread={handlePrefetchThread}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        getTimestamp={getThreadTimestamp}
        getUnreadCount={getThreadUnreadCount}
        onCreateTicket={handleCreateTicket}
        onOpenInNewTab={(threadId) =>
          handleSelectThreadInWorkspace(threadId, { newTab: true })
        }
        onDeleteThread={deleteThreadById}
        hideSolvedFilter={activeView === ""}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar">
        <InboxContentBoundary resetKey={selectedThreadId || "no-thread"}>
          <TicketDetail
          thread={selectedThread}
          messages={threadMessages}
          attachments={threadAttachments}
          sentDraftStats={sentDraftStatsByThread[selectedThreadId] || null}
          customerLookup={customerLookup}
          threadOrderNumber={customerLookupParams.orderNumber || ""}
          mentionUsers={effectiveMentionUsers}
          currentUserName={currentUserName}
          ticketState={
            ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE
          }
          onTicketStateChange={handleTicketStateChange}
          onOpenInsights={() => setInsightsOpen(true)}
          showThinkingCard={isDraftGenerating}
          isDraftFetching={
            !draftReady &&
            !isDraftGenerating &&
            !isLocalThreadId(selectedThreadId)
          }
          isPostApprovalDraftLoading={Boolean(
            selectedThreadId && postApprovalDraftLoadingByThread[selectedThreadId],
          )}
          isConversationLoading={isSelectedConversationLoading}
          draftValue={composerValue}
          onDraftChange={handleDraftChange}
          onDraftBlur={(threadId) =>
            saveThreadDraft({
              immediate: true,
              threadIdOverride: threadId,
              valueOverride:
                String(threadId || "") ===
                String(selectedThreadIdRef.current || "")
                  ? draftValueRef.current
                  : draftValueByThread[String(threadId || "").trim()] || "",
            })
          }
          draftLoaded={
            composerMode !== "note" &&
            Boolean(selectedThreadId) &&
            Boolean(draftValue.trim()) &&
            Boolean(systemDraftUneditedByThread[selectedThreadId])
          }
          canSend={
            Boolean(selectedThreadId) && !isLocalThreadId(selectedThreadId)
          }
          onSend={handleSendDraft}
          pendingOrderUpdate={selectedPendingOrderUpdate}
          returnCase={
            selectedThreadId
              ? returnCaseByThread[selectedThreadId] || null
              : null
          }
          orderUpdateDecision={
            selectedThreadId
              ? orderUpdateDecisionByThread[selectedThreadId] || null
              : null
          }
          onOrderUpdateDecision={handleOrderUpdateDecision}
          orderUpdateSubmitting={
            selectedThreadId
              ? Boolean(orderUpdateSubmittingByThread[selectedThreadId])
              : false
          }
          orderUpdateError={
            selectedThreadId
              ? orderUpdateErrorByThread[selectedThreadId] || null
              : null
          }
          isSending={isSending}
          composerMode={composerMode}
          onComposerModeChange={setComposerMode}
          mailboxEmails={mailboxEmails}
          isWorkspaceTestMode={isWorkspaceTestMode}
	          conversationScrollTop={
	            selectedThreadId ? scrollPositionByThread[selectedThreadId] || 0 : 0
	          }
	          onConversationScroll={handleConversationScroll}
          headerActions={
            selectedThreadId ? (
              <InboxHeaderActions
                threadId={selectedThreadId}
                senderRuleSourceEmail={selectedThread?.customer_email || ""}
                tagsRefreshTrigger={
                  tagsRefreshTriggerByThread[selectedThreadId] || 0
                }
                ticketState={selectedTicketState}
                assignmentOptions={assignmentOptions}
                selectedAssignmentValue={selectedAssignmentValue}
                inboxOptions={inboxOptions}
                selectedInboxBucket={selectedInboxBucket}
                selectedInboxSlug={selectedInboxSlug}
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
          detectedLanguage={selectedThread?.customer_language || null}
          onGenerateDraft={handleGenerateDraft}
          isGeneratingDraft={Boolean(
            selectedThreadId && manualDraftGeneratingByThread[selectedThreadId],
          )}
          onRefineDraft={handleRefineDraft}
          isRefiningDraft={Boolean(
            refineDraftLoadingByThread[selectedThreadId],
          )}
          tagsRefreshTrigger={
            selectedThreadId
              ? tagsRefreshTriggerByThread[selectedThreadId] || 0
              : 0
          }
          staleDraft={Boolean(
            selectedThreadId && staleDraftByThread[selectedThreadId],
          )}
          onDismissStaleDraft={() => {
            if (!selectedThreadId) return;
            setStaleDraftByThread((prev) => {
              const next = { ...prev };
              delete next[selectedThreadId];
              return next;
            });
          }}
          awaitingReturn={isAwaitingReturn}
          onMarkReturnReceived={handleMarkReturnReceived}
          markReturnReceivedLoading={Boolean(
            selectedThreadId &&
            markReturnReceivedLoadingByThread[selectedThreadId],
          )}
          translationItems={translationCache[selectedThreadId]?.items || []}
          translationLoading={
            translationCache[selectedThreadId]?.loading || false
          }
          onRequestTranslation={() =>
            fetchTranslationForThread(selectedThreadId)
          }
          />
        </InboxContentBoundary>
      </div>

      <InboxContentBoundary resetKey={`insights:${selectedThreadId || "no-thread"}`}>
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
          onOpenTicket={handleOpenPreviousTicket}
        />
      </InboxContentBoundary>

      <TranslationModal
        open={translationModalOpen}
        onOpenChange={(open) => {
          setTranslationModalOpen(open);
          if (
            open &&
            selectedThreadId &&
            !translationCache[selectedThreadId]?.items?.length
          ) {
            fetchTranslationForThread(selectedThreadId);
          }
        }}
        threadId={selectedThreadId}
        translationData={translationCache[selectedThreadId] || null}
      />
    </div>
  );
}
