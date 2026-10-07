import { describe, it, expect } from "vitest";
import {
  compilePolicyRequirements,
  selectMaterialPolicyUnits,
} from "../../../../../../shared/knowledge-v2/policy-retrieval.mjs";
import { normalizeTurnIR } from "../../../greenfield-support/turn-ir";
import {
  preserveMaterialPolicyEvidence,
  validateStructuredResponse,
  renderResponseSegments,
} from "../../../greenfield-support/response-contract";
import { GREENFIELD_TOOL_DEFINITIONS } from "../../../greenfield-support/tool-contracts";
const unit = (id, domain, title, text, extra = {}) => ({
  id,
  domain_key: domain,
  payload: {
    title,
    text,
    semantic_type: "POLICY",
    applicability: { kind: "merchant", product_ids: [] },
    ...extra,
  },
});
const corpus = [
  unit(
    "dk-time",
    "shipping",
    "Shipping policy / Denmark",
    "Delivery estimate: 1–2 business days.",
  ),
  unit(
    "dk-price",
    "shipping",
    "Shipping policy / Denmark",
    "Standard shipping: 49 DKK.",
  ),
  unit(
    "dk-free",
    "shipping",
    "Shipping policy / Denmark",
    "Free shipping from 599 DKK.",
  ),
  unit(
    "se-time",
    "shipping",
    "Shipping policy / Sweden",
    "Delivery estimate: 3–5 business days.",
  ),
  unit(
    "de-time",
    "shipping",
    "Shipping policy / Germany",
    "Delivery estimate: 3–5 business days.",
  ),
  unit(
    "scope",
    "shipping",
    "Shipping policy / Scope",
    "These are delivery estimates, not dispatch windows.",
  ),
  unit(
    "faq",
    "shipping",
    "FAQ / Delivery",
    "Denmark: delivery estimate 9 business days, shipping 999 DKK.",
  ),
  unit(
    "window",
    "returns",
    "Return policy / Returns",
    "The return window is 30 days.",
  ),
  unit(
    "condition",
    "returns",
    "Return policy / Returns",
    "Items must be unused and in sellable condition.",
  ),
  unit(
    "normal-payer",
    "returns",
    "Return policy / Returns",
    "The customer pays normal return shipping.",
  ),
  unit(
    "damage-payer",
    "damaged_item",
    "Return policy / Damage",
    "The merchant pays return shipping for damaged or incorrect items.",
  ),
  unit(
    "exception",
    "warranty",
    "Return policy / Assessment",
    "Complaints and warranty cases are separate from ordinary returns.",
  ),
  unit(
    "before",
    "orders",
    "Order policy / Before fulfillment",
    "Cancellation may be possible before fulfillment.",
  ),
  unit(
    "after",
    "orders",
    "Order policy / After fulfillment",
    "Do not promise cancellation after shipment.",
  ),
  unit(
    "intake",
    "damaged_item",
    "Damage / Intake",
    "Obtain the order number and photos of the damaged item.",
  ),
  unit("unrelated", "care", "Care / Cleaning", "Wash at 30 degrees."),
];
const requirements = (domain, facets, destinationCountryCode = null) =>
  compilePolicyRequirements([{ domain, facets, destinationCountryCode }]);
const select = (domain, facets, destination) =>
  selectMaterialPolicyUnits(corpus, requirements(domain, facets, destination));
