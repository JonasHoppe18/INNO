// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { estimateImportCost, nextCursor } from "./zendesk-import-helpers.ts";

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
