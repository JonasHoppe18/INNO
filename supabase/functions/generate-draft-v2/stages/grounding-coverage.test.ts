// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { assessGroundingCoverage, buildOwnsTheCaseBlock } from "./grounding-coverage.ts";

Deno.test("ungrounded when nothing grounds the ask (no chunks, no facts)", () => {
  const r = assessGroundingCoverage({
    intent: "other", chunkCount: 0, matcherAbstained: false,
    verifiedFactsCount: 0, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, true);
  assert(typeof r.reason === "string" && r.reason.length > 0);
});

Deno.test("matcher abstention marks ungrounded even when fallback chunks exist", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 3, matcherAbstained: true,
    verifiedFactsCount: 0, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, true);
});

Deno.test("grounded when chunks matched (no abstention)", () => {
  const r = assessGroundingCoverage({
    intent: "warranty", chunkCount: 4, matcherAbstained: false,
    verifiedFactsCount: 0, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("grounded when live facts answer even without chunks", () => {
  const r = assessGroundingCoverage({
    intent: "tracking", chunkCount: 0, matcherAbstained: false,
    verifiedFactsCount: 2, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("thanks/update never trigger; missing inputs are fail-safe", () => {
  assertEquals(assessGroundingCoverage({ intent: "thanks", chunkCount: 0 }).ungrounded, false);
  assertEquals(assessGroundingCoverage({ intent: "update", chunkCount: 0 }).ungrounded, false);
  assertEquals(assessGroundingCoverage({}).ungrounded, false); // no signals at all -> fail-safe
  assertEquals(assessGroundingCoverage({ intent: "other" }).ungrounded, false); // counts undefined -> fail-safe
});

Deno.test("directive forbids invented refusals and includes the customer's ask", () => {
  const block = buildOwnsTheCaseBlock({ customerAsk: "Kan I kontakte Maxgaming?", intent: "complaint" });
  assert(block.includes("Kan I kontakte Maxgaming?"));
  assert(/opfind ALDRIG|ALDRIG en afvisning/i.test(block));
  assert(/undersøger .* vender tilbage|undersøger det og vender tilbage/i.test(block));
  assert(/missing_required_fields/.test(block)); // arbitration hook til kunde-hul
  assert(/feedback/i.test(block)); // precedence for feedback-acknowledge (Kasper-fixet)
  assert(block.includes("FORBUDTE")); // explicit forbidden-phrases line
  assert(/SKAL indeholde/.test(block)); // required investigate-and-return sentence
  assert(/undersøger spørgsmålet/i.test(block));
});

Deno.test("directive works without a customerAsk", () => {
  const block = buildOwnsTheCaseBlock({ customerAsk: null, intent: "other" });
  assert(block.length > 50);
  assert(!block.includes("null"));
});

Deno.test("a strong ticket example grounds an otherwise ungrounded case", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 0, verifiedFactsCount: 0,
    structuredFactsCount: 0, strongTicketExampleCount: 1,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("strong example overrides matcher abstention", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 3, matcherAbstained: true,
    verifiedFactsCount: 0, structuredFactsCount: 0, strongTicketExampleCount: 2,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("zero strong examples leaves ungrounded behavior unchanged", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 0, verifiedFactsCount: 0,
    structuredFactsCount: 0, strongTicketExampleCount: 0,
  });
  assertEquals(r.ungrounded, true);
  assertEquals(r.reason, "no_chunks_no_facts");
});

Deno.test("undefined strongTicketExampleCount = today's behavior (fail-safe)", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 0, verifiedFactsCount: 0,
    structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, true);
});
