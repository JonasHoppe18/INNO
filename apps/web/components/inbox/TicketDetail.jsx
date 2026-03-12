import { Button } from "@/components/ui/button";
import { Sparkles, Trash2 } from "lucide-react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { ThinkingCard } from "@/components/inbox/ThinkingCard";
import { ActionCard } from "@/components/inbox/ActionCard";
import { formatMessageTime, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { useEffect, useMemo, useState } from "react";

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

export function TicketDetail({
  thread,
  messages,
  attachments,
  mentionUsers = [],
  currentUserId,
  currentUserName,
  ticketState,
  onTicketStateChange,
  onOpenInsights,
  showThinkingCard = false,
  draftValue,
  onDraftChange,
  signatureValue,
  onSignatureChange,
  onSignatureBlur,
  onDraftBlur,
  draftLoaded,
  canSend,
  onSend,
  onDeleteThread,
  deletingThread,
  pendingOrderUpdate,
  returnCase,
  orderUpdateDecision,
  orderUpdateSubmitting,
  orderUpdateError,
  onOrderUpdateDecision,
  composerMode,
  onComposerModeChange,
  mailboxEmails,
  isSending = false,
  isWorkspaceTestMode = false,
}) {
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [processReturnRestock, setProcessReturnRestock] = useState(true);
  const normalizedPendingStatus = String(pendingOrderUpdate?.status || "").toLowerCase();
  const pendingUpdateState = orderUpdateSubmitting
    ? "applying"
    : orderUpdateDecision === "accepted"
    ? "accepted"
    : orderUpdateDecision === "denied"
    ? "denied"
    : normalizedPendingStatus === "approved_test_mode"
    ? "accepted"
    : normalizedPendingStatus === "failed"
    ? "failed"
    : orderUpdateError
    ? "failed"
    : "pending";

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

  const isApprovalPending = Boolean(pendingOrderUpdate) && pendingUpdateState === "pending";
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
  const actionCardStatus =
    pendingUpdateState === "accepted"
      ? "approved"
      : pendingUpdateState === "denied"
      ? "declined"
      : pendingUpdateState === "failed"
      ? "failed"
      : "pending";
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
    (Boolean(isWorkspaceTestMode) && actionCardStatus === "approved");
  const shouldShowActionCard =
    Boolean(pendingOrderUpdate) &&
    (isApprovalManagedActionType || pendingUpdateState === "pending");
  let actionCardInserted = false;
  const processReturnExtraContent =
    isProcessReturnAction && actionCardStatus === "pending" ? (
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

  if (!thread) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center text-sm text-muted-foreground">
        Select a ticket to view the conversation.
      </section>
    );
  }

  const lastUpdated = formatMessageTime(thread.last_message_at);
  const firstMessage = messages[0] || {};
  const toEmail = firstMessage?.from_email || "";
  const senderLabel = getSenderLabel(firstMessage) || "";
  const toLabel = toEmail ? `${senderLabel || "Unknown"} <${toEmail}>` : "";
  const headerTitle = thread.subject || "Untitled ticket";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/40 lg:min-w-0">
      <header className="flex h-14 items-center justify-between border-b border-gray-100 bg-white px-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{headerTitle}</div>
          <div className="text-[11px] text-muted-foreground">
            {getSenderLabel(firstMessage)} • {firstMessage?.from_email} • Last update {lastUpdated}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDeleteThread}
            disabled={deletingThread}
            aria-label="Delete ticket"
            className="text-gray-400 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] space-y-5 px-4 pb-4 pt-3">
          {returnCase ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="font-medium text-slate-800">Return Case</div>
              <div className="mt-1 text-slate-600">
                Status: <span className="font-medium">{String(returnCase?.status || "requested")}</span>
              </div>
              <div className="text-slate-600">
                Eligibility:{" "}
                <span className="font-medium">
                  {typeof returnCase?.is_eligible === "boolean"
                    ? returnCase.is_eligible
                      ? "Eligible"
                      : "Not eligible"
                    : "Manual review"}
                </span>
              </div>
              <div className="text-slate-600">
                Shipping mode:{" "}
                <span className="font-medium">
                  {String(returnCase?.return_shipping_mode || "customer_paid")}
                </span>
              </div>
              {returnCase?.reason ? (
                <div className="text-slate-600">Reason: {String(returnCase.reason)}</div>
              ) : null}
            </div>
          ) : null}
          {orderUpdateError && !shouldShowActionCard ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {orderUpdateError}
            </div>
          ) : null}
          {messages.map((message) => {
            const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
            const persistedAttachments = attachments.filter(
              (attachment) => attachment.message_id === message.id
            );
            const messageAttachments =
              persistedAttachments.length || !Array.isArray(message?.attachments)
                ? persistedAttachments
                : message.attachments;
            const isDraft = Boolean(message.from_me && message.is_draft);
            const shouldInsertActionCardBeforeMessage =
              shouldShowActionCard &&
              !actionCardInserted &&
              (direction === "outbound" || isDraft);
            if (shouldInsertActionCardBeforeMessage) {
              actionCardInserted = true;
            }
            const primaryLog =
              Array.isArray(message.ai_logs) && message.ai_logs.length
                ? message.ai_logs[0]
                : null;
            const thinkingData = isDraft
              ? primaryLog
                ? {
                    type: primaryLog.step_name,
                    detail: primaryLog.step_detail,
                  }
                : message?.ai_context || message?.context || {
                    summary: "Analyzed request using Store Policies.",
                  }
              : null;
            return (
              <div key={message.id} className="space-y-3">
                {shouldInsertActionCardBeforeMessage ? (
                  <div className="ml-auto w-full max-w-[520px]">
                    <ActionCard
                      status={actionCardStatus}
                      testMode={isApprovedInTestMode}
                      actionName={pendingActionTitle}
                      detail={pendingOrderUpdate?.detail || ""}
                      error={orderUpdateError || ""}
                      loading={Boolean(orderUpdateSubmitting)}
                      extraContent={processReturnExtraContent}
                      onApprove={() =>
                        onOrderUpdateDecision?.(
                          "accepted",
                          isProcessReturnAction ? { restock: processReturnRestock } : undefined
                        )
                      }
                      onDecline={() => onOrderUpdateDecision?.("denied")}
                    />
                  </div>
                ) : null}
                {isDraft ? (
                  <div className="ml-auto w-full max-w-[520px]">
                    <ThinkingCard
                      data={thinkingData}
                      onClick={() => onOpenInsights?.(true)}
                    />
                  </div>
                ) : null}
                <MessageBubble
                  message={message}
                  direction={direction}
                  attachments={messageAttachments}
                  outboundSenderName={currentUserName}
                  currentUserId={currentUserId}
                />
              </div>
            );
          })}
          {shouldShowActionCard && !actionCardInserted ? (
            <div className="ml-auto w-full max-w-[520px]">
              <ActionCard
                status={actionCardStatus}
                actionName={pendingActionTitle}
                detail={pendingOrderUpdate.detail || ""}
                error={orderUpdateError || ""}
                loading={Boolean(orderUpdateSubmitting)}
                extraContent={processReturnExtraContent}
                onApprove={() =>
                  onOrderUpdateDecision?.(
                    "accepted",
                    isProcessReturnAction ? { restock: processReturnRestock } : undefined
                  )
                }
                onDecline={() => onOrderUpdateDecision?.("denied")}
              />
            </div>
          ) : null}
        </div>
      </div>

      {isActionPending ? (
        <div className="sticky bottom-0 flex-none bg-transparent px-3 py-2">
          <div className="mx-auto w-full max-w-[900px] rounded-3xl border border-violet-100 bg-violet-50/40 px-4 py-5 text-center">
            <div className="flex flex-col items-center justify-center">
              <Sparkles className="mb-2 h-5 w-5 animate-pulse text-violet-500" />
              <div className="text-sm font-medium text-violet-900">Sona is waiting for your decision</div>
              <p className="mt-1 max-w-xl text-xs text-violet-500">
                Review the action above to generate the reply draft.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <Composer
          value={draftValue}
          onChange={onDraftChange}
          signatureValue={signatureValue}
          onSignatureChange={onSignatureChange}
          onSignatureBlur={onSignatureBlur}
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
          onBlur={onDraftBlur}
          isDraftLoading={showThinkingCard}
        />
      )}
    </section>
  );
}
