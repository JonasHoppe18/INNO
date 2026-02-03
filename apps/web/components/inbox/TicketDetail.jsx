import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { formatMessageTime, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";

export function TicketDetail({
  thread,
  messages,
  attachments,
  ticketState,
  onTicketStateChange,
  onOpenInsights,
  draftValue,
  onDraftChange,
  draftLoaded,
  canSend,
  onSend,
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
  const toLabel = `${getSenderLabel(firstMessage) || "Unknown"} <${
    firstMessage?.from_email || "unknown@email.com"
  }>`;
  const headerTitle = thread.subject || "Untitled ticket";
  const statusLabel =
    ticketState.status === "Solved" ? "Resolved" : ticketState.status;
  const statusStyles =
    ticketState.status === "Solved"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-green-50 text-green-700 border-green-200";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:min-w-0">
      <header className="flex h-16 items-center justify-between border-b border-gray-100 bg-white px-6">
        <div className="min-w-0">
          <div className="text-lg font-bold text-gray-900">{headerTitle}</div>
          <div className="text-xs text-muted-foreground">
            {getSenderLabel(firstMessage)} • {firstMessage?.from_email} • Last update {lastUpdated}
          </div>
        </div>
        <div />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full divide-y divide-gray-100 px-6 pb-6 pt-0">
          {messages.map((message, index) => {
          const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
          const messageAttachments = attachments.filter(
            (attachment) => attachment.message_id === message.id
          );
          return (
            <div key={message.id} className="py-2">
              <MessageBubble
                message={message}
                direction={direction}
                attachments={messageAttachments}
              />
            </div>
          );
        })}
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
  />
    </section>
  );
}