const ids = (result) => result.units.map((u) => u.id);
describe("material policy facets", () => {
  it("compiles timing scope after language-neutral intent", () =>
    expect(requirements("shipping", ["timing"], "DK")[0].facets).toEqual([
      "timing",
      "timing_scope",
    ]));
  it("compiles all return eligibility conditions alongside the window", () =>
    expect(requirements("returns", ["window"])[0].facets).toEqual([
      "window",
      "condition",
      "exclusion",
      "exception",
    ]));
  it.each([
    "Kan jeg returnere den efter 20 dage?",
    "Can I return it after 20 days?",
  ])("accepts grounded multilingual policy intent: %s", (message) => {
    expect(
      normalizeTurnIR(
        {
          actions: [],
          policyIntents: [
            {
              domain: "returns",
              facets: ["window"],
              sourceText: message,
              destinationCountryCode: null,
              destinationText: null,
            },
          ],
        },
        message,
      ).policyIntents[0].domain,
    ).toBe("returns");
  });
  it("rejects an invented semantic request quote", () =>
    expect(() =>
      normalizeTurnIR(
        {
          actions: [],
          policyIntents: [
            {
              domain: "returns",
              facets: ["condition"],
              sourceText: "invented",
              destinationCountryCode: null,
              destinationText: null,
            },
          ],
        },
        "Hello",
      ),
    ).toThrow());
  it("rejects ungrounded explicit destination", () =>
    expect(() =>
      normalizeTurnIR(
        {
          actions: [],
          policyIntents: [
            {
              domain: "shipping",
              facets: ["timing"],
              sourceText: "When?",
              destinationCountryCode: "DK",
              destinationText: null,
            },
          ],
        },
        "When?",
      ),
    ).toThrow());
  it("uses verified destination without inventing a customer destination", () =>
    expect(
      compilePolicyRequirements(
        [{ domain: "shipping", facets: ["timing"] }],
        "DK",
      )[0].destination,
    ).toBe("DK"));
  it("preserves explicit destination over order destination", () =>
    expect(
      compilePolicyRequirements(
        [
          {
            domain: "shipping",
            facets: ["timing"],
            destinationCountryCode: "DE",
          },
        ],
        "DK",
      )[0].destination,
    ).toBe("DE"));
  it("Denmark timing and estimate limitation only", () =>
    expect(ids(select("shipping", ["timing"], "DK"))).toEqual([
      "dk-time",
      "scope",
    ]));
  it("Denmark price keeps the free threshold, excludes timing", () =>
    expect(ids(select("shipping", ["price"], "DK"))).toEqual([
      "dk-price",
      "dk-free",
    ]));
  it.each([
    ["SE", "se-time"],
    ["DE", "de-time"],
  ])("%s selects correct destination timing", (country, id) =>
    expect(ids(select("shipping", ["timing"], country))).toEqual([id, "scope"]),
  );
  it("unknown destination never borrows Denmark timing", () => {
    const result = select("shipping", ["timing"], "NO");
    expect(ids(result)).not.toContain("dk-time");
    expect(result.coverage[0].missing).toContain("timing");
  });
  it("missing destination does not guess a country", () =>
    expect(ids(select("shipping", ["timing"], null))).toEqual(["scope"]));
  it("returns retain window, condition and separate complaint route", () =>
    expect(ids(select("returns", ["window"]))).toEqual([
      "window",
      "condition",
      "exception",
    ]));
  it("normal return shipping responsibility comes from ordinary returns", () =>
    expect(ids(select("returns", ["responsibility"]))).toEqual([
      "normal-payer",
    ]));
  it("damage shipping responsibility comes from damage domain", () =>
    expect(ids(select("damaged_item", ["responsibility"]))).toEqual([
      "damage-payer",
    ]));
  it("cancellation preserves both fulfillment boundaries", () =>
    expect(new Set(ids(select("orders", ["boundary"])))).toEqual(
      new Set(["before", "after"]),
    ));
  it("damage intake requirements retained", () =>
    expect(ids(select("damaged_item", ["intake"]))).toEqual(["intake"]));
  it("specific authoritative policy beats conflicting FAQ", () =>
    expect(ids(select("shipping", ["timing"], "DK"))).not.toContain("faq"));
  it("no unrelated policy flooding", () =>
    expect(ids(select("returns", ["condition"]))).not.toContain("unrelated"));
  it("product-specific exclusions override generic exclusions only for the bound product", () => {
    const restricted = [
      ...corpus,
      unit(
        "specific",
        "returns",
        "Return policy / Product A",
        "Product A is non-returnable.",
        { applicability: { kind: "products", product_ids: ["123"] } },
      ),
      unit(
        "generic",
        "returns",
        "FAQ / Exclusion",
        "Some products are non-returnable.",
      ),
    ];
    expect(
      ids(
        selectMaterialPolicyUnits(
          restricted,
          requirements("returns", ["window"]),
          ["123"],
        ),
      ),
    ).toContain("specific");
    expect(
      ids(
        selectMaterialPolicyUnits(
          restricted,
          requirements("returns", ["window"]),
          ["456"],
        ),
      ),
    ).not.toContain("specific");
  });
  it("unbound product records cannot enter generic merchant answers", () =>
    expect(
      ids(
        selectMaterialPolicyUnits(
          [
            unit("p", "returns", "P", "Items must be unused.", {
              applicability: { kind: "products", product_ids: ["123"] },
            }),
          ],
          requirements("returns", ["condition"]),
        ),
      ),
    ).toEqual([]));
  it("deduplicates identical evidence", () =>
    expect(
      ids(
        selectMaterialPolicyUnits(
          [
            ...corpus,
            unit(
              "copy",
              "returns",
              "FAQ",
              "Items must be unused and in sellable condition.",
            ),
          ],
          requirements("returns", ["condition"]),
        ),
      ).filter((id) => ["copy", "condition"].includes(id)),
    ).toEqual(["condition"]));
  it("missing policy produces no invented values", () => {
    const result = selectMaterialPolicyUnits(
      [],
      requirements("shipping", ["timing"], "DK"),
    );
    expect(result.units).toEqual([]);
    expect(result.coverage[0].missing).toContain("timing");
  });
  it("reports material truncation rather than claiming coverage", () =>
    expect(
      selectMaterialPolicyUnits(
        corpus,
        requirements("shipping", ["price"], "DK"),
        [],
        1,
      ).coverage[0].omitted,
    ).toContain("threshold"));
});
function contractContext(
  text = "Items must be unused and in sellable condition.",
) {
  const record = {
    resultId: "policy",
    toolName: "search_policy",
    result: {
      status: "ok",
      data: {
        results: [
          {
            knowledge_type: "policy",
            authority: "authoritative",
            title: "Returns",
            structured_data: {
              policy_coverage: [{ domain: "returns", facets: ["condition"] }],
            },
            evidence_sections: [{ content: text }],
          },
        ],
      },
    },
  };
  return {
    definitions: GREENFIELD_TOOL_DEFINITIONS,
    manifest: {
      readTools: ["search_policy", "get_tracking"],
      proposalOnlyTools: [],
      configured: { knowledge: true, commerce: true, tracking: true },
    },
    getResults: () => [record],
    getResult: (id) => (id === "policy" ? record : null),
    customerMessage: "Can I return a used item?",
    turnIR: { actions: [] },
  };
}
describe("material evidence survives the existing response contract", () => {
  it("restores an omitted supported return condition", () => {
    const context = contractContext();
    const v = preserveMaterialPolicyEvidence(
      validateStructuredResponse({ segments: [] }, context),
      context,
    );
    expect(v.approvedSegments).toHaveLength(1);
    expect(v.rejectedSegments).toEqual([]);
    expect(renderResponseSegments(v.approvedSegments, context)).toMatch(
      /unused.*sellable/i,
    );
  });
  it("does not duplicate an already present condition", () => {
    const context = contractContext();
    const output = {
      segments: [
        {
          type: "knowledge_guidance",
          text: "Items must be unused and in sellable condition.",
          basis: {
            result_id: "policy",
            field_paths: ["results.0.evidence_sections.0.content"],
          },
        },
      ],
    };
    expect(
      preserveMaterialPolicyEvidence(
        validateStructuredResponse(output, context),
        context,
      ).approvedSegments,
    ).toHaveLength(1);
  });
  it("unsupported refund policy stays blocked", () => {
    const context = contractContext();
    const result = validateStructuredResponse(
      {
        segments: [
          {
            type: "knowledge_guidance",
            text: "You receive a guaranteed full refund after 90 days.",
            basis: {
              result_id: "policy",
              field_paths: ["results.0.evidence_sections.0.content"],
            },
          },
        ],
      },
      context,
    );
    expect(result.approvedSegments).toEqual([]);
  });
  it("policy timing cannot be bound as a carrier ETA", () => {
    const context = contractContext("Delivery estimate: 1–2 business days.");
    const result = validateStructuredResponse(
      {
        segments: [
          {
            type: "fact",
            fact_kind: "shipment_eta",
            evidence: [
              {
                result_id: "policy",
                field_paths: ["results.0.evidence_sections.0.content"],
              },
            ],
          },
        ],
      },
      context,
    );
    expect(result.approvedSegments).toEqual([]);
  });
});
import { randomUUID } from "node:crypto";
import { compileSupportUnit } from "../../../../../../shared/knowledge-v2/merchant-support.mjs";
import { loadPlatformFromRepo } from "../../../../../../shared/knowledge-v2/platform-node.mjs";
import { searchMerchantDocumentRelease } from "../merchant-document-retrieval";
function readDB(tables) {
  return {
    from(table) {
      const filters = [];
      let sorted, cap;
      const builder = {
        select() {
          return builder;
        },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return builder;
        },
        is(key, value) {
          filters.push((row) => row[key] === value);
          return builder;
        },
        not(key, op, value) {
          filters.push((row) => row[key] !== value);
          return builder;
        },
        lte(key, value) {
          filters.push((row) => row[key] <= value);
          return builder;
        },
        order(key) {
          sorted = key;
          return builder;
        },
        limit(value) {
          cap = value;
          return builder;
        },
        maybeSingle() {
          return execute(true);
        },
        then(a, b) {
          return execute(false).then(a, b);
        },
      };
      async function execute(single) {
        let rows = (tables[table] ?? []).filter((row) =>
          filters.every((f) => f(row)),
        );
        if (sorted) rows.sort((a, b) => b[sorted] - a[sorted]);
        if (cap) rows = rows.slice(0, cap);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      return builder;
    },
  };
}
async function releaseDB() {
  const pinned = await loadPlatformFromRepo("sona-0.6.0");
  const release = {
    workspace_id: "tenant-a",
    shop_id: "shop-a",
    seq: 1,
    activated_at: "2026-01-01",
    platform_version: "sona-0.6.0",
    platform_hash: pinned.hash,
  };
  const source = randomUUID();
  const make = (text, fields = {}) => ({
    id: randomUUID(),
    workspace_id: "tenant-a",
    shop_id: "shop-a",
    from_seq: 1,
    to_seq: null,
    content_hash: "hash",
    ...compileSupportUnit({
      type: "POLICY",
      domain: "returns",
      text,
      title: "Return policy / Returns",
      sourceId: source,
      sourceContent: text,
      sourceStart: 0,
      policyId: randomUUID(),
    }),
    ...fields,
  });
  const tables = {
    shops: [{ id: "shop-a", workspace_id: "tenant-a", uninstalled_at: null }],
    kn2_releases: [release],
    kn2_unit_versions: [
      make("Items must be unused and in sellable condition."),
      make("The return window is 30 days."),
      make("AceZone return window is 999 days.", { workspace_id: "tenant-b" }),
      make("Another shop return window is 888 days.", { shop_id: "shop-b" }),
      make("Future return window is 777 days.", { from_seq: 2 }),
      make("Expired return window is 666 days.", { to_seq: 1 }),
    ],
  };
  return {
    tables,
    db: readDB(tables),
    request: {
      workspaceId: "tenant-a",
      trustedShopId: "shop-a",
      knowledgeTypes: ["policy"],
      query: "Can I return after 20 days?",
      policyRequirements: requirements("returns", ["window"]),
    },
  };
}
describe("tenant, shop and active-release scope", () => {
  it("selects only active members from the bound workspace and shop", async () => {
    const { db, request } = await releaseDB();
    const result = await searchMerchantDocumentRelease({
      supabase: db,
      request,
    });
    expect(result.hits).toHaveLength(2);
    expect(result.hits.map((h) => h.record.content).join(" ")).not.toMatch(
      /AceZone|888|777|666/,
    );
    expect(result.hits.every((h) => h.record.metadata.release_seq === 1)).toBe(
      true,
    );
  });
  it("wrong tenant cannot reuse the merchant shop", async () => {
    const { db, request } = await releaseDB();
    expect(
      (
        await searchMerchantDocumentRelease({
          supabase: db,
          request: { ...request, workspaceId: "tenant-b" },
        })
      ).hits,
    ).toEqual([]);
  });
  it("wrong shop cannot reuse the merchant release", async () => {
    const { db, request } = await releaseDB();
    expect(
      (
        await searchMerchantDocumentRelease({
          supabase: db,
          request: { ...request, trustedShopId: "shop-b" },
        })
      ).hits,
    ).toEqual([]);
  });
  it("requires an explicit shop binding", async () => {
    const { db, request } = await releaseDB();
    expect(
      (
        await searchMerchantDocumentRelease({
          supabase: db,
          request: { ...request, trustedShopId: null },
        })
      ).hits,
    ).toEqual([]);
  });
  it("invalid platform pin fails closed", async () => {
    const { db, tables, request } = await releaseDB();
    tables.kn2_releases[0].platform_hash = "sha256:bad";
    await expect(
      searchMerchantDocumentRelease({ supabase: db, request }),
    ).rejects.toThrow("pin mismatch");
  });
  it("unknown field paths cannot authorize a policy claim", () => {
    const ctx = contractContext();
    expect(
      validateStructuredResponse(
        {
          segments: [
            {
              type: "knowledge_guidance",
              text: "Returns allowed for 90 days.",
              basis: { result_id: "policy", field_paths: ["results.99"] },
            },
          ],
        },
        ctx,
      ).approvedSegments,
    ).toEqual([]);
  });
  it("failed retrieval cannot support policy text", () => {
    const ctx = contractContext();
    ctx.getResults()[0].result.status = "error";
    expect(
      preserveMaterialPolicyEvidence(
        validateStructuredResponse({ segments: [] }, ctx),
        ctx,
      ).approvedSegments,
    ).toEqual([]);
  });
});
import {
  ScriptedModel,
  assistantMessage,
  modelResponse,
} from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../../../greenfield-support/agents-sdk";
import { createDemoDependencies } from "../../../greenfield-support/demo-fixtures";
import { InMemoryCommerceProvider } from "../../../greenfield-support/providers";
describe("normal runtime policy boundary", () => {
  it("model-skips-tool still retrieves conditions and preserves a bounded refund decision", async () => {
    const { db } = await releaseDB();
    const dependencies = await createDemoDependencies();
    const tenant = {
      workspaceId: "tenant-a",
      shopId: "shop-a",
      customerEmail: "customer@example.test",
    };
    const message = "I used this item. Can I return it for a refund?";
    const result = await runGreenfieldAgentWithAgentsSdk({
      tenant,
      message,
      model: new ScriptedModel([]),
      turnInterpreter: async () => ({
        actions: [
          {
            action: "create_refund",
            sourceText: message,
            orderReference: null,
            addressProvided: false,
          },
        ],
        policyIntents: [
          {
            domain: "returns",
            facets: ["condition"],
            sourceText: message,
            destinationCountryCode: null,
            destinationText: null,
          },
        ],
      }),
      capabilities: {
        ...dependencies,
        tenant,
        knowledge: {
          search: async (request) =>
            (await searchMerchantDocumentRelease({ supabase: db, request }))
              .hits,
        },
      },
      interactionChannel: "playground",
      enableDevDiagnostics: true,
    });
    expect(result.response).toMatch(/unused.*sellable/);
    expect(result.proposedActions).toEqual([]);
    expect(result.actionExecutions).toEqual([]);
    expect(result.trace.events.some((e) => e.type === "model_response")).toBe(
      false,
    );
    expect(result.trace.diagnostics.fallback_reason).toBe(null);
  });
  it("order destination is verified before policy evidence selection", async () => {
    const dependencies = await createDemoDependencies();
    const tenant = {
      ...dependencies.tenant,
      customerEmail: "customer@example.test",
    };
    const order = {
      id: "order-123",
      orderNumber: "123",
      status: "paid",
      fulfillmentStatus: null,
      shippingAddress: { countryCode: "DK" },
      items: [],
      fulfillments: [],
    };
    const requests = [];
    const message = "When should order #123 arrive?";
    await runGreenfieldAgentWithAgentsSdk({
      tenant,
      message,
      model: new ScriptedModel([
        modelResponse([assistantMessage(JSON.stringify({ segments: [] }))]),
      ]),
      turnInterpreter: async () => ({
        actions: [],
        orderContext: "status",
        policyIntents: [
          {
            domain: "shipping",
            facets: ["timing"],
            sourceText: message,
            destinationCountryCode: null,
            destinationText: null,
          },
        ],
      }),
      capabilities: {
        ...dependencies,
        tenant,
        commerce: new InMemoryCommerceProvider({ orders: [order] }),
        knowledge: {
          search: async (request) => {
            requests.push(request);
            return [];
          },
        },
      },
      interactionChannel: "playground",
    });
    expect(requests[0].policyRequirements[0]).toMatchObject({
      domain: "shipping",
      destination: "DK",
      facets: ["timing", "timing_scope"],
    });
  });
  it("missing policy yields bounded uncertainty rather than invented timing", async () => {
    const dependencies = await createDemoDependencies();
    const message = "When does delivery arrive in Norway?";
    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message,
      model: new ScriptedModel([
        modelResponse([assistantMessage(JSON.stringify({ segments: [] }))]),
      ]),
      turnInterpreter: async () => ({
        actions: [],
        policyIntents: [
          {
            domain: "shipping",
            facets: ["timing"],
            sourceText: message,
            destinationCountryCode: "NO",
            destinationText: "Norway",
          },
        ],
      }),
      capabilities: { ...dependencies, knowledge: { search: async () => [] } },
      interactionChannel: "playground",
    });
    expect(result.response).not.toMatch(/1–2|3–5|guaranteed/);
    expect(result.response).not.toContain("couldn’t safely complete");
    expect(result.proposedActions).toEqual([]);
  });
  it("live transit and policy estimate retain distinct evidence sources", () => {
    const ctx = contractContext("Delivery estimate: 1–2 business days.");
    ctx.customerMessage = "When should my order arrive?";
    const tracking = {
      resultId: "tracking",
      toolName: "get_tracking",
      result: {
        status: "ok",
        data: {
          live_tracking: { status: "in_transit", estimatedDelivery: null },
        },
      },
    };
    const policy = ctx.getResults()[0];
    ctx.getResults = () => [policy, tracking];
    ctx.getResult = (id) =>
      id === "policy" ? policy : id === "tracking" ? tracking : null;
    const result = preserveMaterialPolicyEvidence(
      validateStructuredResponse(
        {
          segments: [
            {
              type: "fact",
              fact_kind: "shipment_status",
              evidence: [
                {
                  result_id: "tracking",
                  field_paths: ["live_tracking.status"],
                },
              ],
            },
          ],
        },
        ctx,
      ),
      ctx,
    );
    expect(result.approvedSegments.map((s) => s.type)).toEqual([
      "fact",
      "knowledge_guidance",
    ]);
    expect(
      result.approvedSegments.find((s) => s.type === "fact").fact_kind,
    ).not.toBe("shipment_eta");
    expect(renderResponseSegments(result.approvedSegments, ctx)).toMatch(
      /on the way/i,
    );
    expect(renderResponseSegments(result.approvedSegments, ctx)).toContain(
      "1–2",
    );
  });
  it("long units do not flood the evidence budget", () => {
    const result = selectMaterialPolicyUnits(
      [
        unit(
          "long",
          "returns",
          "Return policy",
          "Items must be unused and sellable. " + "x".repeat(5000),
        ),
      ],
      requirements("returns", ["condition"]),
    );
    expect(result.units).toEqual([]);
    expect(result.coverage[0].omitted).toContain("condition");
  });
  it("country applicability is generic beyond the fixture destinations", () => {
    const result = selectMaterialPolicyUnits(
      [
        unit(
          "no",
          "shipping",
          "Shipping policy / Norway",
          "Delivery estimate: 6 business days.",
        ),
      ],
      requirements("shipping", ["timing"], "NO"),
    );
    expect(ids(result)).toEqual(["no"]);
  });
});

