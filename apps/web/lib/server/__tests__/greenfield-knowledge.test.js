import { describe, expect, it } from "vitest";
import {
  buildMerchantKnowledgeSource,
  lifecycleStatus,
  serializeGreenfieldKnowledge,
  validateKnowledgePayload,
} from "../greenfield-knowledge";

const NOW = new Date("2026-09-06T12:00:00.000Z");

describe("greenfield knowledge UI lifecycle", () => {
  it("A/G: validates merchant-authored drafts and stores product applicability as generic metadata", () => {
    const validation = validateKnowledgePayload({
      title: "Wireless connection steps",
      type: "procedure",
      status: "draft",
      content: "1. Disconnect the receiver.\n2. Restart the headset.",
      applies_to: { kind: "products", product_ids: ["101", "102"] },
    });
    expect(validation.valid).toBe(true);

    const source = buildMerchantKnowledgeSource({
      value: validation.value,
      products: [{ id: "101", external_id: "gid://shopify/Product/101", title: "Wireless headset" }],
      now: NOW,
    });
    expect(source.knowledgeType).toBe("procedural");
    expect(source.authority).toBe("authoritative");
    expect(source.sourceKind).toBe("merchant_authored");
    expect(source.metadata.lifecycle_status).toBe("draft");
    expect(source.metadata.applies_to).toMatchObject({ kind: "products", product_ids: ["101", "102"] });
    expect(source.publishedAt).toBeNull();
  });

  it("C/F: maps publish and archive to retrieval-safe lifecycle fields", () => {
    const published = validateKnowledgePayload({
      title: "Returns",
      type: "policy",
      status: "published",
      content: "Returns are accepted within 30 days.",
      applies_to: { kind: "all" },
    });
    const publishedSource = buildMerchantKnowledgeSource({ value: published.value, now: NOW });
    expect(publishedSource.metadata.lifecycle_status).toBe("published");
    expect(publishedSource.publishedAt).toBe(NOW.toISOString());
    expect(publishedSource.expiresAt).toBeNull();

    const archived = validateKnowledgePayload({
      title: "Returns",
      type: "policy",
      status: "archived",
      content: "Returns are accepted within 30 days.",
      applies_to: { kind: "all" },
    });
    const archivedSource = buildMerchantKnowledgeSource({ value: archived.value, now: NOW });
    expect(archivedSource.metadata.lifecycle_status).toBe("archived");
    expect(archivedSource.publishedAt).toBeNull();
    expect(archivedSource.expiresAt).toBe(NOW.toISOString());
  });

  it("I: preserves imported provenance and makes imported records read-only", () => {
    const serialized = serializeGreenfieldKnowledge({
      id: "record-1",
      knowledge_type: "product",
      authority: "reference",
      title: "Imported product guide",
      content: "Imported content",
      source_kind: "website",
      source_label: "Merchant website",
      metadata: {},
      updated_at: "2026-09-06T11:00:00.000Z",
    });
    expect(serialized.source).toMatchObject({ label: "Merchant website", kind: "website", editable: false });
    expect(serialized.status).toBe("published");
    expect(lifecycleStatus({ metadata: { lifecycle_status: "unpublished" } })).toBe("unpublished");
  });

  it("rejects unknown types, empty content, and invalid product applicability", () => {
    const result = validateKnowledgePayload({
      title: "",
      type: "router",
      status: "published",
      content: "",
      applies_to: { kind: "products", product_ids: [] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Title is required.",
      "Content is required.",
      "Choose a supported knowledge type.",
      "Select at least one scoped product, or choose All products.",
    ]));
  });
});
