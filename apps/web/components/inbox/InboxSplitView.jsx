"use client";

import { useEffect, useMemo, useState } from "react";
import { TicketList } from "@/components/inbox/TicketList";
import { TicketDetail } from "@/components/inbox/TicketDetail";
import { SonaInsightsModal } from "@/components/inbox/SonaInsightsModal";
import { deriveThreadsFromMessages } from "@/hooks/useInboxData";
import { getMessageTimestamp, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { toast } from "sonner";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";

const DEFAULT_TICKET_STATE = {
  status: "Open",
  assignee: null,
  priority: null,
};

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
  const [filters, setFilters] = useState({
    query: "",
    status: "All",
    unreadsOnly: false,
  });
  const [composerMode, setComposerMode] = useState("reply");
  const [draftValue, setDraftValue] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [draftLogId, setDraftLogId] = useState(null);
  const supabase = useClerkSupabase();

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
          status: unread > 0 ? "New" : "Open",
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
  };

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

  const getThreadUnreadCount = (thread) => thread.unread_count || 0;

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