it("unsupported merchant attribution cannot override the selected source", () => {
  const ctx = contractContext();
  const result = validateStructuredResponse(
    {
      segments: [
        {
          type: "knowledge_guidance",
          text: "Under InventedBrand’s standard returns policy, items must be unused.",
          basis: {
            result_id: "policy",
            field_paths: ["results.0.evidence_sections.0.content"],
          },
        },
      ],
    },
    ctx,
  );
  expect(result.approvedSegments).toEqual([]);
  expect(result.rejectedSegments[0].issues[0].code).toBe(
    "unsupported_policy_attribution",
  );
});
it("multi-domain evidence is scoped to all materially requested facets", () => {
  const requested = [
    ...requirements("shipping", ["timing", "price"], "DK"),
    ...requirements("returns", ["window", "responsibility"]),
  ];
  const result = selectMaterialPolicyUnits(corpus, requested, [], 20);
  expect(new Set(ids(result))).toEqual(
    new Set([
      "dk-time",
      "scope",
      "dk-price",
      "dk-free",
      "window",
      "condition",
      "exception",
      "normal-payer",
    ]),
  );
  expect(result.coverage.every((c) => c.omitted.length === 0)).toBe(true);
});

it("a clipped sibling condition is recorded as missing material coverage", () => {
  const units = [
    unit("a", "returns", "Returns", "Items must be unused."),
    unit("b", "returns", "Returns", "Items must be in sellable condition."),
  ];
  const result = selectMaterialPolicyUnits(
    units,
    requirements("returns", ["condition"]),
    [],
    1,
  );
  expect(result.coverage[0].omitted).toContain("condition");
});
it("partial material evidence receives bounded uncertainty", () => {
  const ctx = contractContext();
  ctx.getResults()[0].result.data.results[0].structured_data.policy_coverage[0].omitted =
    ["condition"];
  const result = preserveMaterialPolicyEvidence(
    validateStructuredResponse({ segments: [] }, ctx),
    ctx,
  );
  expect(result.approvedSegments.some((s) => s.type === "limitation")).toBe(
    true,
  );
  expect(result.rejectedSegments).toEqual([]);
});

it("a destinations question retrieves the approved list without assuming a country", () => {
  const result = selectMaterialPolicyUnits(
    [
      unit(
        "destinations",
        "shipping",
        "Shipping policy / Scope",
        "Documented destinations: Denmark, Sweden and Germany.",
      ),
    ],
    requirements("shipping", ["destinations"]),
  );
  expect(ids(result)).toEqual(["destinations"]);
});

it("retrieved intake procedures keep their existing step contract", () => {
  const ctx = contractContext("Obtain an order number and supporting photos.");
  ctx.getResults()[0].result.data.results[0].knowledge_type = "procedural";
  const result = preserveMaterialPolicyEvidence(validateStructuredResponse({segments:[]}, ctx), ctx);
  expect(result.approvedSegments).toEqual([]);
  expect(result.rejectedSegments).toEqual([]);
});
