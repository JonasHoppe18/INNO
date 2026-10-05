// CSAT delivery lives in survey requests, not mail_messages. Attach display
// metadata to an existing message so surveys cannot become reply targets.
export async function markCsatSentEvent(
  client,
  messages,
  { workspaceId, threadId, mailboxIds },
) {
  const candidates = messages.filter(
    (message) =>
      !message.is_draft &&
      message.thread_id === threadId &&
      mailboxIds.includes(message.mailbox_id),
  );
  if (!workspaceId || !candidates.length) return messages;
  const { data: event, error } = await client
    .from("csat_survey_requests")
    .select("id, workspace_id, thread_id, status, sent_at")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .in("status", ["sent", "responded"])
    .maybeSingle();
  if (
    error ||
    !event?.sent_at ||
    !["sent", "responded"].includes(event.status) ||
    event.workspace_id !== workspaceId ||
    event.thread_id !== threadId
  )
    return messages;
  const sentAt = Date.parse(event.sent_at);
  if (!Number.isFinite(sentAt)) return messages;
  const timestamp = (message) =>
    Date.parse(
      message.received_at || message.sent_at || message.created_at || "",
    ) || 0;
  const ordered = [...candidates].sort((a, b) => timestamp(a) - timestamp(b));
  const preceding = ordered.filter((message) => timestamp(message) <= sentAt);
  const anchor = preceding[preceding.length - 1] || ordered[0];
  return messages.map((message) =>
    message.id === anchor.id
      ? {
          ...message,
          csat_sent_event: { id: event.id, sent_at: event.sent_at },
        }
      : message,
  );
}
