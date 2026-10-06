// Sent events identify confirmations; sender names and subjects do not.
export async function markConfirmationMessages(
  client,
  messages,
  { workspaceId, threadId, mailboxIds },
) {
  const outgoing = messages.filter(
    (message) =>
      message.from_me && !message.is_draft && message.provider_message_id,
  );
  if (!workspaceId || !outgoing.length) return messages;
  const { data, error } = await client
    .from("mail_auto_reply_events")
    .select("mailbox_id, thread_id, sent_message_id, sent_at")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .in("mailbox_id", mailboxIds)
    .in(
      "sent_message_id",
      outgoing.map((message) => message.provider_message_id),
    );
  // Keep the conversation readable if optional confirmation metadata is unavailable.
  if (error) return messages;
  const marked = messages.map((message) => {
    if (!message.from_me || message.is_draft) return message;
    const event = (data || []).find(
      (row) =>
        row.sent_at &&
        row.mailbox_id === message.mailbox_id &&
        row.thread_id === message.thread_id &&
        row.sent_message_id === message.provider_message_id,
    );
    return event
      ? { ...message, confirmation_sent_at: event.sent_at }
      : message;
  });
  const unmatched = marked.filter(
    (message) =>
      message.from_me &&
      !message.is_draft &&
      message.provider_message_id &&
      !message.confirmation_sent_at &&
      message.thread_id === threadId &&
      mailboxIds.includes(message.mailbox_id),
  );
  if (!unmatched.length) return marked;
  // Older senders log successful delivery even when the dedicated event insert
  // fails. The authorized thread and exact provider ID bind that evidence.
  const { data: logs, error: logError } = await client
    .from("agent_logs")
    .select("workspace_id, step_detail, created_at")
    .eq("step_name", "postmark_inbound_auto_reply_sent")
    .eq("status", "success")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .like("step_detail", `%"threadId":"${threadId}"%`)
    .limit(100);
  if (logError) return marked;
  const sentByProviderId = new Map();
  for (const log of logs || []) {
    if (log.workspace_id && log.workspace_id !== workspaceId) continue;
    try {
      const detail =
        typeof log.step_detail === "string"
          ? JSON.parse(log.step_detail)
          : log.step_detail;
      if (
        detail?.threadId === threadId &&
        detail.sentMessageId &&
        Number.isFinite(Date.parse(log.created_at))
      ) {
        sentByProviderId.set(detail.sentMessageId, log.created_at);
      }
    } catch {
      /* Invalid legacy log entries are not delivery evidence. */
    }
  }
  return marked.map((message) =>
    unmatched.includes(message) &&
    sentByProviderId.has(message.provider_message_id)
      ? {
          ...message,
          confirmation_sent_at:
            message.sent_at ||
            sentByProviderId.get(message.provider_message_id),
        }
      : message,
  );
}
