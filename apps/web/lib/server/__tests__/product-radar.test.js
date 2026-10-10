import { describe, expect, it } from "vitest";
import { RADAR_RULES, buildProductRadar, classifyProductSignal } from "../product-radar.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// Weekly counts oldest -> newest; the last entry is the current 7 days.
// AceZone prod support tickets, 13 rolling weeks up to 2026-10-10.
const A_RISE = [2, 1, 2, 2, 1, 2, 2, 4, 1, 4, 5, 6, 4];
const A_BLAZE = [3, 2, 1, 5, 5, 3, 0, 1, 4, 5, 6, 4, 2];
const A_SPIRE_WIRELESS = [16, 17, 11, 15, 14, 14, 25, 10, 20, 21, 23, 13, 15];
// A-Spire up to 2026-08-15: rising for one week only, back to normal after a quiet spell.
const A_SPIRE_FLICKER = [4, 1, 3, 6, 2, 0, 0, 2, 1, 4, 3, 4, 4];

function threadsFromWeekly(productId, weekly, extra = {}) {
  const threads = [];
  weekly.forEach((count, index) => {
    const weeksAgo = weekly.length - 1 - index;
    for (let i = 0; i < count; i += 1) {
      const createdAt = new Date(NOW.getTime() - weeksAgo * 7 * DAY - (i + 1) * 60 * 60 * 1000);
      threads.push({
        id: `${productId}-${index}-${i}`,
        created_at: createdAt.toISOString(),
        classification_key: "support",
        detected_product_id: productId,
        issue_summary: `Issue ${index}-${i}`,
        ...extra,
      });
    }
  });
  return threads;
}

describe("classifyProductSignal", () => {
  it("flags a slow climb as rising", () => {
    const result = classifyProductSignal(A_RISE);
    expect(result.status).toBe("rising");
    expect(result.recentTotal).toBe(19);
    expect(result.priorMean).toBeCloseTo(1.875);
  });

  it("stays quiet on normal week-to-week variation", () => {
    expect(classifyProductSignal(A_BLAZE).status).toBe("steady");
    expect(classifyProductSignal(A_SPIRE_WIRELESS).status).toBe("steady");
  });

  it("only calls a trend once it has held for two weeks in a row", () => {
    expect(classifyProductSignal(A_SPIRE_FLICKER).status).toBe("steady");
    // A-Rise one week earlier: also rising, which is what confirms the trend above.
    expect(classifyProductSignal(A_RISE.slice(0, -1)).status).toBe("rising");
  });

  it("flags a sudden jump as a spike, not also as rising", () => {
    const result = classifyProductSignal([2, 2, 1, 3, 2, 1, 2, 3, 2, 1, 2, 1, 14]);
    expect(result.status).toBe("spike");
    expect(result.current).toBe(14);
    expect(result.baseline).toBeCloseTo(1.75);
  });

  it("needs an absolute minimum before calling a spike", () => {
    // 4 against a baseline of 0 is a big ratio but too few tickets to act on.
    expect(classifyProductSignal([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4]).status).toBe("steady");
    expect(classifyProductSignal([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, RADAR_RULES.spikeMinCurrent]).status).toBe("spike");
  });

  it("needs enough recent volume before calling a trend", () => {
    expect(classifyProductSignal([0, 0, 0, 0, 1, 0, 0, 0, 2, 2, 2, 2]).status).toBe("steady");
  });
});

describe("buildProductRadar", () => {
  const productMap = { 1: "A-Rise", 2: "A-Blaze", 3: "A-Spire Wireless" };

  it("builds rolling weekly series per product and puts alerts first", () => {
    const threads = [
      ...threadsFromWeekly("2", A_BLAZE),
      ...threadsFromWeekly("1", A_RISE),
      ...threadsFromWeekly("3", A_SPIRE_WIRELESS),
    ];
    const radar = buildProductRadar({ threads, productMap, now: NOW });

    expect(radar.products.map((row) => row.name)).toEqual(["A-Rise", "A-Spire Wireless", "A-Blaze"]);
    const rise = radar.products[0];
    // The oldest week only feeds the two-week trend check; 12 weeks are shown.
    const shown = A_RISE.slice(-RADAR_RULES.weeks);
    expect(rise.weekly.map((week) => week.count)).toEqual(shown);
    expect(rise.weekly.at(-1).weekStart).toBe("2026-10-03");
    expect(rise.total).toBe(shown.reduce((sum, n) => sum + n, 0));
    expect(radar.alerts.map((row) => row.name)).toEqual(["A-Rise"]);
  });

  it("only counts support tickets and reports product coverage", () => {
    const threads = [
      ...threadsFromWeekly("1", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6]),
      ...threadsFromWeekly("1", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30], { classification_key: "notification" }),
      ...threadsFromWeekly("1", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30], { tags: ["inbox:partners"] }),
      ...threadsFromWeekly(null, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
    ];
    const radar = buildProductRadar({ threads, productMap, now: NOW });

    expect(radar.products).toHaveLength(1);
    expect(radar.products[0].current).toBe(6);
    expect(radar.coverage).toEqual({ supportTickets: 8, linkedTickets: 6, pct: 75 });
  });

  it("ignores threads outside the 12-week window", () => {
    const old = { id: "old", created_at: new Date(NOW.getTime() - 90 * DAY).toISOString(), classification_key: "support", detected_product_id: "1" };
    const radar = buildProductRadar({ threads: [old], productMap, now: NOW });
    expect(radar.products).toEqual([]);
    expect(radar.coverage.supportTickets).toBe(0);
  });

  it("keeps the newest issue summaries per product", () => {
    const threads = threadsFromWeekly("1", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6]);
    const [row] = buildProductRadar({ threads, productMap, now: NOW }).products;

    expect(row.recentIssues).toHaveLength(RADAR_RULES.recentIssues);
    expect(row.recentIssues[0]).toMatchObject({ threadId: "1-11-0", summary: "Issue 11-0" });
  });

  it("falls back to a readable name for unknown products", () => {
    const threads = threadsFromWeekly("99", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(buildProductRadar({ threads, productMap, now: NOW }).products[0].name).toBe("Product #99");
  });
});
