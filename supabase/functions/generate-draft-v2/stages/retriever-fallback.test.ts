import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildFallbackQueries } from "./retriever.ts";
import type { Plan } from "./planner.ts";

function plan(intent: string): Plan {
  return { primary_intent: intent } as unknown as Plan;
}

import type { FallbackQuery } from "./retriever.ts";

const hasReturnProbe = (qs: FallbackQuery[]) =>
  qs.some((q) => q.text.includes("return") && q.text.includes("refund"));
const hasTechProbe = (qs: FallbackQuery[], product: string) =>
  qs.some((q) => q.text.includes(product) && !q.text.includes("return"));
const returnProbe = (qs: FallbackQuery[]) =>
  qs.find((q) => q.text.includes("return") && q.text.includes("refund"));
const techProbe = (qs: FallbackQuery[], product: string) =>
  qs.find((q) => q.text.includes(product) && !q.text.includes("return"));

Deno.test("return-because-broken surfaces BOTH return and technical probes", () => {
  const qs = buildFallbackQueries(
    plan("complaint"),
    "I want to return my A-Spire Wireless because it won't connect",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  assert(hasReturnProbe(qs), `expected return probe in ${JSON.stringify(qs)}`);
  assert(
    hasTechProbe(qs, "a-spire wireless"),
    `expected technical probe in ${JSON.stringify(qs)}`,
  );
  // Return probe runs product-agnostic; technical probe keeps strict product
  // filtering so A-Spire and A-Spire Wireless are never blended.
  assertEquals(returnProbe(qs)?.productAgnostic, true);
  assertEquals(techProbe(qs, "a-spire wireless")?.productAgnostic, false);
});

Deno.test("bare return request (no product, no fault) still surfaces a return probe", () => {
  const qs = buildFallbackQueries(
    plan("return"),
    "I would like to return my headphones, they don't meet my expectations.",
    { name: "AceZone" },
  );
  assert(hasReturnProbe(qs), `expected return probe in ${JSON.stringify(qs)}`);
});

Deno.test("no hardcoded 'warranty troubleshooting' bias is emitted", () => {
  const qs = buildFallbackQueries(
    plan("refund"),
    "Refund please, my A-Spire Wireless audio is crackling",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  assert(
    qs.every((q) => !q.text.includes("warranty troubleshooting")),
    `unexpected bias phrase in ${JSON.stringify(qs)}`,
  );
});

Deno.test("pure technical complaint emits a technical probe but no return probe", () => {
  const qs = buildFallbackQueries(
    plan("complaint"),
    "My A-Spire Wireless won't pair over bluetooth",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  assert(
    hasTechProbe(qs, "a-spire wireless"),
    `expected technical probe in ${JSON.stringify(qs)}`,
  );
  assertEquals(hasReturnProbe(qs), false);
});

Deno.test("empty message yields no queries", () => {
  assertEquals(buildFallbackQueries(plan("return"), "", {}), []);
});
