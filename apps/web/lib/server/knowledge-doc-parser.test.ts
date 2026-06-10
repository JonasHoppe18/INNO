// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  knowledgeHeadingSlug,
  parseKnowledgeDocumentSections,
} from "./knowledge-doc-parser.ts";

Deno.test("H2 headings create ordered sections and H1 is ignored", () => {
  const sections = parseKnowledgeDocumentSections(`# Returns

Intro text is not a section.

## Return window
14 days.

## Refund processing
Original payment method.`);

  assertEquals(sections.length, 2);
  assertEquals(sections.map((s) => s.heading), ["Return window", "Refund processing"]);
  assertEquals(sections.map((s) => s.order), [0, 1]);
  assertEquals(sections[0].content, "14 days.");
});

Deno.test("content is assigned until the next H2 and short sections are retained", () => {
  const sections = parseKnowledgeDocumentSections(`## A
x
### Detail
y

## B
z`);

  assertEquals(sections.length, 2);
  assertEquals(sections[0].content, "x\n### Detail\ny");
  assertEquals(sections[1].content, "z");
});

Deno.test("empty H2 sections are returned with validation warning", () => {
  const sections = parseKnowledgeDocumentSections(`## Return shipping

## Refund processing
Done.`);

  assertEquals(sections[0].heading, "Return shipping");
  assertEquals(sections[0].content, "");
  assertEquals(sections[0].warnings, ["empty_section"]);
});

Deno.test("unknown headings are accepted with stable slug normalization", () => {
  const sections = parseKnowledgeDocumentSections(`## Special cases!
Keep this.`);

  assertEquals(knowledgeHeadingSlug("Special cases!"), "special_cases");
  assertEquals(sections[0].section_key, "special_cases");
  assertEquals(sections[0].metadata, {});
});

Deno.test("known return policy headings map to stable section keys", () => {
  const sections = parseKnowledgeDocumentSections(`## Opened or tested products
Assessed individually.

## Third-party purchases
Use reseller path.

## Internal guidance
Do not promise dates.`);

  assertEquals(sections.map((s) => s.section_key), [
    "opened_or_tested_products",
    "third_party_purchases",
    "internal_guidance",
  ]);
  assertEquals(sections[2].metadata, { audience: "internal" });
});

Deno.test("return address headings add explicit address metadata", () => {
  const sections = parseKnowledgeDocumentSections(`## Default return address
Address

## US return address
Address

## EU return address
Address

## UK return address
Address`);

  assertEquals(sections.map((s) => s.section_key), [
    "return_address",
    "return_address",
    "return_address",
    "return_address",
  ]);
  assertEquals(sections.map((s) => s.metadata.region_scope), ["default", "US", "EU", "UK"]);
  assertEquals(sections.map((s) => s.metadata.address_type), [
    "ordinary_return",
    "ordinary_return",
    "ordinary_return",
    "ordinary_return",
  ]);
});

Deno.test("A-Rise repair address metadata is heading-driven", () => {
  const sections = parseKnowledgeDocumentSections(`## A-Rise repair address
Repair location.`);

  assertEquals(sections[0].section_key, "repair_address");
  assertEquals(sections[0].metadata, {
    address_type: "warranty_repair",
    product_scope: "a-rise",
  });
});

Deno.test("body text does not infer address semantics or shop-specific metadata", () => {
  const sections = parseKnowledgeDocumentSections(`## Special cases
Example Shop ApS
Testvej 12
1000 Copenhagen
Denmark`);

  assertEquals(sections[0].section_key, "special_cases");
  assertEquals(sections[0].metadata, {});
});
