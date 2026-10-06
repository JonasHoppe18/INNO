import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileSupportUnit,
  extractSupportDocument,
} from "../merchant-support.mjs";
import { validateUnit } from "../units.mjs";
import { extractReferences } from "../references.mjs";
import { loadPlatformFromRepo } from "../platform-node.mjs";
const { platform } = await loadPlatformFromRepo("sona-0.6.0");
const sourceId = "11111111-1111-4111-8111-111111111111";
const cases = [
  ["shipping", "POLICY", "Standard shipping costs 49 DKK."],
  [
    "delivery",
    "FACT",
    "The documented delivery estimate is 1–2 business days.",
  ],
  [
    "returns",
    "POLICY",
    "Returns are accepted within 30 days for unused items in sellable condition.",
  ],
  ["orders", "POLICY", "Cancellation may be possible before fulfillment."],
  ["damaged_item", "GUIDANCE", "Provide relevant photos for assessment."],
  ["warranty", "GUIDANCE", "Describe the defect for assessment."],
  ["product", "FACT", "The product is made of aluminium."],
  [
    "compatibility",
    "FACT",
    "Compatible with most laptops from 11 to 16 inches.",
  ],
  ["care", "GUIDANCE", "Clean with a damp cloth; avoid abrasive cleaners."],
  [
    "assembly",
    "PROCEDURE",
    "1. Attach the legs using supplied fittings.\n2. Tighten the supplied fittings.",
  ],
  [
    "troubleshooting",
    "PROCEDURE",
    "1. Check the cable connection.\n2. Test the device.",
  ],
];
export const controlUnit = () =>
  compileSupportUnit({
    type: "POLICY",
    domain: "shipping",
    text: "Shipping costs 49 DKK.",
    title: "Shipping policy",
    sourceId,
    sourceContent: "Shipping costs 49 DKK.",
    sourceStart: 0,
  });
for (const [domain, type, text] of cases)
  test(`canonical ${domain} ${type} validates`, () => {
    const unit = compileSupportUnit({
      type,
      domain,
      text,
      title: domain,
      sourceId,
      sourceContent: text,
      sourceStart: 0,
    });
    assert.deepEqual(validateUnit(platform, unit), []);
    assert.deepEqual(
      extractReferences(platform, unit.kind, unit.payload).errors,
      [],
    );
  });
const negatives = [
  [
    "non-array steps",
    (u) => {
      u.kind = "procedure";
      u.payload.semantic_type = "PROCEDURE";
      delete u.payload.policy;
      u.payload.steps = {};
    },
  ],
  [
    "null product binding",
    (u) => {
      u.payload.product_bindings = [null];
    },
  ],
  [
    "impossible policy fields",
    (u) => {
      u.payload.policy.refund_amount = -999;
    },
  ],
  [
    "missing contract marker",
    (u) => {
      delete u.payload.contract;
    },
  ],
  [
    "random type",
    (u) => {
      u.payload.semantic_type = "GARBAGE";
    },
  ],
  [
    "empty domain",
    (u) => {
      u.domain_key = "";
    },
  ],
  [
    "random domain",
    (u) => {
      u.domain_key = "banana_space";
    },
  ],
  [
    "malformed applicability",
    (u) => {
      u.payload.applicability = { kind: "products", product_ids: [] };
    },
  ],
  [
    "invalid source",
    (u) => {
      u.payload.provenance[0].source_id = "garbage";
    },
  ],
  [
    "missing policy",
    (u) => {
      delete u.payload.policy;
    },
  ],
  [
    "policy substitution",
    (u) => {
      u.payload.policy.text = "Refund guaranteed now.";
    },
  ],
  [
    "procedure without steps",
    (u) => {
      u.kind = "procedure";
      u.payload.semantic_type = "PROCEDURE";
      delete u.payload.policy;
    },
  ],
  [
    "unordered procedure",
    (u) => {
      u.kind = "procedure";
      u.payload.semantic_type = "PROCEDURE";
      delete u.payload.policy;
      u.payload.steps = [{ order: 1, text: "Shipping costs 49 DKK." }];
    },
  ],
  [
    "source offsets",
    (u) => {
      u.payload.source_location.end = 0;
    },
  ],
  [
    "scope substitution",
    (u) => {
      u.scope = { kind: "products", product_ids: ["123"] };
    },
  ],
  [
    "undeclared source reference",
    (u) => {
      u.payload.other_reference = sourceId;
    },
  ],
];
for (const [name, mutate] of negatives)
  test(`reject ${name}`, () => {
    const u = controlUnit();
    mutate(u);
    assert.ok(
      [
        ...validateUnit(platform, u),
        ...extractReferences(platform, u.kind, u.payload).errors,
      ].length > 0,
    );
  });
test("multi-product source never applies an ambiguous care paragraph to both products", () => {
  const content =
    "## First product\nMachine wash at 30°C.\n## Second product\nDo not machine wash.\n## General care\nDry cleaning recommended.";
  const r = extractSupportDocument({
    title: "Textiles",
    content,
    productIds: ["123", "456"],
    catalog: [
      { id: "123", title: "First product" },
      { id: "456", title: "Second product" },
    ],
    sourceId,
  });
  assert.equal(r.units.length, 2);
  assert.deepEqual(
    r.units.map((u) => u.scope.product_ids),
    [["123"], ["456"]],
  );
  assert.equal(r.unresolved.length, 1);
  for (const u of r.units)
    assert.equal(
      content.slice(
        u.payload.source_location.start,
        u.payload.source_location.end,
      ),
      u.payload.text,
    );
});
test("unknown requested extraction domain is rejected", () => {
  assert.equal(
    extractSupportDocument({
      title: "x",
      content: "Fact.",
      sourceId,
      defaultDomain: "garbage",
    }).units.length,
    0,
  );
});

test("source conflicts require review instead of publishing inconsistent values", async () => {
  const { prepareSeal } = await import("../seal.mjs");
  const pinned = await loadPlatformFromRepo("sona-0.6.0");
  const one = controlUnit(),
    two = compileSupportUnit({
      type: "POLICY",
      domain: "shipping",
      text: "Shipping costs 79 DKK.",
      title: "Shipping policy",
      sourceId,
      sourceContent: "Shipping costs 79 DKK.",
      sourceStart: 0,
    });
  const seal = await prepareSeal({
    platform: pinned,
    add: [one, two],
    kind: "publish",
  });
  assert.equal(seal.ok, false);
  assert.ok(seal.errors.some((e) => e.code === "conflict.source_values"));
});
