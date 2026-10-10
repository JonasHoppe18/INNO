// Replays the Product Radar alert rules week by week over historical counts.
// Usage: node scripts/product-radar-backtest.mjs <counts.json> [anchorIso]
//
// counts.json maps product name -> [[weeksAgo, count], ...], where weeksAgo is
// floor((anchor - created_at) / 7 days) over support threads only. Shop data
// stays outside the repo; see docs/product-radar.md for the query.
import { readFileSync } from "node:fs";
import { RADAR_RULES, classifyProductSignal } from "../lib/server/product-radar.js";

const [file, anchorIso = new Date().toISOString()] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/product-radar-backtest.mjs <counts.json> [anchorIso]");
  process.exit(1);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const anchorMs = Date.parse(anchorIso);
const data = JSON.parse(readFileSync(file, "utf8"));
const oldestWeek = Math.max(...Object.values(data).flatMap((rows) => rows.map(([weeksAgo]) => weeksAgo)));
const windowWeeks = RADAR_RULES.weeks + RADAR_RULES.risingConfirmWeeks - 1;
const lastAnchor = oldestWeek - (windowWeeks - 1);
let alertCount = 0;

for (const [name, rows] of Object.entries(data)) {
  const byWeek = Object.fromEntries(rows);
  const series = Array.from({ length: oldestWeek + 1 }, (_, weeksAgo) => byWeek[weeksAgo] || 0);
  console.log(`${name.padEnd(22)} oldest -> newest: ${[...series].reverse().join(" ")}`);
  for (let k = lastAnchor; k >= 0; k -= 1) {
    const signal = classifyProductSignal(series.slice(k, k + windowWeeks).reverse());
    if (signal.status === "steady") continue;
    alertCount += 1;
    const date = new Date(anchorMs - k * WEEK_MS).toISOString().slice(0, 10);
    console.log(
      `   ${date} ${signal.status.toUpperCase().padEnd(6)} current=${signal.current} baseline=${signal.baseline.toFixed(1)}`
      + ` last4=${signal.recentTotal} prior8mean=${signal.priorMean.toFixed(1)}`,
    );
  }
}

console.log(`\n${alertCount} alert-weeks across ${Math.max(lastAnchor + 1, 0)} anchors`);
