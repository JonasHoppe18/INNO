import { formatListTimestamp } from "@/lib/format/datetime";
import {
  getEffectiveSenderEmail,
  getEffectiveSenderName,
  getReplyTargetEmail,
  getSenderLabel,
} from "@/lib/inbox/sender";

// Inbox list timestamps: 11:44 today, Yesterday, N days ago, then 8 Oct.
export function formatMessageTime(value) {
  return formatListTimestamp(value);
}

export function formatBytes(value) {
  if (!value || Number.isNaN(Number(value))) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function getMessageTimestamp(message) {
  return message?.received_at || message?.sent_at || message?.created_at || "";
}

export function isOutboundMessage(message, mailboxEmails = []) {
  if (message?.from_me === true) return true;
  // Any received message is inbound unless explicitly marked as sent by us.
  if (message?.received_at && message?.from_me !== true) return false;
  if (message?.sent_at && !message?.received_at) return true;
  const sender = getReplyTargetEmail(message).toLowerCase();
  if (!sender) return false;
  if (mailboxEmails.length) {
    return mailboxEmails.some((email) => email.toLowerCase() === sender);
  }
  return sender.includes("sona") || sender.includes("support") || sender.includes("hello");
}

export function getInboxBucket(thread) {
  const key = String(thread?.classification_key || "").trim().toLowerCase();
  if (key === "blocked") return "blocked";
  return key === "notification" ? "notification" : "ticket";
}

export { getEffectiveSenderEmail, getEffectiveSenderName, getReplyTargetEmail, getSenderLabel };
