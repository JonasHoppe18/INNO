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
  return messages.map((message) => {
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
}
