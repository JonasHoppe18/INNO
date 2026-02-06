import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { ThinkingCard } from "@/components/inbox/ThinkingCard";
import { formatMessageTime, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";

export function TicketDetail({
  thread,
  messages,
  attachments,
  currentUserName,
  ticketState,
  onTicketStateChange,
  onOpenInsights,
  showThinkingCard = false,
  draftValue,
  onDraftChange,
  onDraftBlur,
  draftLoaded,
  canSend,
  onSend,
  onDeleteThread,
  deletingThread,
  composerMode,
  onComposerModeChange,
  mailboxEmails,
}) {
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:min-w-0">
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
        <div className="w-full space-y-3 px-4 pb-3 pt-3">
          {messages.map((message) => {
            const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
            const messageAttachments = attachments.filter(
              (attachment) => attachment.message_id === message.id
            );
            const isDraft = Boolean(message.from_me && message.is_draft);
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
              <div key={message.id} className="space-y-2">
                {isDraft ? (
                  <ThinkingCard
                    data={thinkingData}
                    onClick={() => onOpenInsights?.(true)}
                  />
                ) : null}
                <MessageBubble
                  message={message}
                  direction={direction}
                  attachments={messageAttachments}
                  outboundSenderName={currentUserName}
                />
              </div>
            );
          })}
          {showThinkingCard ? (
            <ThinkingCard loading onClick={() => onOpenInsights?.(true)} />
          ) : null}
        </div>
      </div>

  <Composer
    value={draftValue}
    onChange={onDraftChange}
    draftLoaded={draftLoaded}
    canSend={canSend}
    onSend={onSend}
    mode={composerMode}
    onModeChange={onComposerModeChange}
    toLabel={toLabel}
    onBlur={onDraftBlur}
  />
    </section>
  );
}
