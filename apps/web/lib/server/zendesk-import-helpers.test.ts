// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  estimateImportCost,
  importRetryDelayMs,
  isRetryableImportStatus,
  nextCursor,
  nextExportCursor,
  parseRetryAfterMs,
} from "./zendesk-import-helpers.ts";

Deno.test("estimateImportCost scales linearly and reports both currencies", () => {
  const e1 = estimateImportCost({ ticketCount: 1000 });
  const e2 = estimateImportCost({ ticketCount: 2000 });
  assertEquals(e1.ticketCount, 1000);
  assert(e1.usd > 0 && e1.dkk > e1.usd); // DKK-tal er større end USD-tal
  assert(Math.abs(e2.usd - 2 * e1.usd) < 0.01);
  assertEquals(estimateImportCost({ ticketCount: 0 }).usd, 0);
});

Deno.test("nextCursor walks pages then statuses then finishes", () => {
  const statuses = ["solved", "closed"];
  // start
  assertEquals(nextCursor({ statuses, cursor: null, pageHadFullBatch: true }), { status: "solved", page: 1 });
  // full batch -> next page, same status
  assertEquals(
    nextCursor({ statuses, cursor: { status: "solved", page: 3 }, pageHadFullBatch: true }),
    { status: "solved", page: 4 },
  );
  // short batch -> first page of next status
  assertEquals(
    nextCursor({ statuses, cursor: { status: "solved", page: 3 }, pageHadFullBatch: false }),
    { status: "closed", page: 1 },
  );
  // short batch on last status -> done
  assertEquals(
    nextCursor({ statuses, cursor: { status: "closed", page: 9 }, pageHadFullBatch: false }),
    null,
  );
});

Deno.test("import retry helpers respect transient statuses and retry-after", () => {
  assert(isRetryableImportStatus(408));
  assert(isRetryableImportStatus(429));
  assert(isRetryableImportStatus(503));
  assertEquals(isRetryableImportStatus(400), false);
  assertEquals(parseRetryAfterMs("2"), 2000);
  assertEquals(
    parseRetryAfterMs("Thu, 01 Jan 2026 00:00:05 GMT", Date.parse("2026-01-01T00:00:00Z")),
    5000,
  );
  assertEquals(importRetryDelayMs({ attempt: 0 }), 750);
  assertEquals(importRetryDelayMs({ attempt: 2, retryAfterMs: 5000 }), 5000);
  assertEquals(importRetryDelayMs({ attempt: 9 }), 12000);
});

Deno.test("nextExportCursor advances opaque cursors and status segments", () => {
  const now = "2026-07-11T18:00:00.000Z";
  assertEquals(nextExportCursor({
    statuses: ["solved", "closed"],
    cursor: { status: "solved", after: null },
    hasMore: true,
    afterCursor: "opaque-cursor",
    now,
  }), {
    status: "solved",
    after: "opaque-cursor",
    after_created_at: now,
  });
  assertEquals(nextExportCursor({
    statuses: ["solved", "closed"],
    cursor: { status: "solved", after: "opaque-cursor" },
    hasMore: false,
    afterCursor: null,
  }), { status: "closed", after: null });
  assertEquals(nextExportCursor({
    statuses: ["solved", "closed"],
    cursor: { status: "closed", after: null },
    hasMore: false,
    afterCursor: null,
  }), null);
});
