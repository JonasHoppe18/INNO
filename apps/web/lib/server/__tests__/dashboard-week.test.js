import { describe, expect, it } from "vitest";
import { WEEK_COUNT, buildWeekStats } from "../dashboard-week.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo, minutes = 0) => new Date(NOW.getTime() - daysAgo * DAY + minutes * 60000).toISOString();

describe("buildWeekStats", () => {
  it("counts each resolved thread once per week", () => {
    const stats = buildWeekStats({
      now: NOW,
      lifecycleEvents: [
        { thread_id: "a", event_type: "resolved", occurred_at: at(1) },
        { thread_id: "a", event_type: "resolved", occurred_at: at(2) },
        { thread_id: "b", event_type: "resolved", occurred_at: at(3) },
        { thread_id: "c", event_type: "resolved", occurred_at: at(9) },
        { thread_id: "d", event_type: "reopened", occurred_at: at(1) },
        { thread_id: "e", event_type: "resolved", occurred_at: at(60) },
      ],
    });
    expect(stats.resolved.series).toHaveLength(WEEK_COUNT);
    expect(stats.resolved.value).toBe(2);
    expect(stats.resolved.previous).toBe(1);
  });

  it("measures the first human reply and ignores confirmation emails", () => {
    const stats = buildWeekStats({
      now: NOW,
      threads: [{ id: "a", created_at: at(2) }, { id: "b", created_at: at(2) }],
      messages: [
        { thread_id: "a", from_me: false, received_at: at(2) },
        { thread_id: "a", from_me: true, sent_at: at(2, 0), provider_message_id: "confirm-a" },
        { thread_id: "a", from_me: true, sent_at: at(2, 90), provider_message_id: "human-a" },
        { thread_id: "b", from_me: false, received_at: at(2) },
        { thread_id: "b", from_me: true, sent_at: at(2, 30), provider_message_id: "human-b" },
      ],
      autoReplyMessageIds: ["confirm-a"],
    });
    expect(stats.firstHumanReplyMinutes.value).toBe(60);
  });

  it("averages CSAT for the week and counts responses", () => {
    const stats = buildWeekStats({
      now: NOW,
      feedback: [{ score: 5, submitted_at: at(1) }, { score: 4, submitted_at: at(2) }, { score: 2, submitted_at: at(10) }],
    });
    expect(stats.csat).toMatchObject({ value: 4.5, previous: 2, responses: 2 });
  });

  it("shares of support tickets with a Sona draft, empty weeks as null", () => {
    const stats = buildWeekStats({
      now: NOW,
      threads: [{ id: "a", created_at: at(1) }, { id: "b", created_at: at(1) }, { id: "c", created_at: at(1) }, { id: "d", created_at: at(1) }],
      messages: [
        { thread_id: "a", from_me: false, received_at: at(1), ai_draft_text: "Hi" },
        { thread_id: "b", from_me: false, received_at: at(1), ai_draft_text: "Hi" },
        { thread_id: "c", from_me: false, received_at: at(1), ai_draft_text: "Hi" },
        { thread_id: "d", from_me: false, received_at: at(1) },
      ],
    });
    expect(stats.sonaDraftedPct).toMatchObject({ value: 75, tickets: 4, previous: null });
  });
});
