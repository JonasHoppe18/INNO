// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { classifyInboundRouting } from "./email-routing-classifier.ts";

const CATEGORIES = [
  { key: "partnership", label: "Partnership" },
  { key: "invoice", label: "Invoice" },
];

// A real-world shaped Shopify contact-form relay where the customer picked
// "Partnership" in the form dropdown but the actual message is a plain order
// question. Routing must classify on the customer's own words (Body:), not on
// the form scaffolding — the dropdown value routinely poisons routing.
const NOAH_FORM = `You received a new message from your online store's contact form.

Country Code:
DK

Name:
Noah

Email:
noah@example.com

Company / Team:

Your Country:
Denmark

If Applicable, Place Of Purchase And Order Number:
4814

What Is Your Request Regarding?:
Partnership

What Do You Need Help With?:
Other

Body:
Har lige bestilt jeres a-spire wireless, men tror ikke jeg fik det bestilt gennem linket. Kan jeg stadig godt få mussemåtten med i min ordre?`;

Deno.test("contact-form relay classifies on the Body content, not the form dropdown", async () => {
  const result = await classifyInboundRouting(
    { subject: "New customer message on 10 July 2026 at 17.17", body: NOAH_FORM },
    { activeCategories: CATEGORIES },
  );
  // The classification excerpt must be the customer's message, with the
  // poisonous dropdown value stripped away.
  assert(result.excerpt.toLowerCase().includes("mussemåtten"), `excerpt was: ${result.excerpt}`);
  assert(!result.excerpt.toLowerCase().includes("partnership"), `excerpt leaked the dropdown: ${result.excerpt}`);
  // Without the dropdown poisoning the text, the heuristic must not route
  // this away from support (offline the LLM is unavailable, so any
  // non-support outcome would have to come from the heuristic).
  assertEquals(result.category, "support");
});

Deno.test("a genuine partnership pitch in the Body keeps its partnership signal", async () => {
  const body = NOAH_FORM.replace(
    /Body:[\s\S]+$/,
    "Body:\nHi! We are a Danish esports retailer and would like to discuss a reseller partnership and wholesale pricing with AceZone.",
  );
  const result = await classifyInboundRouting(
    { subject: "New customer message", body },
    { activeCategories: CATEGORIES },
  );
  // Extraction must NOT lose real partnership signal that lives in the
  // customer's own words.
  assert(result.excerpt.toLowerCase().includes("partnership"), `excerpt was: ${result.excerpt}`);
});

Deno.test("non-form emails are classified on their full cleaned body as before", async () => {
  const result = await classifyInboundRouting(
    { subject: "Broken headset", body: "Hi, my headset broke after two months. What do I do?" },
    { activeCategories: CATEGORIES },
  );
  assert(result.excerpt.includes("headset broke"));
  assertEquals(result.category, "support");
});
