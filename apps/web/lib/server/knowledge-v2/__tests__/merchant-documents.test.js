import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ingestMerchantDocument,
  approveMerchantDocument,
  publishMerchantDocuments,
  activateMerchantDocuments,
} from "../merchant-documents";
import { searchMerchantDocumentRelease } from "../merchant-document-retrieval";
const context = {
  workspaceId: "tenant-a",
  shopId: "shop-a",
  clerkUserId: "user-a",
  role: "admin",
  capability: "knowledge.draft.edit",
};
function memoryDB() {
  const tables = {
    shops: [{ id: "shop-a", workspace_id: "tenant-a", uninstalled_at: null }],
    kn2_sources: [],
    kn2_policies: [],
    kn2_review_items: [],
    knowledge_documents: [],
    kn2_releases: [],
    kn2_unit_versions: [],
  };
  const writes = [];
  const db = {
    tables,
    writes,
    from(table) {
      let filters = [],
        mode = null,
        payload,
        single = false,
        sorting,
        limit;
      const get = (r, key) =>
        key.includes("->")
          ? key.split(/->>?/).reduce((v, k) => v?.[k], r)
          : r[key];
      const builder = {
        select() {
          return builder;
        },
        eq(k, v) {
          filters.push((r) => get(r, k) === v);
          return builder;
        },
        is(k, v) {
          filters.push((r) => r[k] === v);
          return builder;
        },
        not(k, _op, v) {
          filters.push((r) => r[k] !== v);
          return builder;
        },
        lte(k, v) {
          filters.push((r) => r[k] <= v);
          return builder;
        },
        order(k, { ascending }) {
          sorting = { k, ascending };
          return builder;
        },
        limit(n) {
          limit = n;
          return builder;
        },
        insert(row) {
          mode = "insert";
          payload = row;
          return builder;
        },
        upsert(row) {
          mode = "upsert";
          payload = row;
          return builder;
        },
        update(row) {
          mode = "update";
          payload = row;
          return builder;
        },
        maybeSingle() {
          single = true;
          return execute();
        },
        single() {
          single = true;
          return execute();
        },
        then(a, b) {
          return execute().then(a, b);
        },
      };
      const execute = async () => {
        let rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (mode) {
          writes.push(table);
          if (mode === "update") {
            for (const r of rows) Object.assign(r, payload);
          } else {
            let row =
              mode === "upsert" && table === "kn2_sources"
                ? tables[table].find(
                    (r) =>
                      r.source_key === payload.source_key &&
                      r.content_hash === payload.content_hash,
                  )
                : null;
            if (!row) {
              row = {
                id: randomUUID(),
                revision: 0,
                uninstalled_at: null,
                ...payload,
              };
              tables[table].push(row);
            }
            rows = [row];
          }
          mode = null;
        }
        if (sorting)
          rows.sort(
            (a, b) =>
              (sorting.ascending ? 1 : -1) *
              ((a[sorting.k] ?? 0) - (b[sorting.k] ?? 0)),
          );
        if (limit) rows = rows.slice(0, limit);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      return builder;
    },
    async rpc(name, args) {
      if (name === "kn2_seal_release") {
        const p = args.p_request;
        const seq = tables.kn2_releases.length + 1;
        tables.kn2_releases.push({
          workspace_id: p.workspace_id,
          shop_id: p.shop_id,
          seq,
          platform_version: p.platform_version,
          platform_hash: p.platform_hash,
          activated_at: null,
        });
        for (const u of p.add)
          tables.kn2_unit_versions.push({
            id: randomUUID(),
            workspace_id: p.workspace_id,
            shop_id: p.shop_id,
            from_seq: seq,
            to_seq: null,
            ...u,
          });
        return { data: seq, error: null };
      }
      if (name === "kn2_activate_release") {
        const r = tables.kn2_releases.find((r) => r.seq === args.p_seq);
        r.activated_at = new Date().toISOString();
        return { data: r.activated_at, error: null };
      }
      throw Error(name);
    },
  };
  return db;
}
const capabilities = (capability) => ({ ...context, capability });
describe("merchant document authoring and release retrieval", () => {
  it("accepts an explicit canonical role and domain in the normal document service", async () => {
    const db = memoryDB();
    const doc = await ingestMerchantDocument({
      supabase: db,
      context,
      input: {
        title: "Delivery estimate",
        content: "## Delivery\nDelivery estimate: 1–2 business days.",
        domain: "delivery",
        semanticType: "FACT",
      },
      catalog: [],
    });
    expect(doc.draft.units[0]).toMatchObject({
      domain_key: "delivery",
      payload: { semantic_type: "FACT" },
    });
  });
  it("rejects unknown semantic roles before any source or document write", async () => {
    const db = memoryDB();
    await expect(
      ingestMerchantDocument({
        supabase: db,
        context,
        input: {
          title: "Bad role",
          content: "## Fact\nSource text.",
          semanticType: "GARBAGE",
        },
        catalog: [],
      }),
    ).rejects.toMatchObject({ code: "document_no_units" });
    expect(db.writes).toEqual([]);
  });

  it("requires review, seals a first release, activates and retrieves through scoped release membership", async () => {
    const db = memoryDB();
    const doc = await ingestMerchantDocument({
      supabase: db,
      context,
      input: {
        documentKey: "shipping",
        title: "Shipping",
        content:
          "## Denmark\nDelivery estimate: 1–2 business days. Standard shipping: 49 DKK.",
      },
      catalog: [],
    });
    expect(
      (
        await searchMerchantDocumentRelease({
          supabase: db,
          request: {
            workspaceId: "tenant-a",
            trustedShopId: "shop-a",
            query: "Denmark shipping",
          },
        })
      ).handled,
    ).toBe(false);
    await expect(
      publishMerchantDocuments({
        supabase: db,
        context: capabilities("knowledge.publish"),
        policyIds: [doc.policyId],
      }),
    ).rejects.toMatchObject({ code: "approval_required" });
    await approveMerchantDocument({
      supabase: db,
      context: capabilities("knowledge.review.answer"),
      policyId: doc.policyId,
    });
    const r = await publishMerchantDocuments({
      supabase: db,
      context: capabilities("knowledge.publish"),
      policyIds: [doc.policyId],
    });
    expect(r.seq).toBe(1);
    expect(
      (
        await searchMerchantDocumentRelease({
          supabase: db,
          request: {
            workspaceId: "tenant-a",
            trustedShopId: "shop-a",
            query: "Denmark shipping",
          },
        })
      ).handled,
    ).toBe(false);
    await activateMerchantDocuments({
      supabase: db,
      context: capabilities("knowledge.activate"),
      seq: r.seq,
      policyIds: [doc.policyId],
    });
    const hits = await searchMerchantDocumentRelease({
      supabase: db,
      request: {
        workspaceId: "tenant-a",
        trustedShopId: "shop-a",
        query: "Denmark delivery",
        limit: 10,
      },
    });
    expect(hits.hits.some((h) => h.record.content.includes("1–2"))).toBe(true);
    expect(
      (
        await searchMerchantDocumentRelease({
          supabase: db,
          request: {
            workspaceId: "tenant-b",
            trustedShopId: "shop-a",
            query: "Denmark delivery",
          },
        })
      ).hits,
    ).toEqual([]);
    const reused = await ingestMerchantDocument({
      supabase: db,
      context,
      input: {
        documentKey: "shipping",
        title: "Shipping",
        content:
          "## Denmark\nDelivery estimate: 1–2 business days. Standard shipping: 49 DKK.",
      },
      catalog: [],
    });
    expect(reused.reused).toBe(true);
    expect(db.tables.kn2_sources.length).toBe(1);
    const repeated = await publishMerchantDocuments({
      supabase: db,
      context: capabilities("knowledge.publish"),
      policyIds: [doc.policyId],
    });
    expect(repeated.reused).toBe(true);
    const again = await activateMerchantDocuments({
      supabase: db,
      context: capabilities("knowledge.activate"),
      seq: 1,
      policyIds: [doc.policyId],
    });
    expect(again.reused).toBe(true);
    expect(db.tables.kn2_releases.length).toBe(1);
  });
  it("rejects incorrect catalog scope before any write", async () => {
    const db = memoryDB();
    await expect(
      ingestMerchantDocument({
        supabase: db,
        context,
        input: {
          title: "Guide",
          content: "## Care\nClean with a cloth.",
          productIds: ["123"],
        },
        catalog: [{ id: "123", title: "A product", shopId: "shop-b" }],
      }),
    ).rejects.toMatchObject({ code: "catalog_scope" });
    expect(db.writes).toEqual([]);
  });
  it("detects source substitution before approval", async () => {
    const db = memoryDB();
    const doc = await ingestMerchantDocument({
      supabase: db,
      context,
      input: {
        title: "Returns",
        content: "## Returns\nReturn window: 30 days.",
      },
      catalog: [],
    });
    db.tables.kn2_policies[0].drafts.merchant_document.units[0].payload.text =
      "Return window: 60 days.";
    await expect(
      approveMerchantDocument({
        supabase: db,
        context: capabilities("knowledge.review.answer"),
        policyId: doc.policyId,
      }),
    ).rejects.toMatchObject({ code: "document_invalid" });
  });
  it("leaves ambiguous multi-product sections unresolved until an explicit review decision", async () => {
    const db = memoryDB();
    const doc = await ingestMerchantDocument({
      supabase: db,
      context,
      input: {
        title: "Care",
        content:
          "## Product A\nWipe clean.\n## Other care\nUnknown applicability.",
        productIds: ["123", "456"],
      },
      catalog: [
        { id: "123", title: "Product A", shopId: "shop-a" },
        { id: "456", title: "Product B", shopId: "shop-a" },
      ],
    });
    expect(doc.draft.unresolved).toHaveLength(1);
    await expect(
      approveMerchantDocument({
        supabase: db,
        context: capabilities("knowledge.review.answer"),
        policyId: doc.policyId,
      }),
    ).rejects.toMatchObject({ code: "unresolved_document" });
  });
});
