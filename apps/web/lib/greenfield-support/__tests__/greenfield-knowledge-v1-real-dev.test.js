import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseKnowledgeStore, splitMarkdownKnowledgeSource } from "../knowledge";

const enabled = process.env.GREENFIELD_KNOWLEDGE_V1_DEV_EVAL === "true";
const workspaceId = process.env.GREENFIELD_DEV_WORKSPACE_ID || "48d4d494-b09c-49ba-920c-b9441204b87f";

function sourceHeading(title, sourceTitle) {
  let value = String(title || "").trim();
  const prefix = `${sourceTitle} — `;
  while (value.toLowerCase().startsWith(prefix.toLowerCase())) value = value.slice(prefix.length).trim();
  return value.replace(/^AceZone procedure:\s*/i, "").trim();
}

describe.skipIf(!enabled)("Greenfield Knowledge V1 real DEV corpus", () => {
  it("links a small real DEV corpus through sources and keeps the existing content", async () => {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: rawRecords, error: loadError } = await client
      .from("greenfield_knowledge_records")
      .select("source_kind,source_id,source_label,title,content,knowledge_type,authority,structured_data,metadata")
      .eq("workspace_id", workspaceId)
      .in("source_id", [
        "acezone-support",
        "acezone-a-spire-wireless",
        "acezone-about",
        "merchant-authored-a-spire-wireless-factory-reset",
        "merchant-authored-a-spire-wireless-dongle-connection",
        "merchant-authored-a-spire-wireless-firmware-update",
        "merchant-authored-a-spire-wireless-dongle-interference",
        "merchant-authored-a-spire-wireless-charging",
        "merchant-authored-generic-microphone-troubleshooting",
      ]);
    if (loadError) throw loadError;
    expect(rawRecords?.length).toBe(9);

    const store = new SupabaseKnowledgeStore(client);
    const nonProcedures = (rawRecords || []).filter((row) => row.knowledge_type !== "procedural");
    for (const raw of nonProcedures) {
      await store.ingestSource(workspaceId, {
        sourceKind: "dev_raw_reuse",
        sourceId: `v1:${raw.source_id}`,
        title: raw.title,
        content: raw.content,
        sourceLabel: raw.source_label,
        candidates: [{
          recordKey: "canonical",
          title: raw.title,
          content: raw.content,
          knowledgeType: raw.knowledge_type,
          authority: raw.authority,
          structuredData: raw.structured_data || {},
          metadata: raw.metadata || {},
          sourceLocation: { section: "existing DEV Greenfield raw record", order: 0 },
        }],
      });
    }

    const procedures = (rawRecords || []).filter((row) => row.knowledge_type === "procedural");
    const procedureSourceTitle = "AceZone FAQ procedure subset";
    const sourceContent = procedures.map((row) => `## ${sourceHeading(row.title, procedureSourceTitle)}\n\n${row.content}`).join("\n\n");
    const candidates = splitMarkdownKnowledgeSource({
      title: procedureSourceTitle,
      content: sourceContent,
      knowledgeType: "procedural",
      authority: "authoritative",
    }).map((candidate, index) => ({
      ...candidate,
      recordKey: `real-procedure-${index + 1}`,
      metadata: { ...candidate.metadata, lifecycle_status: "published", real_dev_source: true },
    }));
    const result = await store.ingestSource(workspaceId, {
      sourceKind: "dev_raw_reuse",
      sourceId: "v1:acezone-procedure-subset",
      title: procedureSourceTitle,
      content: sourceContent,
      sourceLabel: "Existing Sona DEV Greenfield procedure records",
      candidates,
    });
    expect(result.records.length).toBe(6);

    const { data: sources, error: sourceError } = await client
      .from("greenfield_knowledge_sources")
      .select("id,source_id,source_version")
      .eq("workspace_id", workspaceId)
      .like("source_id", "v1:%");
    if (sourceError) throw sourceError;
    expect((sources || []).length).toBeGreaterThanOrEqual(4);

    const { data: linked, error: linkedError } = await client
      .from("greenfield_knowledge_records")
      .select("source_uuid,source_version,source_content_hash,structured_data,task_key,metadata")
      .eq("workspace_id", workspaceId)
      .eq("source_uuid", result.sourceId);
    if (linkedError) throw linkedError;
    expect(linked?.length).toBe(6);
    expect(linked?.every((row) => row.source_version >= 1 && row.source_content_hash)).toBe(true);
    expect(linked?.every((row) => row.structured_data?.procedure?.blocks?.length > 0)).toBe(true);
    expect(linked?.every((row) => row.metadata?.lifecycle_status === "published")).toBe(true);

    const retrievalChecks = [
      { query: "A-Spire Wireless microphone not working", types: ["procedural"], expected: "microphone" },
      { query: "A-Spire Wireless factory reset", types: ["procedural"], expected: "factory reset" },
      { query: "A-Spire Wireless firmware update", types: ["procedural"], expected: "firmware" },
      { query: "return warranty shipping policy", types: ["policy"], expected: "warranty" },
      { query: "A-Spire Wireless charging while using dongle", types: ["procedural"], expected: "charge" },
    ];
    for (const check of retrievalChecks) {
      const hits = await store.search({ workspaceId, query: check.query, knowledgeTypes: check.types, limit: 3 });
      expect(hits.length, check.query).toBeGreaterThan(0);
      expect(hits.some((hit) => hit.record.title.toLowerCase().includes(check.expected)), check.query).toBe(true);
    }
  }, 120_000);
});
