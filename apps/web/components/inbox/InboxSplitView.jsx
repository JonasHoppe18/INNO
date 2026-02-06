"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TicketList } from "@/components/inbox/TicketList";
import { TicketDetail } from "@/components/inbox/TicketDetail";
import { SonaInsightsModal } from "@/components/inbox/SonaInsightsModal";
import { deriveThreadsFromMessages } from "@/hooks/useInboxData";
import { getMessageTimestamp, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { useSiteHeaderActions } from "@/components/site-header-actions";
import { useRouter } from "next/navigation";
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
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [suppressAutoDraftByThread, setSuppressAutoDraftByThread] = useState({});
  const [draftReady, setDraftReady] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [draftLogId, setDraftLogId] = useState(null);
  const sendingStartedAtRef = useRef(0);
  const [deletingThread, setDeletingThread] = useState(false);
  const headerActionsKeyRef = useRef("");
  const draftLastSavedRef = useRef("");
  const savingDraftRef = useRef(false);
  const draftValueRef = useRef("");
  const supabase = useClerkSupabase();
  const { user } = useUser();
  const { setActions: setHeaderActions } = useSiteHeaderActions();
  const router = useRouter();
  const currentUserName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "You";

  useEffect(() => {
    draftValueRef.current = draftValue;
  }, [draftValue]);

  const isLocalThreadId = useCallback(
    (threadId) => String(threadId || "").startsWith("local-new-ticket-"),
    []
  );

  const derivedThreads = useMemo(() => {
    const base = threads?.length ? threads : deriveThreadsFromMessages(messages);
    return localNewThread ? [localNewThread, ...base] : base;
  }, [localNewThread, messages, threads]);

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
    return derivedThreads
      .filter((thread) => {
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
      })
      .sort((a, b) => {
        const aTs = Date.parse(a?.last_message_at || a?.updated_at || a?.created_at || 0);
        const bTs = Date.parse(b?.last_message_at || b?.updated_at || b?.created_at || 0);
        return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
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
  }, [derivedThreads, isLocalThreadId, selectedThreadId, supabase, ticketStateByThread]);

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
      if (message?.from_me && !message?.sent_at && !message?.received_at) return false;
      return true;
    });
  }, [rawThreadMessages]);

  const threadAttachments = useMemo(() => [], []);

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
      const draftText = draft?.body_text || draft?.body_html || "";
      if (draftText) {
        setDraftValue(draftText);
        draftLastSavedRef.current = draftText.trim();
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
    setDraftValue((prev) => (prev ? prev : aiDraft));
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
    setDraftValue((prev) => (prev ? prev : draftBody));
  }, [draftMessage, draftReady, selectedThreadId, suppressAutoDraftByThread]);

  const handleFiltersChange = (updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

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

  const saveThreadDraft = useCallback(async ({ immediate = false, valueOverride } = {}) => {
    if (isLocalThreadId(selectedThreadId)) return;
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
  }, [draftReady, isLocalThreadId, selectedThread?.subject, selectedThreadId]);

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
    if (!draftValue.trim()) {
      toast.error("Draft is empty.");
      return;
    }
    sendingStartedAtRef.current = Date.now();
    setIsSending(true);
    const toastId = toast.loading("Sending draft...");
    try {
      const res = await fetch(`/api/threads/${selectedThreadId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: draftValue,
          to_emails: payload.toRecipients,
          cc_emails: payload.ccRecipients,
          bcc_emails: payload.bccRecipients,
          sender_name: currentUserName,
          draft_message_id: draftMessage?.id || activeDraftId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not send reply.");
      }
      const nowIso = new Date().toISOString();
      setLocalSentMessagesByThread((prev) => ({
        ...prev,
        [selectedThreadId]: [
          ...(prev[selectedThreadId] || []),
          {
            id: data?.message_id || `local-sent-${Date.now()}`,
            thread_id: selectedThreadId,
            from_name: currentUserName,
            from_email: mailboxEmails[0] || "",
            from_me: true,
            to_emails: payload.toRecipients || [],
            cc_emails: payload.ccRecipients || [],
            bcc_emails: payload.bccRecipients || [],
            body_text: draftValue,
            body_html: draftValue,
            is_read: true,
            sent_at: nowIso,
            received_at: null,
            created_at: nowIso,
          },
        ],
      }));
      const providerId = data?.provider_message_id ? ` (${data.provider_message_id})` : "";
      toast.success(`Reply sent${providerId}.`, { id: toastId });
      setDraftValue("");
      setActiveDraftId(null);
      draftLastSavedRef.current = "";
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
      router.refresh();
    } catch (error) {
      toast.error(error?.message || "Could not delete ticket.");
    } finally {
      setDeletingThread(false);
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
        onCreateTicket={handleCreateTicket}
      />

      <TicketDetail
        thread={selectedThread}
        messages={threadMessages}
        attachments={threadAttachments}
        currentUserName={currentUserName}
        ticketState={ticketStateByThread[selectedThreadId] || DEFAULT_TICKET_STATE}
        onTicketStateChange={handleTicketStateChange}
        onOpenInsights={() => setInsightsOpen(true)}
        draftValue={draftValue}
        onDraftChange={setDraftValue}
        onDraftBlur={() => saveThreadDraft({ immediate: true })}
        draftLoaded={Boolean(draftMessage)}
        canSend={Boolean(selectedThreadId) && !isLocalThreadId(selectedThreadId)}
        onSend={handleSendDraft}
        onDeleteThread={handleDeleteThread}
        deletingThread={deletingThread}
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
