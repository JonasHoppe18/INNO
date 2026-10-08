import { describe, expect, it } from "vitest";
import {
  calendarDayDistance,
  calendarDayKey,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatDayLabel,
  formatFullDateTime,
  formatListTimestamp,
  formatMonth,
  formatTime,
  formatWeekdayDay,
} from "../datetime";

// 2026-10-08 12:00 in Copenhagen (UTC+2 in October).
const NOW = new Date("2026-10-08T10:00:00Z");

describe("datetime formatting (English UI, 24h, Copenhagen time)", () => {
  it("formats times as 24h in Copenhagen regardless of the runtime timezone", () => {
    expect(formatTime("2026-10-08T09:44:00Z")).toBe("11:44");
    expect(formatTime("2026-10-08T17:05:00Z")).toBe("19:05");
    expect(formatTime("2026-10-08T07:04:00Z")).toBe("09:04");
  });

  it("formats dates day-first and only adds the year outside the current year", () => {
    expect(formatDate("2026-10-06T10:00:00Z", { now: NOW })).toBe("6 Oct");
    expect(formatDate("2025-03-14T10:00:00Z", { now: NOW })).toBe("14 Mar 2025");
    expect(formatDate("2026-10-06T10:00:00Z", { year: "always", now: NOW })).toBe("6 Oct 2026");
    expect(formatDate("2025-03-14T10:00:00Z", { year: "never", now: NOW })).toBe("14 Mar");
  });

  it("formats date and time together", () => {
    expect(formatDateTime("2026-10-08T09:44:00Z", { now: NOW })).toBe("8 Oct, 11:44");
    expect(formatDateTime("2025-12-31T22:30:00Z", { now: NOW })).toBe("31 Dec 2025, 23:30");
    expect(formatFullDateTime("2026-10-08T09:44:00Z")).toBe("8 Oct 2026, 11:44");
    expect(formatDateLong("2026-10-08T09:44:00Z")).toBe("8 October 2026");
  });

  it("uses the Copenhagen calendar day, not UTC, around midnight", () => {
    // 23:30 UTC on 7 Oct is 01:30 on 8 Oct in Copenhagen.
    expect(calendarDayKey("2026-10-07T23:30:00Z")).toBe("2026-10-08");
    expect(calendarDayDistance("2026-10-08", "2026-10-05")).toBe(3);
  });

  it("keeps bare calendar dates on their own day", () => {
    expect(formatDate("2026-10-06", { now: NOW })).toBe("6 Oct");
    expect(calendarDayKey("2026-01-01")).toBe("2026-01-01");
  });

  it("formats inbox list timestamps relative to today", () => {
    expect(formatListTimestamp("2026-10-08T06:35:00Z", { now: NOW })).toBe("08:35");
    expect(formatListTimestamp("2026-10-07T08:43:00Z", { now: NOW })).toBe("Yesterday");
    expect(formatListTimestamp("2026-10-05T08:43:00Z", { now: NOW })).toBe("3 days ago");
    expect(formatListTimestamp("2026-09-20T08:43:00Z", { now: NOW })).toBe("20 Sept");
    expect(formatListTimestamp("2025-09-20T08:43:00Z", { now: NOW })).toBe("20 Sept 2025");
  });

  it("formats chart labels", () => {
    expect(formatWeekdayDay("2026-10-08")).toBe("Thu 8");
    expect(formatMonth("2026-10-01", { now: NOW })).toBe("Oct");
    expect(formatMonth("2025-10-01", { now: NOW })).toBe("Oct 2025");
  });

  it("labels conversation days", () => {
    expect(formatDayLabel("2026-10-08T06:35:00Z", { now: NOW })).toBe("Today");
    expect(formatDayLabel("2026-10-07T06:35:00Z", { now: NOW })).toBe("Yesterday");
    expect(formatDayLabel("2026-10-01T06:35:00Z", { now: NOW })).toBe("1 October 2026");
  });

  it("returns an empty string for missing or invalid input", () => {
    for (const fn of [formatTime, formatDate, formatDateTime, formatFullDateTime, formatListTimestamp]) {
      expect(fn(null)).toBe("");
      expect(fn("not a date")).toBe("");
    }
  });
});
