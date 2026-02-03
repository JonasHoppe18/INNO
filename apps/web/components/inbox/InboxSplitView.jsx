"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TicketList } from "@/components/inbox/TicketList";
import { TicketDetail } from "@/components/inbox/TicketDetail";
import { SonaInsightsModal } from "@/components/inbox/SonaInsightsModal";
import { deriveThreadsFromMessages } from "@/hooks/useInboxData";
import { getMessageTimestamp, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { toast } from "sonner";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { useSiteHeaderActions } from "@/components/site-header-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle, CheckCircle2, Plus, User } from "lucide-react";

const DEFAULT_TICKET_STATE = {
  status: "New",
  assignee: null,
  priority: null,
};

const STATUS_OPTIONS = ["New", "Open", "Waiting", "Solved"];
const ASSIGNEE_OPTIONS = ["Unassigned", "Emma", "Jonas", "Support Bot"];

const normalizeStatus = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "solved" || normalized === "resolved") return "Solved";
  if (normalized === "waiting") return "Waiting";
  if (normalized === "open") return "Open";
  if (normalized === "new") return "New";
  return value;
};

function InboxHeaderActions({
  ticketState,
  tagLabel,
  onTicketStateChange,
  onOpenInsights,
}) {
  if (!ticketState) return null;
  const statusLabel =
    ticketState.status === "Solved" ? "Resolved" : ticketState.status;
  const statusStylesByStatus = {
    New: "bg-green-50 text-green-700 border-green-200",
    Open: "bg-blue-50 text-blue-700 border-blue-200",
    Waiting: "bg-orange-50 text-orange-700 border-orange-200",
    Solved: "bg-red-50 text-red-700 border-red-200",
  };
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
        value={ticketState.assignee || "Unassigned"}
        onValueChange={(value) =>
          onTicketStateChange({ assignee: value === "Unassigned" ? null : value })
        }
      >
        <SelectTrigger className="h-auto w-auto cursor-pointer gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
          <User className="h-3.5 w-3.5" />
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          {ASSIGNEE_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
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
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-gray-400"
      >
        <Plus className="h-3.5 w-3.5" />
        Add tag
      </button>
      <button
        type="button"
        onClick={onOpenInsights}
        className="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300"
      >
        View actions
      </button>
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

export function InboxSplitView({ messages = [], threads = [] }) {
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [ticketStateByThread, setTicketStateByThread] = useState({});
  const [readOverrides, setReadOverrides] = useState({});
  const [filters, setFilters] = useState({
    query: "",
    status: "All",
    unreadsOnly: false,
  });
  const [composerMode, setComposerMode] = useState("reply");
  const [draftValue, setDraftValue] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [draftLogId, setDraftLogId] = useState(null);
  const headerActionsKeyRef = useRef("");
  const supabase = useClerkSupabase();
  const { setActions: setHeaderActions } = useSiteHeaderActions();

  const derivedThreads = useMemo(() => {
    if (threads?.length) return threads;
    return deriveThreadsFromMessages(messages);
  }, [messages, threads]);

  useEffect(() => {
    if (!derivedThreads.length) {
      setSelectedThreadId((prev) => (prev === null ? prev : null));
      return;
    }
    setSelectedThreadId((prev) => {
      if (prev && derivedThreads.some((thread) => thread.id === prev)) {
        return prev;
      }
      return derivedThreads[0].id;
    });
  }, [derivedThreads]);

  useEffect(() => {
    if (!derivedThreads.length) return;
    setTicketStateByThread((prev) => {
      let changed = false;
      const next = { ...prev };
      derivedThreads.forEach((thread) => {
        if (next[thread.id]) return;
        const unread = thread.unread_count ?? 0;
        next[thread.id] = {
          ...DEFAULT_TICKET_STATE,
          status: normalizeStatus(thread.status) || "New",
          priority: thread.priority ?? DEFAULT_TICKET_STATE.priority,
          assignee: thread.assignee_id ?? DEFAULT_TICKET_STATE.assignee,
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [derivedThreads]);

  const messagesByThread = useMemo(() => {
    const map = new Map();
    messages.forEach((message) => {
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
  }, [messages]);

  const mailboxEmails = useMemo(() => {
    const emails = new Set();
    messages.forEach((message) => {
      (message.to_emails || []).forEach((email) => emails.add(email));
      (message.cc_emails || []).forEach((email) => emails.add(email));
      (message.bcc_emails || []).forEach((email) => emails.add(email));
    });
    return Array.from(emails);
  }, [messages]);

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
    return derivedThreads.filter((thread) => {
      const uiState = ticketStateByThread[thread.id] || DEFAULT_TICKET_STATE;
      if (filters.status !== "All" && uiState.status !== filters.status) {
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
    });
  }, [customerByThread, derivedThreads, filters, ticketStateByThread]);

  const selectedThread = useMemo(
    () => derivedThreads.find((thread) => thread.id === selectedThreadId) || null,
    [derivedThreads, selectedThreadId]
  );
  const selectedTicketState = ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE;
  const selectedTagLabel =
    Array.isArray(selectedThread?.tags) && selectedThread.tags.length
      ? selectedThread.tags[0]
      : "General";

  useEffect(() => {
    let active = true;
    const fetchDraftLogId = async () => {
      if (!supabase || !selectedThread?.provider_thread_id) {
        if (active) setDraftLogId(null);
        return;
      }
      const { data, error } = await supabase
        .from("drafts")
        .select("id")
        .eq("thread_id", selectedThread.provider_thread_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setDraftLogId(null);
        return;
      }
      setDraftLogId(typeof data?.id === "number" ? data.id : null);
    };
    fetchDraftLogId();
    return () => {
      active = false;
    };
  }, [selectedThread?.provider_thread_id, supabase]);

  useEffect(() => {
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
  }, [derivedThreads, selectedThreadId, supabase, ticketStateByThread]);

  const threadMessages = useMemo(() => {
    if (!selectedThreadId) return [];
    return messagesByThread.get(selectedThreadId) || [];
  }, [messagesByThread, selectedThreadId]);

  const threadAttachments = useMemo(() => [], []);

  const draftMessage = useMemo(
    () => threadMessages.find((message) => message?.is_draft && message?.from_me) || null,
    [threadMessages]
  );

  const aiDraft = useMemo(() => {
    if (draftMessage) return "";
    const reversed = [...threadMessages].reverse();
    const match = reversed.find((message) => message.ai_draft_text?.trim());
    return match?.ai_draft_text?.trim() || "";
  }, [draftMessage, threadMessages]);

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
    enabled: insightsOpen && Boolean(selectedThreadId),
  });

  const actions = useMemo(() => {
    return MOCK_ACTIONS.map((action) => ({
      ...action,
      id: `${selectedThreadId || "thread"}-${action.id}`,
      threadId: selectedThreadId || "",
    }));
  }, [selectedThreadId]);

  useEffect(() => {
    setDraftValue("");
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !aiDraft) return;
    setDraftValue((prev) => (prev ? prev : aiDraft));
  }, [aiDraft, selectedThreadId]);

  useEffect(() => {
    if (!draftMessage) return;
    const draftBody = draftMessage.body_text || draftMessage.body_html || "";
    setDraftValue((prev) => (prev ? prev : draftBody));
  }, [draftMessage]);

  const handleFiltersChange = (updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const handleTicketStateChange = (updates) => {
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
  };

  useEffect(() => {
    if (!setHeaderActions) return;
    if (!selectedThreadId) {
      headerActionsKeyRef.current = "";
      setHeaderActions(null);
      return;
    }
    const key = `${selectedThreadId}:${selectedTicketState?.status || ""}:${
      selectedTicketState?.assignee || ""
    }`;
    if (headerActionsKeyRef.current === key) return;
    headerActionsKeyRef.current = key;
    setHeaderActions(
      <InboxHeaderActions
        ticketState={selectedTicketState}
        tagLabel={selectedTagLabel}
        onTicketStateChange={handleTicketStateChange}
        onOpenInsights={() => setInsightsOpen(true)}
      />
    );
  }, [
    handleTicketStateChange,
    selectedTicketState,
    selectedThreadId,
    selectedTagLabel,
    setHeaderActions,
  ]);

  useEffect(() => {
    if (!setHeaderActions) return;
    return () => setHeaderActions(null);
  }, [setHeaderActions]);

  const handleSendDraft = async () => {
    if (!draftMessage?.id) {
      toast.error("No draft to send.");
      return;
    }
    if (!draftValue.trim()) {
      toast.error("Draft is empty.");
      return;
    }
    if (!supabase) {
      toast.error("Supabase client not ready.");
      return;
    }
    const toastId = toast.loading("Sending draft...");
    try {
      const { error } = await supabase
        .from("mail_messages")
        .update({
          body_text: draftValue,
          body_html: draftValue,
          is_draft: false,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", draftMessage.id);
      if (error) throw error;
      toast.success("Draft sent.", { id: toastId });
    } catch (err) {
      toast.error("Could not send draft.", { id: toastId });
    }
  };


  const getThreadTimestamp = (thread) => thread.last_message_at || "";

  const getThreadUnreadCount = (thread) => {
    if (readOverrides[thread.id] || thread.is_read) return 0;
    return thread.unread_count || 0;
  };

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
      />

      <TicketDetail
        thread={selectedThread}
        messages={threadMessages}
        attachments={threadAttachments}
        ticketState={ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE}
        onTicketStateChange={handleTicketStateChange}
        onOpenInsights={() => setInsightsOpen(true)}
        draftValue={draftValue}
        onDraftChange={setDraftValue}
        draftLoaded={Boolean(draftMessage)}
        canSend={Boolean(draftMessage?.id)}
        onSend={handleSendDraft}
        composerMode={composerMode}
        onComposerModeChange={setComposerMode}
        mailboxEmails={mailboxEmails}
      />

      <SonaInsightsModal
        open={insightsOpen}
        onOpenChange={setInsightsOpen}
        actions={actions}
        draftId={draftLogId}
        customerLookup={customerLookup}
        customerLookupLoading={customerLookupLoading}
        customerLookupError={customerLookupError}
        onCustomerRefresh={refreshCustomerLookup}
      />
    </div>
  );
}
