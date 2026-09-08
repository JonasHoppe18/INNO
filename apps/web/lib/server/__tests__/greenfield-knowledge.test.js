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

  it("keeps multiple native procedures independently editable for one product", () => {
    const values = ["Descale", "Grinder blocked", "Water not heating"].map((title) => {
      const validation = validateKnowledgePayload({
        title: `Coffee Machine X — ${title}`,
        type: "procedure",
        status: "draft",
        content: `Run the ${title.toLowerCase()} procedure.`,
        task_key: title.toLowerCase().replaceAll(" ", "_"),
        customer_aliases: [`${title} help`],
        procedure_blocks: [{ kind: "instruction", text: `Run the ${title.toLowerCase()} procedure.` }],
        applies_to: { kind: "products", product_ids: ["coffee-machine-x"] },
      });
      expect(validation.valid).toBe(true);
      return validation.value;
    });
    const sources = values.map((value, index) => buildMerchantKnowledgeSource({
      value,
      existing: { source_id: `merchant-ui:coffee-${index + 1}` },
      products: [{ id: "coffee-machine-x", external_id: "coffee-machine-x", title: "Coffee Machine X" }],
      now: NOW,
    }));

    expect(new Set(sources.map((source) => source.sourceId)).size).toBe(3);
    expect(sources.map((source) => source.taskKey)).toEqual(["descale", "grinder_blocked", "water_not_heating"]);
    expect(sources.every((source) => Array.isArray(source.metadata.applies_to.product_ids))).toBe(true);
    expect(sources.every((source) => source.structuredData.procedure.blocks.length === 1)).toBe(true);

    const editedValidation = validateKnowledgePayload({
      title: "Coffee Machine X — Grinder blocked (revised)",
      type: "procedure",
      status: "published",
      content: "Clear the grinder channel after switching the machine off.",
      task_key: "grinder_blocked_revised",
      customer_aliases: ["blocked grinder"],
      procedure_blocks: [
        { kind: "prerequisite", text: "Switch the machine off." },
        { kind: "instruction", text: "Clear the grinder channel." },
      ],
      applies_to: { kind: "products", product_ids: ["coffee-machine-x"] },
    });
    expect(editedValidation.valid).toBe(true);
    const edited = buildMerchantKnowledgeSource({
      value: editedValidation.value,
      existing: { ...sources[1], source_id: sources[1].sourceId },
      products: [{ id: "coffee-machine-x", external_id: "coffee-machine-x", title: "Coffee Machine X" }],
      now: NOW,
    });
    expect(edited.sourceId).toBe(sources[1].sourceId);
    expect(edited.title).toContain("revised");
    expect(edited.taskKey).toBe("grinder_blocked_revised");
    expect(edited.structuredData.procedure.blocks).toHaveLength(2);
    expect(sources[0].title).toContain("Descale");
    expect(sources[2].title).toContain("Water not heating");
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
