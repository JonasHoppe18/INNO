import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildFallbackQueries } from "./retriever.ts";
import type { Plan } from "./planner.ts";

function plan(intent: string, resolution_stage?: string): Plan {
  return {
    primary_intent: intent,
    resolution_stage: resolution_stage ?? "info_only",
  } as unknown as Plan;
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
const accessoryReplacementProbe = (qs: FallbackQuery[]) =>
  qs.find((q) =>
    q.text.includes("missing accessories") &&
    q.text.includes("spare parts") &&
    q.text.includes("replacement")
  );

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

Deno.test("complaint + initiate_warranty_repair emits a return probe even without return terms", () => {
  const qs = buildFallbackQueries(
    plan("complaint", "initiate_warranty_repair"),
    "I tried all troubleshooting steps and the headset still does not work",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  assert(hasReturnProbe(qs), `expected return probe in ${JSON.stringify(qs)}`);
  assertEquals(returnProbe(qs)?.productAgnostic, true);
});

Deno.test("complaint without initiate_warranty_repair and no return terms emits no return probe", () => {
  const qs = buildFallbackQueries(
    plan("complaint", "troubleshoot_first"),
    "My headset won't pair over bluetooth",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  assertEquals(hasReturnProbe(qs), false);
});

Deno.test("accessory replacement request emits product-agnostic General policy recall query", () => {
  const qs = buildFallbackQueries(
    plan("product_question"),
    "Kan jeg købe en ny dongle til mit A-Spire Wireless headset?",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  const probe = accessoryReplacementProbe(qs);
  assert(
    probe,
    `expected accessory replacement probe in ${JSON.stringify(qs)}`,
  );
  assertEquals(probe?.productAgnostic, true);
});

Deno.test("ordinary dongle troubleshooting emits no accessory replacement recall query", () => {
  const qs = buildFallbackQueries(
    plan("product_question"),
    "My headset is not connecting to the dongle.",
    { name: "AceZone", product_overview: "A-Spire Wireless" },
  );
  assertEquals(accessoryReplacementProbe(qs), undefined);
});

Deno.test("stock and compatibility questions emit no accessory replacement recall query", () => {
  for (
    const message of [
      "Is the A-Spire Wireless in stock?",
      "Can I use a USB-C adapter with the dongle?",
      "What are the product specs for A-Spire Wireless?",
    ]
  ) {
    const qs = buildFallbackQueries(
      plan("product_question"),
      message,
      { name: "AceZone", product_overview: "A-Spire Wireless" },
    );
    assertEquals(accessoryReplacementProbe(qs), undefined);
  }
});
