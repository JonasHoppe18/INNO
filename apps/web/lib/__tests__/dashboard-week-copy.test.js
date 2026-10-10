import { describe, expect, it } from "vitest";
import { formatMinutes, hasWeekData, weekCards } from "../dashboard-week-copy.js";

describe("hasWeekData", () => {
  const quiet = {
    resolved: { series: [0, 0, 0] },
    firstHumanReplyMinutes: { series: [null, null, null] },
    csat: { series: [null, null, null] },
    sonaDraftedPct: { series: [null, 0, 0] },
  };

  it("is false for a workspace with tickets but no activity yet", () => {
    expect(hasWeekData(quiet)).toBe(false);
    expect(hasWeekData(null)).toBe(false);
  });

  it("is true as soon as any week has activity", () => {
    expect(hasWeekData({ ...quiet, resolved: { series: [0, 1, 0] } })).toBe(true);
    expect(hasWeekData({ ...quiet, firstHumanReplyMinutes: { series: [null, 45, null] } })).toBe(true);
  });
});

const series = (value, previous) => ({ value, previous, series: [previous, value] });

describe("formatMinutes", () => {
  it("reads naturally from minutes to days", () => {
    expect(formatMinutes(25)).toBe("25m");
    expect(formatMinutes(100)).toBe("1h 40m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(3000)).toBe("2d 2h");
    expect(formatMinutes(null)).toBe("—");
  });
});

describe("weekCards", () => {
  it("marks a faster reply as good and a drop in resolved as bad", () => {
    const cards = weekCards({
      resolved: series(30, 40),
      firstHumanReplyMinutes: series(100, 122),
      csat: { ...series(4.6, 4.4), responses: 12 },
      sonaDraftedPct: { ...series(82, 77), tickets: 40 },
    });
    expect(cards.map((card) => [card.key, card.value, card.change?.label, card.change?.good])).toEqual([
      ["resolved", "30", "−25%", false],
      ["reply", "1h 40m", "−18%", true],
      ["csat", "4.6", "+0.2", true],
      ["drafted", "82%", "+5 pts", true],
    ]);
    expect(cards[2].detail).toBe("12 responses");
  });

  it("shows no change pill without a previous week and explains empty values", () => {
    const cards = weekCards({
      resolved: series(0, 0),
      firstHumanReplyMinutes: series(null, null),
      csat: { ...series(null, null), responses: 0 },
      sonaDraftedPct: { ...series(null, null), tickets: 0 },
    });
    expect(cards.every((card) => card.change === null)).toBe(true);
    expect(cards.map((card) => card.value)).toEqual(["0", "—", "—", "—"]);
    expect(cards[1].detail).toBe("No replies in the last 7 days");
  });
});
