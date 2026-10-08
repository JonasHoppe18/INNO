// One place for how the app shows dates and times. The UI is English for now
// (until a language setting exists): day-first dates, 24h clock, always in
// Copenhagen time so every agent sees the same thing.
//
//   formatTime          11:44
//   formatDate          8 Oct            (8 Oct 2025 outside the current year)
//   formatDateTime      8 Oct, 11:44
//   formatFullDateTime  8 Oct 2026, 11:44   (tooltips, exact timestamps)
//   formatDateLong      8 October 2026
//   formatListTimestamp 11:44 · Yesterday · 3 days ago · 8 Oct
//   formatDayLabel      Today · Yesterday · 8 October 2026
//   formatWeekdayDay    Thu 8            (chart axes)
//   formatMonth         Oct              (Oct 2025 outside the current year)

export const DISPLAY_TIMEZONE = "Europe/Copenhagen";
const DISPLAY_LOCALE = "en-GB";
const DAY_MS = 24 * 60 * 60 * 1000;

// A bare calendar date ("2026-10-06") is anchored at noon UTC so it shows as
// that same day in Copenhagen (and any other timezone), not the day before.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" && DATE_ONLY_PATTERN.test(value)
        ? new Date(`${value}T12:00:00Z`)
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "YYYY-MM-DD" of the calendar day in Copenhagen.
export function calendarDayKey(value, timeZone = DISPLAY_TIMEZONE) {
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Whole calendar days from toKey to fromKey (positive when toKey is earlier).
export function calendarDayDistance(fromKey, toKey) {
  const [fy, fm, fd] = String(fromKey).split("-").map(Number);
  const [ty, tm, td] = String(toKey).split("-").map(Number);
  if (![fy, fm, fd, ty, tm, td].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(fy, fm - 1, fd) - Date.UTC(ty, tm - 1, td)) / DAY_MS);
}

function sameCalendarYear(date, now) {
  return calendarDayKey(date).slice(0, 4) === calendarDayKey(now).slice(0, 4);
}

function includeYear(date, year, now) {
  if (year === "always") return true;
  if (year === "never") return false;
  return !sameCalendarYear(date, now);
}

export function formatTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString(DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIMEZONE,
  });
}

// year: "auto" (only outside the current year) | "always" | "never"
export function formatDate(value, { year = "auto", now = new Date() } = {}) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    ...(includeYear(date, year, now) ? { year: "numeric" } : {}),
    timeZone: DISPLAY_TIMEZONE,
  });
}

export function formatDateTime(value, { year = "auto", now = new Date() } = {}) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    ...(includeYear(date, year, now) ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIMEZONE,
  });
}

export function formatFullDateTime(value) {
  return formatDateTime(value, { year: "always" });
}

export function formatDateLong(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: DISPLAY_TIMEZONE,
  });
}

// Inbox rows: time today, then Yesterday / N days ago within a week, then a date.
export function formatListTimestamp(value, { now = new Date() } = {}) {
  const date = toDate(value);
  if (!date) return "";
  const days = calendarDayDistance(calendarDayKey(now), calendarDayKey(date));
  if (days === 0) return formatTime(date);
  if (days === 1) return "Yesterday";
  if (Number.isFinite(days) && days > 1 && days < 7) return `${days} days ago`;
  return formatDate(date, { now });
}

// Conversation day separators.
export function formatDayLabel(value, { now = new Date() } = {}) {
  const date = toDate(value);
  if (!date) return "";
  const days = calendarDayDistance(calendarDayKey(now), calendarDayKey(date));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatDateLong(date);
}

export function formatWeekdayDay(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    weekday: "short",
    day: "numeric",
    timeZone: DISPLAY_TIMEZONE,
  });
}

export function formatMonth(value, { year = "auto", now = new Date() } = {}) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    month: "short",
    ...(includeYear(date, year, now) ? { year: "numeric" } : {}),
    timeZone: DISPLAY_TIMEZONE,
  });
}
