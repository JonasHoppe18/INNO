import { describe, expect, it } from "vitest";
import { buildAnalyticsTrendSeries, buildPrioritySignals, calculateFirstContactResolution } from "../analytics-series.js";

const solved = (thread) => ["solved", "closed", "resolved"].includes(thread.status);

describe("buildAnalyticsTrendSeries", () => {
  it("groups created and measured solved tickets without double counting lifecycle events", () => {
    const result = buildAnalyticsTrendSeries({
      grouping: "day",
      threads: [
        { id: "a", status: "solved", created_at: "2026-07-01T09:00:00Z", updated_at: "2026-07-03T09:00:00Z" },
        { id: "b", status: "open", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-01T10:00:00Z" },
      ],
      lifecycleEvents: [
        { thread_id: "a", event_type: "resolved", occurred_at: "2026-07-02T12:00:00Z" },
        { thread_id: "a", event_type: "resolved", occurred_at: "2026-07-03T12:00:00Z" },
      ],
      isSolvedThread: solved,
    });

    expect(result.support.series).toEqual([
      { date: "2026-07-01", created: 2, solved: 0 },
      { date: "2026-07-02", created: 0, solved: 1 },
    ]);
    expect(result.support.solvedDataQuality).toBe("measured");
  });

  it("marks historical solved timestamps as proxies", () => {
    const result = buildAnalyticsTrendSeries({
      grouping: "week",
      threads: [{ id: "a", status: "closed", created_at: "2026-07-01T09:00:00Z", updated_at: "2026-07-10T09:00:00Z" }],
      isSolvedThread: solved,
    });

    expect(result.support.solvedProxyCount).toBe(1);
    expect(result.support.solvedDataQuality).toBe("proxy_included");
    expect(result.support.series).toEqual([
      { date: "2026-06-29", created: 1, solved: 0 },
      { date: "2026-07-06", created: 0, solved: 1 },
    ]);
  });

  it("builds commerce and Sona rate series from minimal facts", () => {
    const result = buildAnalyticsTrendSeries({
      grouping: "month",
      threads: [
        { id: "a", status: "open", created_at: "2026-07-01T09:00:00Z" },
        { id: "b", status: "open", created_at: "2026-07-02T09:00:00Z" },
      ],
      orders: [{ order_created_at: "2026-07-01T09:00:00Z" }, { order_created_at: "2026-07-02T09:00:00Z" }],
      refunds: [{ refunded_at: "2026-07-03T09:00:00Z" }],
      returnCases: [{ created_at: "2026-07-04T09:00:00Z" }],
      linkedThreadIds: new Set(["a"]),
      assistedThreadIds: new Set(["a"]),
      isSolvedThread: solved,
    });

    expect(result.commerce.series).toEqual([{ date: "2026-07", orders: 2, linkedTickets: 1, ticketsPer100Orders: 50, returnCases: 1, refunds: 1 }]);
    expect(result.sona.series).toEqual([{ date: "2026-07", supportTickets: 2, assistedTickets: 1, assistedRate: 50 }]);
  });
});

describe("buildPrioritySignals", () => {
  it("prioritizes service health before friction, business impact and automation", () => {
    const result = buildPrioritySignals({
      unsolvedTickets: 12,
      unsolvedTicketsChangePct: 20,
      medianFirstReplyChangePct: 30,
      highVolumeSlowResponse: [{ key: "topic:refund", topic: "Refund", count: 8 }],
      ticketsPer100OrdersChangePct: 15,
      refundRateChangePct: 10,
      readyCandidates: [{ key: "action:refund", label: "Refund status", reason: "91% approval" }],
    });

    expect(result.map((signal) => signal.type)).toEqual(["support", "friction", "business", "automation"]);
    expect(result[0].drilldownKey).toBe("unsolved_tickets");
    expect(result).toHaveLength(4);
  });

  it("does not label higher ticket volume as a positive signal", () => {
    const result = buildPrioritySignals({ unsolvedTickets: 0, unsolvedTicketsChangePct: null });
    expect(result).toEqual([]);
  });
});

describe("calculateFirstContactResolution", () => {
  const observationEnd = "2026-07-22T12:00:00Z";

  it("counts one-reply tickets that stay resolved for seven days", () => {
    const result = calculateFirstContactResolution({
      threads: [{ id: "resolved-once" }, { id: "reopened" }, { id: "multi-reply" }],
      lifecycleEvents: [
        { thread_id: "resolved-once", event_type: "resolved", occurred_at: "2026-07-10T10:00:00Z" },
        { thread_id: "reopened", event_type: "resolved", occurred_at: "2026-07-10T10:00:00Z" },
        { thread_id: "reopened", event_type: "reopened", occurred_at: "2026-07-12T10:00:00Z" },
        { thread_id: "multi-reply", event_type: "resolved", occurred_at: "2026-07-10T10:00:00Z" },
      ],
      agentReplyCountsByThreadId: { "resolved-once": 1, reopened: 1, "multi-reply": 2 },
      observationEnd,
    });

    expect(result.eligibleTickets).toBe(3);
    expect(result.firstContactResolvedTickets).toBe(1);
    expect(result.rate).toBe(33);
    expect([...result.firstContactResolvedThreadIds]).toEqual(["resolved-once"]);
  });

  it("excludes resolutions that have not completed the observation window", () => {
    const result = calculateFirstContactResolution({
      threads: [{ id: "mature" }, { id: "recent" }, { id: "untracked" }],
      lifecycleEvents: [
        { thread_id: "mature", event_type: "resolved", occurred_at: "2026-07-10T10:00:00Z" },
        { thread_id: "recent", event_type: "resolved", occurred_at: "2026-07-20T10:00:00Z" },
      ],
      agentReplyCountsByThreadId: { mature: 1, recent: 1, untracked: 1 },
      observationEnd,
    });

    expect(result.eligibleTickets).toBe(1);
    expect(result.firstContactResolvedTickets).toBe(1);
    expect(result.rate).toBe(100);
  });

  it("does not penalize a ticket reopened after the seven-day window", () => {
    const result = calculateFirstContactResolution({
      threads: [{ id: "late-reopen" }],
      lifecycleEvents: [
        { thread_id: "late-reopen", event_type: "resolved", occurred_at: "2026-07-10T10:00:00Z" },
        { thread_id: "late-reopen", event_type: "reopened", occurred_at: "2026-07-18T10:00:01Z" },
      ],
      agentReplyCountsByThreadId: { "late-reopen": 1 },
      observationEnd,
    });

    expect(result.firstContactResolvedTickets).toBe(1);
    expect(result.rate).toBe(100);
  });
});
