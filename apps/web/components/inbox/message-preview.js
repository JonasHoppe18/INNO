import { getMessageTimestamp, isOutboundMessage } from "./inbox-utils";

export function customerPreviewsByThread(messages, mailboxEmails = [], isInternalSender = () => false) {
  const latest = new Map();
  for (const message of messages || []) {
    if (!message?.thread_id || message.is_draft || isOutboundMessage(message, mailboxEmails) || isInternalSender(message)) continue;
    const timestamp = new Date(getMessageTimestamp(message)).getTime() || 0;
    const previous = latest.get(message.thread_id);
    if (!previous || timestamp >= previous.timestamp) latest.set(message.thread_id, { message, timestamp });
  }
  return Object.fromEntries([...latest].map(([threadId, { message }]) => {
    const text = message.clean_body_text || message.body_text || message.snippet || String(message.body_html || "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
    return [threadId, String(text).replace(/\s+/g, " ").trim().slice(0, 240)];
  }));
}
