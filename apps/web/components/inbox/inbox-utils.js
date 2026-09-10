import {
  getEffectiveSenderEmail,
  getEffectiveSenderName,
  getReplyTargetEmail,
  getSenderLabel,
} from "@/lib/inbox/sender";

const MESSAGE_DISPLAY_TIMEZONE = "Europe/Copenhagen";
const DAY_MS = 24 * 60 * 60 * 1000;

function getCalendarDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
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

function getCalendarDayDistance(fromKey, toKey) {
  const [fromYear, fromMonth, fromDay] = String(fromKey).split("-").map(Number);
  const [toYear, toMonth, toDay] = String(toKey).split("-").map(Number);
  if (![fromYear, fromMonth, fromDay, toYear, toMonth, toDay].every(Number.isFinite)) {
    return null;
  }
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((fromUtc - toUtc) / DAY_MS);
}

export function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffDays = getCalendarDayDistance(
    getCalendarDayKey(new Date()),
    getCalendarDayKey(date),
  );
  if (diffDays === 0) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: MESSAGE_DISPLAY_TIMEZONE,
    });
  }
  if (diffDays === 1) return "Yesterday";
  if (Number.isFinite(diffDays) && diffDays > 1 && diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: MESSAGE_DISPLAY_TIMEZONE,
  });
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
