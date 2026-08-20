import { Component, Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown, Inbox, Package, Sparkles, TriangleAlert, X } from "lucide-react";
import { MessageBubble, MessageRenderBoundary } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { ThinkingCard } from "@/components/inbox/ThinkingCard";
import { ActionCard } from "@/components/inbox/ActionCard";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { ThreadTagsBar } from "@/components/inbox/ThreadTagsBar";
import { getReplyTargetEmail, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { formatTicketReference } from "@/lib/tickets/reference";

const APPROVAL_ACTION_TYPES = new Set([
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "create_exchange_request",
  "process_exchange_return",
  "fulfill_exchange",
  "change_shipping_method",
  "hold_or_release_fulfillment",
  "edit_line_items",
  "update_customer_contact",
  "forward_email",
  "create_return_case",
  "send_return_instructions",
  "initiate_return",
  "add_note",
  "add_tag",
  "add_internal_note_or_tag",
]);

const TRACKING_KEYWORD_PATTERN =
  /\b(track|tracking|trace|shipment|shipping|delivery|delivered|out for delivery|parcel|package|pakke|pakken|forsendelse|levering|leveret|spor|sporing|track and trace|track&trace)\b/i;

const TRACKING_STATUS_QUESTION_PATTERN =
  /\b(where is my order|order status|shipping status|delivery status|when will .*arriv|estimated delivery|not received|still haven'?t received|hvor er min ordre|hvor bliver .* af|hvornår .* lever|leveringstid|forventet levering|ikke modtaget)\b/i;

const SATISFACTION_CLOSURE_PATTERN =
  /\b(?:thanks?(?:\s+a\s+lot)?|thank you(?:\s+so\s+much)?|tak(?:\s+for\s+hjælpen)?|perfekt|super|awesome|great|issue(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|problem(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|it(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|it works(?:\s+now)?|works(?:\s+perfectly|fine|great)?(?:\s+now)?|alt(?:\s+er)?\s+løst|det(?:\s+er)?\s+løst|det virker(?:\s+nu)?|virker\s+nu|fungerer(?:\s+nu)?|all good(?:\s+now)?|all set|you can close(?:\s+the\s+ticket)?|close\s+the\s+ticket)\b/i;
const EXPLICIT_CLOSE_CONFIRMATION_PATTERN =
  /\b(?:you can close(?:\s+the\s+ticket)?|close\s+the\s+ticket|issue(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|problem(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|it(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|all good(?:\s+now)?|all set|alt(?:\s+er)?\s+løst|det(?:\s+er)?\s+løst)\b/i;
const QUESTION_SIGNAL_PATTERN =
  /(?:\?|\b(?:can|could|would|should|how|what|why|where|when|hvor|hvornår|hvordan|hvad|hvorfor|kan|skal)\b)/i;
const OPEN_ISSUE_PATTERN =
  /\b(?:problem|issue|doesn'?t|does not|not\s+work(?:ing)?|still|however|but|cost|price|who\s+needs\s+to\s+pay|hvem\s+skal\s+betale)\b/i;

const MESSAGE_DISPLAY_TIMEZONE = "Europe/Copenhagen";
const MESSAGE_GROUP_WINDOW_MS = 15 * 60 * 1000;

function getMessageTimestampValue(message = null) {
  return message?.received_at || message?.sent_at || message?.created_at || "";
}

function getMessageDayKey(message = null) {
  const timestampValue = getMessageTimestampValue(message);
  if (!timestampValue) return "";
  const date = new Date(timestampValue);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: MESSAGE_DISPLAY_TIMEZONE,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year || ""}-${values.month || ""}-${values.day || ""}`;
}

function formatMessageDayLabel(message = null) {
  const timestampValue = getMessageTimestampValue(message);
  if (!timestampValue) return "";
  const date = new Date(timestampValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: MESSAGE_DISPLAY_TIMEZONE,
    year: "numeric",
  });
}

function canGroupMessages(previousMessage, message, mailboxEmails = []) {
  if (!previousMessage || !message) return false;
  const previousDirection = isOutboundMessage(previousMessage, mailboxEmails) ? "outbound" : "inbound";
  const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
  if (previousDirection !== direction) return false;
  if (getMessageDayKey(previousMessage) !== getMessageDayKey(message)) return false;
  const previousSender = String(getSenderLabel(previousMessage) || "").trim().toLowerCase();
  const sender = String(getSenderLabel(message) || "").trim().toLowerCase();
  if (previousSender !== sender) return false;
  const previousTimestamp = Date.parse(getMessageTimestampValue(previousMessage));
  const timestamp = Date.parse(getMessageTimestampValue(message));
  if (!Number.isFinite(previousTimestamp) || !Number.isFinite(timestamp)) return false;
  return Math.abs(timestamp - previousTimestamp) <= MESSAGE_GROUP_WINDOW_MS;
}

class TicketRenderBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[TicketRenderBoundary] failed to render section", {
      section: this.props.section,
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
    if (this.props.fallback) return this.props.fallback;
    return null;
  }
}

function getLatestInboundCustomerMessage(messages = [], mailboxEmails = []) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (!message || isOutboundMessage(message, mailboxEmails)) continue;
    return message;
  }
  return null;
}

function messageLooksLikeTrackingQuestion(message = null) {
  if (!message) return false;
  const haystack = [message?.clean_body_text, message?.body_text, message?.snippet]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!haystack) return false;
  const hasTrackingKeyword = TRACKING_KEYWORD_PATTERN.test(haystack);
  if (!hasTrackingKeyword) return false;
  if (TRACKING_STATUS_QUESTION_PATTERN.test(haystack)) return true;
  const hasQuestionSignal = /\?|\b(where|when|how long|hvor|hvornår|hvordan)\b/i.test(haystack);
  return hasQuestionSignal;
}

function messageLooksLikeSatisfactionClosure(message = null) {
  if (!message) return false;
  const haystack = [message?.clean_body_text, message?.body_text, message?.snippet]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!haystack) return false;
  const normalized = haystack.trim();
  const explicitClose = EXPLICIT_CLOSE_CONFIRMATION_PATTERN.test(normalized);
  if (QUESTION_SIGNAL_PATTERN.test(normalized) && !explicitClose) return false;
  if (OPEN_ISSUE_PATTERN.test(normalized) && !explicitClose) return false;
  if (!SATISFACTION_CLOSURE_PATTERN.test(normalized)) return false;
  // Keep this suggestion conservative: long detailed replies are rarely closure confirmations.
  if (normalized.length > 240 && !explicitClose) return false;
  return true;
}

function normalizeTranslationCompare(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripMessageHtml(value = "") {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatReturnTrackingError(message = "") {
  const text = String(message || "");
  if (text.includes("Return tracking is not set up yet") || text.includes("schema cache")) {
    return "Return tracking is not set up yet.";
  }
  return text || "Could not create return tracking.";
}

function getMessageTranslationText(message = null, translationItems = []) {
  const item = (Array.isArray(translationItems) ? translationItems : []).find(
    (candidate) => String(candidate?.id || "") === String(message?.id || "")
  );
  const translatedText = String(item?.translatedText || "").trim();
  if (!translatedText) return null;
  const originalLanguage = String(item?.originalLanguage || "").trim().toLowerCase();
  const sourceText = String(
    message?.clean_body_text ||
      message?.body_text ||
      message?.snippet ||
      stripMessageHtml(message?.body_html || "")
  ).trim();
  const looksUnchanged =
    originalLanguage &&
    originalLanguage !== "unknown" &&
    sourceText &&
    normalizeTranslationCompare(translatedText) === normalizeTranslationCompare(sourceText);
  return looksUnchanged ? null : translatedText;
}

function TicketDetailComponent({
  thread,
  messages,
  attachments,
  customerLookup,
  threadOrderNumber = "",
  mentionUsers = [],
  currentUserName,
  ticketState,
  onTicketStateChange,
  onOpenInsights,
  showThinkingCard = false,
  isDraftFetching = false,
  isPostApprovalDraftLoading = false,
  isConversationLoading = false,
  draftValue,
  onDraftChange,
  onDraftBlur,
  draftLoaded,
  canSend,
  onSend,
  pendingOrderUpdate,
  orderUpdateDecision,
  orderUpdateSubmitting,
  orderUpdateError,
  onOrderUpdateDecision,
  composerMode,
  onComposerModeChange,
  mailboxEmails,
  isSending = false,
  isWorkspaceTestMode = false,
  headerActions = null,
  rightHeaderActions = null,
  conversationScrollTop = 0,
  onConversationScroll = null,
  onGenerateDraft = null,
  isGeneratingDraft = false,
  onRefineDraft = null,
  isRefiningDraft = false,
  staleDraft = false,
  onDismissStaleDraft = null,
  awaitingReturn = false,
  onMarkReturnReceived = null,
  markReturnReceivedLoading = false,
  translationItems = [],
  translationLoading = false,
  onRequestTranslation = null,
  detectedLanguage = null,
  tagsRefreshTrigger = 0,
  sentDraftStats = null,
  onReturnTrackingActionStateChange = null,
}) {
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [draftActivityLogs, setDraftActivityLogs] = useState([]);
  const [draftActivityLoading, setDraftActivityLoading] = useState(false);
  const [processReturnRestock, setProcessReturnRestock] = useState(true);
  const [dismissedCloseSuggestionByThread, setDismissedCloseSuggestionByThread] = useState({});
  const [returnTrackingCandidates, setReturnTrackingCandidates] = useState([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [returnTrackingSubmitting, setReturnTrackingSubmitting] = useState("");
  const [returnTrackingError, setReturnTrackingError] = useState("");
  const [createdReturnTrackingByThread, setCreatedReturnTrackingByThread] = useState({});
  const [ignoredReturnTrackingByThread, setIgnoredReturnTrackingByThread] = useState({});
  const [returnTrackingStateByThread, setReturnTrackingStateByThread] = useState({});
  const closeSuggestionEnabled = false; // Temporarily disabled until heuristics are reworked.
  const conversationRef = useRef(null);
  const restoredThreadIdRef = useRef(null);
  const initialScrollTopRef = useRef(0);
  const isConversationNearBottomRef = useRef(true);
  const normalizedPendingStatus = String(pendingOrderUpdate?.status || "").toLowerCase();
  const pendingUpdateState = orderUpdateSubmitting
    ? "executing"
    : orderUpdateDecision === "accepted"
    ? isWorkspaceTestMode || normalizedPendingStatus === "approved_test_mode"
      ? "simulated"
      : "completed"
    : orderUpdateDecision === "denied"
    ? "declined"
    : normalizedPendingStatus === "approved_test_mode"
    ? "simulated"
    : normalizedPendingStatus === "applied" || normalizedPendingStatus === "approved"
    ? "completed"
    : normalizedPendingStatus === "failed"
    ? "failed"
    : orderUpdateError
    ? "failed"
    : "proposed";

  const pendingActionType = String(pendingOrderUpdate?.actionType || "");
  const pendingActionTitleByType = {
    update_shipping_address: "Update Address",
    cancel_order: "Cancel Order",
    refund_order: "Refund Order",
    create_exchange_request: "Create Exchange",
    process_exchange_return: "Process Return",
    change_shipping_method: "Change Shipping Method",
    hold_or_release_fulfillment: "Fulfillment Hold/Release",
    edit_line_items: "Edit Line Items",
    update_customer_contact: "Update Contact Details",
    forward_email: "Forward Email",
    create_return_case: "Create Return Case",
    send_return_instructions: "Send Return Instructions",
    initiate_return: "Initiate Return",
    fulfill_exchange: "Fulfill Exchange",
    add_note: "Add Internal Note",
    add_tag: "Add Internal Tag",
    add_internal_note_or_tag: "Add Internal Note/Tag",
    resend_confirmation_or_invoice: "Resend Confirmation/Invoice",
  };
  const pendingActionTitle =
    pendingActionTitleByType[pendingActionType] || "Review Action";
  const isProcessReturnAction = pendingActionType === "process_exchange_return";
  const isApprovalManagedActionType = APPROVAL_ACTION_TYPES.has(
    String(pendingActionType || "").trim().toLowerCase()
  );

  useEffect(() => {
    if (!isProcessReturnAction) return;
    const payloadRestock = pendingOrderUpdate?.payload?.restock;
    if (typeof payloadRestock === "boolean") {
      setProcessReturnRestock(payloadRestock);
      return;
    }
    setProcessReturnRestock(true);
  }, [isProcessReturnAction, pendingOrderUpdate?.id, pendingOrderUpdate?.payload?.restock]);

  const processReturnMeta = useMemo(() => {
    if (!isProcessReturnAction) return null;
    const reason = String(pendingOrderUpdate?.payload?.restock_reason || "").trim();
    const confidence = String(pendingOrderUpdate?.payload?.restock_confidence || "").trim();
    return { reason, confidence };
  }, [
    isProcessReturnAction,
    pendingOrderUpdate?.payload?.restock_reason,
    pendingOrderUpdate?.payload?.restock_confidence,
  ]);

  const isApprovalPending = Boolean(pendingOrderUpdate) && pendingUpdateState === "proposed";
  const shouldForceUnlocked =
    orderUpdateDecision === "denied" || orderUpdateDecision === "accepted";
  const isActionPending = (() => {
    if (shouldForceUnlocked) return false;
    if (!pendingOrderUpdate) return false;
    if (!Array.isArray(messages) || messages.length === 0) return isApprovalPending;
    const lowered = [...messages]
      .reverse()
      .find((message) => {
        const type = String(
          message?.type || message?.message_type || message?.kind || ""
        ).toLowerCase();
        const status = String(message?.status || message?.action_status || "").toLowerCase();
        const isAiAction = type === "ai_action" || type.includes("ai_action");
        const isPendingStatus =
          status === "pending" ||
          status === "waiting" ||
          status === "awaiting_approval" ||
          status === "requires_approval";
        return isAiAction && isPendingStatus;
      });
    return Boolean(lowered) || isApprovalPending;
  })();
  const detailSuggestsTestMode = (() => {
    const detailText = String(pendingOrderUpdate?.detail || "").toLowerCase();
    return detailText.includes("test mode") || detailText.includes("simulated");
  })();
  const payloadSuggestsTestMode =
    pendingOrderUpdate?.payload?.test_mode === true ||
    pendingOrderUpdate?.payload?.simulated === true;
  const isApprovedInTestMode =
    normalizedPendingStatus === "approved_test_mode" ||
    pendingOrderUpdate?.testMode === true ||
    payloadSuggestsTestMode ||
    detailSuggestsTestMode ||
    (Boolean(isWorkspaceTestMode) &&
      (pendingUpdateState === "completed" || pendingUpdateState === "simulated"));
  const shouldShowActionCard =
    Boolean(pendingOrderUpdate) &&
    (isApprovalManagedActionType || pendingUpdateState === "proposed");
  const selectedOrderSummary = useMemo(() => {
    const orders = Array.isArray(customerLookup?.orders) ? customerLookup.orders : [];
    if (!orders.length) return null;
    // Prefer the order that matches the thread's order number
    if (threadOrderNumber) {
      const normalized = String(threadOrderNumber).replace(/^#/, "").trim();
      const match = orders.find((o) =>
        String(o?.id || o?.order_number || "").replace(/^#/, "").trim() === normalized
      );
      if (match) return match;
    }
    return orders[0];
  }, [customerLookup?.orders, threadOrderNumber]);
  const latestInboundCustomerMessage = useMemo(
    () => getLatestInboundCustomerMessage(messages, mailboxEmails),
    [mailboxEmails, messages]
  );
  const latestInboundCustomerMessageId = String(latestInboundCustomerMessage?.id || "");
  const shouldSuggestCloseFromCustomerReply = useMemo(() => {
    const normalizedTicketStatus = String(ticketState?.status || "").trim().toLowerCase();
    if (normalizedTicketStatus === "solved" || normalizedTicketStatus === "resolved") return false;
    const threadId = String(thread?.id || "").trim();
    if (threadId && dismissedCloseSuggestionByThread[threadId]) return false;
    return messageLooksLikeSatisfactionClosure(latestInboundCustomerMessage);
  }, [dismissedCloseSuggestionByThread, latestInboundCustomerMessage, thread?.id, ticketState?.status]);
  const shouldShowTrackingCard = useMemo(() => {
    const hasTrackingData = Boolean(
      selectedOrderSummary?.tracking?.number || selectedOrderSummary?.tracking?.url
    );
    if (!hasTrackingData) return false;
    // Never show when an action card is pending — avoids visual clutter
    if (shouldShowActionCard) return false;
    // Never show for return/exchange/complaint tickets — tracking is not the focus
    const classKey = String(thread?.classification_key || "").toLowerCase();
    const isReturnOrExchange = classKey === "return" || classKey === "exchange" || classKey === "complaint";
    const tags = Array.isArray(thread?.tags) ? thread.tags : [];
    const hasReturnTag = tags.some((t) => /^return/i.test(String(t || "")));
    if (isReturnOrExchange || hasReturnTag) return false;
    // Show only for explicitly tracking-tagged threads or clear tracking questions
    const threadIsTracking = tags.includes("Tracking");
    return threadIsTracking || messageLooksLikeTrackingQuestion(latestInboundCustomerMessage);
  }, [
    thread?.tags,
    thread?.classification_key,
    latestInboundCustomerMessage,
    selectedOrderSummary?.tracking?.number,
    selectedOrderSummary?.tracking?.url,
    shouldShowActionCard,
  ]);
  const selectedCustomerEmail = String(customerLookup?.customer?.email || "").trim();
  const shouldLoadDraftActivity = Boolean(
    thread?.id &&
      !String(thread.id).startsWith("local-") &&
      (draftLoaded || showThinkingCard),
  );

  useEffect(() => {
    const threadId = String(thread?.id || "").trim();
    if (!shouldLoadDraftActivity || !threadId) {
      setDraftActivityLogs([]);
      setDraftActivityLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setDraftActivityLoading(Boolean(showThinkingCard));
    fetch(`/api/threads/${encodeURIComponent(threadId)}/insights`, {
      method: "GET",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (controller.signal.aborted) return;
        setDraftActivityLogs(Array.isArray(payload?.logs) ? payload.logs : []);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setDraftActivityLogs([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDraftActivityLoading(false);
      });

    return () => controller.abort();
  }, [draftLoaded, shouldLoadDraftActivity, showThinkingCard, thread?.id]);

  const draftActivitySteps = useMemo(() => {
    const logs = Array.isArray(draftActivityLogs) ? draftActivityLogs : [];
    if (!logs.length) return [];

    const draftLogs = logs.filter((log) => log?.draft_id);
    const latestDraftId = draftLogs[draftLogs.length - 1]?.draft_id;
    const latestLogs = latestDraftId
      ? draftLogs.filter((log) => String(log?.draft_id) === String(latestDraftId))
      : logs;

    return latestLogs
      .filter((log) => log?.step_name || log?.step_detail)
      .slice(-8);
  }, [draftActivityLogs]);

  let actionCardInserted = false;
  const processReturnExtraContent =
    isProcessReturnAction && pendingUpdateState === "proposed" ? (
      <div className="rounded-lg border border-violet-100 bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Return options</div>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={processReturnRestock}
            onChange={(event) => setProcessReturnRestock(Boolean(event.target.checked))}
          />
          Restock returned item
        </label>
        {processReturnMeta?.reason ? (
          <div className="mt-2 text-xs text-slate-500">
            AI: {processReturnMeta.reason}
            {processReturnMeta?.confidence ? ` (${processReturnMeta.confidence})` : ""}
          </div>
        ) : null}
      </div>
    ) : null;
  const actionCardExtraContent = processReturnExtraContent;
  const actionCardPayload = pendingOrderUpdate?.payload || {};
  const approvalPayloadOverride = isProcessReturnAction
    ? { restock: processReturnRestock }
    : undefined;

  useEffect(() => {
    initialScrollTopRef.current = Number(conversationScrollTop) || 0;
  }, [conversationScrollTop]);

  useEffect(() => {
    const node = conversationRef.current;
    const threadId = String(thread?.id || "").trim();
    const hasLoadedConversation = !isConversationLoading || messages.length > 0;
    if (!node || !threadId || !hasLoadedConversation) return undefined;

    const initialScrollTop = Number(initialScrollTopRef.current) || 0;
    const shouldRestoreThread = restoredThreadIdRef.current !== threadId;
    const shouldKeepLatestVisible = !shouldRestoreThread && isConversationNearBottomRef.current;
    if (!shouldRestoreThread && !shouldKeepLatestVisible) return undefined;

    // Wait for message content to paint before measuring scrollHeight. This keeps
    // a newly opened ticket at the latest message even when messages load async.
    const frameId = requestAnimationFrame(() => {
      if (shouldRestoreThread && initialScrollTop > 0) {
        node.scrollTop = initialScrollTop;
      } else {
        node.scrollTop = node.scrollHeight;
      }
      isConversationNearBottomRef.current =
        node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
      setShowJumpToLatest(!isConversationNearBottomRef.current);
      if (shouldRestoreThread) restoredThreadIdRef.current = threadId;
    });

    return () => cancelAnimationFrame(frameId);
  }, [isConversationLoading, messages.length, thread?.id]);

  useEffect(() => {
    const threadId = String(thread?.id || "").trim();
    if (!threadId || !Array.isArray(messages) || messages.length === 0) {
      setReturnTrackingCandidates([]);
      return undefined;
    }

    const controller = new AbortController();
    setReturnTrackingError("");
    fetch("/api/return-tracking/detect-thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId }),
      signal: controller.signal,
    })
      .then((response) =>
        response.json().then((body) => ({ response, body })).catch(() => ({ response, body: {} }))
      )
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body?.error || "Could not detect return tracking.");
        const hidden = new Set([
          ...(createdReturnTrackingByThread[threadId] || []),
          ...(ignoredReturnTrackingByThread[threadId] || []),
        ]);
        const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
        const alreadyAdded = candidates.filter((candidate) => candidate?.already_added);
        if (alreadyAdded.length) {
          setReturnTrackingStateByThread((current) => {
            const previousThreadState = current[threadId] || {};
            const nextThreadState = { ...previousThreadState };
            for (const candidate of alreadyAdded) {
              const normalized = String(
                candidate?.normalized_tracking_number || candidate?.tracking_number || "",
              ).trim();
              if (normalized) nextThreadState[normalized] = "duplicate";
            }
            return { ...current, [threadId]: nextThreadState };
          });
        }
        setReturnTrackingCandidates(
          candidates.filter((candidate) =>
            !hidden.has(String(candidate?.normalized_tracking_number || candidate?.tracking_number || ""))
          )
        );
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setReturnTrackingCandidates([]);
        setReturnTrackingError(formatReturnTrackingError(error?.message || "Could not detect return tracking."));
      });

    return () => controller.abort();
  }, [createdReturnTrackingByThread, ignoredReturnTrackingByThread, messages, thread?.id]);

  function hideReturnTrackingCandidate(candidate) {
    const threadId = String(thread?.id || "").trim();
    const normalized = String(candidate?.normalized_tracking_number || candidate?.tracking_number || "").trim();
    if (!threadId || !normalized) return;
    setIgnoredReturnTrackingByThread((current) => ({
      ...current,
      [threadId]: [...new Set([...(current[threadId] || []), normalized])],
    }));
    setReturnTrackingCandidates((current) =>
      current.filter((item) =>
        String(item?.normalized_tracking_number || item?.tracking_number || "") !== normalized
      )
    );
  }

  async function approveReturnTrackingCandidate(candidate) {
    const threadId = String(thread?.id || "").trim();
    const normalized = String(candidate?.normalized_tracking_number || candidate?.tracking_number || "").trim();
    if (!threadId || !normalized) return;
    setReturnTrackingSubmitting(normalized);
    setReturnTrackingError("");
    try {
      const response = await fetch("/api/return-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          source_message_id: candidate?.source_message_id || null,
          tracking_number: candidate?.tracking_number || normalized,
          carrier: candidate?.carrier || null,
          customer_email: candidate?.customer_email || null,
          customer_name: candidate?.customer_name || null,
          order_number: candidate?.order_number || null,
          detected_context: candidate?.detected_context || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not create return tracking row.");
      setReturnTrackingStateByThread((current) => ({
        ...current,
        [threadId]: {
          ...(current[threadId] || {}),
          [normalized]: body?.duplicate ? "duplicate" : "added",
        },
      }));
      if (body?.duplicate) return;
      setCreatedReturnTrackingByThread((current) => ({
        ...current,
        [threadId]: [...new Set([...(current[threadId] || []), normalized])],
      }));
      setReturnTrackingCandidates((current) =>
        current.filter((item) =>
          String(item?.normalized_tracking_number || item?.tracking_number || "") !== normalized
        )
      );
    } catch (error) {
      setReturnTrackingError(formatReturnTrackingError(error?.message || "Could not create return tracking row."));
    } finally {
      setReturnTrackingSubmitting("");
    }
  }

  const threadMessageIdSet = useMemo(
    () => new Set((messages || []).map((msg) => String(msg?.id || "").trim()).filter(Boolean)),
    [messages]
  );
  const orphanThreadAttachments = useMemo(
    () =>
      (attachments || []).filter((attachment) => {
        const attachmentMessageId = String(attachment?.message_id || "").trim();
        return !attachmentMessageId || !threadMessageIdSet.has(attachmentMessageId);
      }),
    [attachments, threadMessageIdSet]
  );
  const latestInboundMessageWithoutOwnAttachmentsId = useMemo(() => {
    const rows = Array.isArray(messages) ? messages : [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const message = rows[index];
      if (!message || isOutboundMessage(message, mailboxEmails)) continue;
      const messageId = String(message?.id || "").trim();
      if (!messageId) continue;
      const hasPersisted = (attachments || []).some(
        (attachment) => String(attachment?.message_id || "").trim() === messageId
      );
      const hasEmbedded = Array.isArray(message?.attachments) && message.attachments.length > 0;
      if (!hasPersisted && !hasEmbedded) return messageId;
    }
    return "";
  }, [attachments, mailboxEmails, messages]);
  const visibleReturnTrackingCandidates = useMemo(
    () => returnTrackingCandidates.slice(0, 2),
    [returnTrackingCandidates],
  );

  useEffect(() => {
    if (!onReturnTrackingActionStateChange) return;
    onReturnTrackingActionStateChange({
      threadId: thread?.id || null,
      candidates: visibleReturnTrackingCandidates,
      error: returnTrackingError,
      submitting: returnTrackingSubmitting,
      stateByNumber: returnTrackingStateByThread[String(thread?.id || "")] || {},
      onAdd: approveReturnTrackingCandidate,
      onDismiss: hideReturnTrackingCandidate,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    onReturnTrackingActionStateChange,
    returnTrackingError,
    returnTrackingSubmitting,
    returnTrackingStateByThread,
    thread?.id,
    visibleReturnTrackingCandidates,
  ]);

  if (!thread) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center bg-muted/[0.18] px-6 text-center">
        <div className="flex max-w-[320px] flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card/80 px-8 py-9 shadow-[0_8px_28px_hsl(var(--foreground)/0.035)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-300">
            <Inbox className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">Select a ticket</h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Choose a conversation from the inbox to view the thread.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const firstMessage = messages[0] || {};
  const toEmail = getReplyTargetEmail(firstMessage);
  const senderLabel = getSenderLabel(firstMessage);
  const toLabel = toEmail ? `${senderLabel} <${toEmail}>` : senderLabel;
  const threadTicketRef = formatTicketReference(thread?.ticket_number);
  const hasTicketNumber = threadTicketRef !== "No ticket ID";
  const threadSubject = String(
    thread?.subject || thread?.title || firstMessage?.subject || "",
  ).trim();

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:min-w-0">
      <header className="flex min-h-[56px] flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-border/70 bg-background/95 px-2.5 py-1.5 shadow-[0_1px_0_hsl(var(--border)/0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <div
            className={`flex h-7 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 font-mono text-[11px] tabular-nums tracking-[-0.01em] ${
              hasTicketNumber
                ? "border border-border/70 bg-muted/55 font-medium text-muted-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
                : "text-muted-foreground/60"
            }`}
          >
            {threadTicketRef}
          </div>
          {threadSubject ? (
            <span className="hidden min-w-0 items-center gap-2 2xl:inline-flex">
              <span className="h-5 w-px shrink-0 bg-border/70" aria-hidden="true" />
              <span className="min-w-0 max-w-[min(30vw,280px)] truncate text-[12px] font-semibold tracking-[-0.01em] text-foreground">
                {threadSubject}
              </span>
            </span>
          ) : null}
          {headerActions ? (
            <TicketRenderBoundary section="headerActions" resetKey={`${thread?.id || ""}:header`}>
              <div className="flex min-w-0 flex-wrap items-center gap-1">{headerActions}</div>
            </TicketRenderBoundary>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <TicketRenderBoundary section="rightHeaderActions" resetKey={`${thread?.id || ""}:rightHeader`}>
            {rightHeaderActions}
          </TicketRenderBoundary>
        </div>
      </header>

      {false && <ThreadTagsBar threadId={thread.id} refreshTrigger={tagsRefreshTrigger} />}

      <div
        ref={conversationRef}
        className="relative min-h-0 flex-1 overflow-y-auto bg-muted/30 dark:bg-muted/15 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const node = event.currentTarget;
          const isNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
          isConversationNearBottomRef.current = isNearBottom;
          setShowJumpToLatest(!isNearBottom);
          onConversationScroll?.(node.scrollTop);
        }}
      >
        {showJumpToLatest ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Jump to latest message"
            onClick={() => {
              const node = conversationRef.current;
              if (!node) return;
              node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
              isConversationNearBottomRef.current = true;
              setShowJumpToLatest(false);
            }}
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-border/80 bg-background/95 px-3 text-xs font-medium shadow-md backdrop-blur-sm hover:bg-background"
          >
            <ArrowDown className="mr-1.5 h-3.5 w-3.5" />
            Jump to latest
          </Button>
        ) : null}
        <div key={thread.id} className="animate-detail-enter mx-auto w-full max-w-[960px] space-y-4 px-5 pb-6 pt-5">
          {isConversationLoading && !messages.length ? (
            <div className="space-y-3 pt-2" aria-label="Loading conversation">
              <div className="mr-auto w-full max-w-[520px] rounded-2xl border border-border bg-white p-4 shadow-sm">
                <div className="mb-3 h-3 w-32 rounded-full bg-muted animate-pulse" />
                <div className="space-y-2">
                  <div className="h-3 w-11/12 rounded-full bg-muted animate-pulse" />
                  <div className="h-3 w-9/12 rounded-full bg-muted animate-pulse" />
                  <div className="h-3 w-7/12 rounded-full bg-muted animate-pulse" />
                </div>
              </div>
              <div className="ml-auto w-full max-w-[520px] rounded-2xl border border-border bg-white p-4 shadow-sm">
                <div className="mb-3 h-3 w-28 rounded-full bg-muted animate-pulse" />
                <div className="space-y-2">
                  <div className="h-3 w-10/12 rounded-full bg-muted animate-pulse" />
                  <div className="h-3 w-8/12 rounded-full bg-muted animate-pulse" />
                </div>
              </div>
            </div>
          ) : null}
          {orderUpdateError && !shouldShowActionCard ? (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
              {orderUpdateError}
            </div>
          ) : null}
          {!isConversationLoading || messages.length ? messages.map((message, messageIndex) => {
            const previousMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
            const groupedWithPrevious = canGroupMessages(previousMessage, message, mailboxEmails);
            const messageDayKey = getMessageDayKey(message);
            const previousMessageDayKey = getMessageDayKey(previousMessage);
            const shouldShowDaySeparator = Boolean(messageDayKey) && messageDayKey !== previousMessageDayKey;
            const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
            const messageId = String(message?.id || "").trim();
            const persistedAttachments = attachments.filter(
              (attachment) => String(attachment?.message_id || "").trim() === messageId
            );
            const bodyWithPlaceholders = String(
              message?.clean_body_text || message?.body_text || message?.snippet || ""
            );
            const inlineImagePlaceholderMatches = Array.from(
              bodyWithPlaceholders.matchAll(/\[([^\]]+\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp))\]/gi)
            )
              .map((match) => String(match?.[1] || "").trim().toLowerCase())
              .filter(Boolean);
            const inferredAttachments =
              !persistedAttachments.length && inlineImagePlaceholderMatches.length
                ? orphanThreadAttachments.filter((attachment) => {
                    const filename = String(attachment?.filename || "").trim().toLowerCase();
                    if (!filename) return false;
                    return inlineImagePlaceholderMatches.includes(filename);
                  })
                : [];
            const inferredLatestInboundFallbackAttachments =
              !persistedAttachments.length &&
              !inferredAttachments.length &&
              !Array.isArray(message?.attachments) &&
              messageId &&
              messageId === latestInboundMessageWithoutOwnAttachmentsId
                ? orphanThreadAttachments.filter((attachment) => {
                    const mimeType = String(attachment?.mime_type || "").trim().toLowerCase();
                    const filename = String(attachment?.filename || "").trim().toLowerCase();
                    return mimeType.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/.test(filename);
                  })
                : [];
            const messageAttachments =
              persistedAttachments.length || !Array.isArray(message?.attachments)
                ? persistedAttachments.length
                  ? persistedAttachments
                  : inferredAttachments.length
                    ? inferredAttachments
                    : inferredLatestInboundFallbackAttachments
                : message.attachments;
            const isDraft = Boolean(message.from_me && message.is_draft);
            const shouldInsertActionCardBeforeMessage =
              shouldShowActionCard &&
              !actionCardInserted &&
              (direction === "outbound" || isDraft);
            if (shouldInsertActionCardBeforeMessage) {
              actionCardInserted = true;
            }
            return (
              <Fragment key={message.id}>
                {shouldShowDaySeparator ? (
                  <div className="!mt-3 mb-1 flex items-center gap-3 px-1 text-[11px] font-medium text-muted-foreground/80">
                    <span className="h-px flex-1 bg-border/60" />
                    <span className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 shadow-[0_1px_2px_hsl(var(--foreground)/0.03)]">
                      {formatMessageDayLabel(message)}
                    </span>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                ) : null}
              <div className={`space-y-3 ${groupedWithPrevious ? "!mt-1" : ""}`}>
                {shouldInsertActionCardBeforeMessage ? (
                  <div className="ml-auto flex w-full max-w-[480px] justify-end">
                    <TicketRenderBoundary section="inlineActionCard" resetKey={`${thread?.id || ""}:${pendingOrderUpdate?.id || "action"}`}>
                      <ActionCard
                        status={pendingUpdateState}
                        testMode={isApprovedInTestMode}
                        actionName={pendingActionTitle}
                        actionType={pendingOrderUpdate?.actionType || ""}
                        detail={pendingOrderUpdate?.detail || ""}
                        payload={actionCardPayload}
                        orderSummary={selectedOrderSummary}
                        fallbackOrderNumber={threadOrderNumber}
                        customerEmail={selectedCustomerEmail}
                        approvedAt={pendingOrderUpdate?.updatedAt || pendingOrderUpdate?.createdAt || ""}
                        approvedBy={pendingOrderUpdate?.approvedBy || ""}
                        error={orderUpdateError || ""}
                        loading={Boolean(orderUpdateSubmitting)}
                        extraContent={actionCardExtraContent}
                        onApprove={(payloadOverride) =>
                          onOrderUpdateDecision?.(
                            "accepted",
                            payloadOverride || approvalPayloadOverride
                          )
                        }
                        onDecline={(declineContext) =>
                          onOrderUpdateDecision?.("denied", declineContext)
                        }
                      />
                    </TicketRenderBoundary>
                  </div>
                ) : null}
                <MessageRenderBoundary messageId={messageId || message?.id}>
                  <MessageBubble
                    message={message}
                    direction={direction}
                    attachments={messageAttachments}
                    outboundSenderName={currentUserName}
                    showMeta={!groupedWithPrevious}
                    compactTimestamp
                    grouped={groupedWithPrevious}
                    editStats={direction === "outbound" ? sentDraftStats : null}
                    translatedText={getMessageTranslationText(message, translationItems)}
                    translationLoading={translationLoading}
                    onRequestTranslation={onRequestTranslation}
                  />
                </MessageRenderBoundary>
                {shouldShowTrackingCard &&
                  latestInboundCustomerMessageId &&
                  String(message?.id || "") === latestInboundCustomerMessageId ? (
                  <div className="ml-auto flex w-full max-w-[520px] justify-end">
                    <TicketRenderBoundary section="trackingCard" resetKey={`${thread?.id || ""}:tracking`}>
                      <TrackingCard order={selectedOrderSummary} threadId={thread?.id || null} direction="outbound" />
                    </TicketRenderBoundary>
                  </div>
                ) : null}
              </div>
              </Fragment>
            );
          }) : null}
          {shouldShowActionCard && !actionCardInserted ? (
            <div className="ml-auto flex w-full max-w-[480px] justify-end">
              <TicketRenderBoundary section="trailingActionCard" resetKey={`${thread?.id || ""}:${pendingOrderUpdate?.id || "action"}`}>
                <ActionCard
                  status={pendingUpdateState}
                  testMode={isApprovedInTestMode}
                  actionName={pendingActionTitle}
                  actionType={pendingOrderUpdate?.actionType || ""}
                  detail={pendingOrderUpdate.detail || ""}
                  payload={actionCardPayload}
                  orderSummary={selectedOrderSummary}
                  fallbackOrderNumber={threadOrderNumber}
                  customerEmail={selectedCustomerEmail}
                  approvedAt={pendingOrderUpdate?.updatedAt || pendingOrderUpdate?.createdAt || ""}
                  approvedBy={pendingOrderUpdate?.approvedBy || ""}
                  error={orderUpdateError || ""}
                  loading={Boolean(orderUpdateSubmitting)}
                  extraContent={actionCardExtraContent}
                  onApprove={(payloadOverride) =>
                    onOrderUpdateDecision?.(
                      "accepted",
                      payloadOverride || approvalPayloadOverride
                    )
                  }
                  onDecline={(declineContext) =>
                    onOrderUpdateDecision?.("denied", declineContext)
                  }
                />
              </TicketRenderBoundary>
            </div>
          ) : null}
        </div>
      </div>

      {isActionPending ? (
        <div className="flex-none border-t border-violet-100 bg-violet-50/60 px-3 py-1.5">
          <div className="mx-auto flex w-full max-w-[900px] items-center gap-1.5 text-xs text-violet-700">
            <Sparkles className="h-3 w-3 shrink-0 animate-pulse text-violet-500" />
            <span>Review the action above to proceed</span>
          </div>
        </div>
      ) : (
        <>
        {awaitingReturn && !shouldShowActionCard && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <Package className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="flex-1">Afventer retur fra kunde</span>
            <button
              type="button"
              onClick={() => onMarkReturnReceived?.()}
              disabled={markReturnReceivedLoading}
              className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {markReturnReceivedLoading ? "..." : "Markér modtaget"}
            </button>
          </div>
        )}
        {/* {staleDraft && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="flex-1">Ny besked fra kunden — dit udkast er muligvis forældet.</span>
            <button
              type="button"
              onClick={() => onGenerateDraft?.()}
              className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-900"
            >
              Regenerer
            </button>
            <button
              type="button"
              onClick={() => onDismissStaleDraft?.()}
              className="shrink-0 rounded p-0.5 hover:bg-amber-100"
              aria-label="Luk"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )} */}
        {closeSuggestionEnabled && shouldSuggestCloseFromCustomerReply && !shouldShowActionCard && (
          <div className="px-3 pb-1">
            <div className="mx-auto w-full max-w-[900px] rounded-xl border border-transparent bg-transparent px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2 text-[13px] font-medium text-slate-700">
                  <span className="truncate">
                    Mark this ticket as solved.
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 shrink-0 border border-emerald-200 bg-white px-2.5 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => onTicketStateChange?.({ status: "Solved" })}
                  >
                    Mark as solved
                  </Button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50"
                    aria-label="Dismiss suggestion"
                    title="Dismiss suggestion"
                    onClick={() => {
                      const threadId = String(thread?.id || "").trim();
                      if (!threadId) return;
                      setDismissedCloseSuggestionByThread((prev) => ({
                        ...prev,
                        [threadId]: true,
                      }));
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {isConversationLoading && !messages.length ? (
          <div className="px-3 pb-2">
            <div className="mx-auto h-[170px] w-full max-w-[900px] rounded-3xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-4 h-3 w-40 rounded-full bg-muted animate-pulse" />
              <div className="space-y-2">
                <div className="h-3 w-full rounded-full bg-muted animate-pulse" />
                <div className="h-3 w-10/12 rounded-full bg-muted animate-pulse" />
                <div className="h-3 w-7/12 rounded-full bg-muted animate-pulse" />
              </div>
            </div>
          </div>
        ) : (
        <>
        {draftActivityLoading || draftActivitySteps.length ? (
          <div className="px-3 pb-0.5">
            <div className="mx-auto w-full max-w-[900px]">
              <TicketRenderBoundary
                section="thinkingCard"
                resetKey={`${thread?.id || ""}:${draftActivitySteps.length}:${draftActivityLoading}`}
              >
                <ThinkingCard
                  steps={draftActivitySteps}
                  loading={draftActivityLoading}
                  onClick={() => onOpenInsights?.(true)}
                />
              </TicketRenderBoundary>
            </div>
          </div>
        ) : null}
        <div className="relative bg-transparent px-3 pb-2.5 pt-2.5">
          <TicketRenderBoundary
            section="composer"
            resetKey={`${thread?.id || ""}:${composerMode}:composer`}
            fallback={
              <div className="mx-auto w-full max-w-[900px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Composer could not be rendered for this ticket.
              </div>
            }
          >
            <Composer
              key={`${thread?.id || "thread"}:${composerMode}`}
              value={draftValue}
              onChange={(nextValue) => onDraftChange?.(nextValue, thread?.id || null)}
              collapsed={composerCollapsed}
              onToggleCollapse={() => setComposerCollapsed((prev) => !prev)}
              draftLoaded={draftLoaded}
              canSend={canSend}
              onSend={onSend}
              isSending={isSending}
              mode={composerMode}
              onModeChange={onComposerModeChange}
              toLabel={toLabel}
              mentionUsers={mentionUsers}
              onBlur={() => onDraftBlur?.(thread?.id || null)}
              isDraftLoading={showThinkingCard || isDraftFetching || isPostApprovalDraftLoading}
              onGenerateDraft={onGenerateDraft}
              isGeneratingDraft={isGeneratingDraft}
              onRefineDraft={onRefineDraft}
              isRefiningDraft={isRefiningDraft}
            />
          </TicketRenderBoundary>
        </div>
        </>
        )}
        </>
      )}
    </section>
  );
}

export const TicketDetail = memo(TicketDetailComponent);
