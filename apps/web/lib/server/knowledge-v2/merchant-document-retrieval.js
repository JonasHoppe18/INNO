import { selectMaterialPolicyUnits } from "../../../../../shared/knowledge-v2/policy-retrieval.mjs";
import { loadPlatformFromRepo } from "../../../../../shared/knowledge-v2/platform-node.mjs";
import { validateUnit } from "../../../../../shared/knowledge-v2/units.mjs";
import { extractReferences } from "../../../../../shared/knowledge-v2/references.mjs";
const clean = (v) => String(v ?? "").trim();
const words = (t) =>
  new Set(
    clean(t)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 &&
          ![
            "the",
            "and",
            "for",
            "with",
            "from",
            "how",
            "can",
            "does",
            "what",
            "before",
            "after",
            "should",
            "must",
            "not",
            "use",
            "item",
            "product",
            "home",
          ].includes(w),
      ),
  );
function runtimeKnowledgeType(unit) {
  const p = unit.payload;
  if (p.semantic_type === "PROCEDURE") return "procedural";
  if (p.applicability.kind !== "merchant") return "product";
  return unit.domain_key === "general" ? "brand" : "policy";
}
// Read only activated, platform-validated release members. The projection is
// derived on read; it never creates a second mutable knowledge corpus.
export async function searchMerchantDocumentRelease({ supabase, request }) {
  if (!request.workspaceId || !request.trustedShopId)
    return { handled: false, hits: [] };
  const shop = await supabase
    .from("shops")
    .select("id")
    .eq("workspace_id", request.workspaceId)
    .eq("id", request.trustedShopId)
    .is("uninstalled_at", null)
    .maybeSingle();
  if (shop.error) throw new Error(shop.error.message);
  if (!shop.data) return { handled: true, hits: [] };
  const releaseResult = await supabase
    .from("kn2_releases")
    .select("seq,platform_version,platform_hash")
    .eq("workspace_id", request.workspaceId)
    .eq("shop_id", request.trustedShopId)
    .not("activated_at", "is", null)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (releaseResult.error) throw new Error(releaseResult.error.message);
  const release = releaseResult.data;
  if (!release) return { handled: false, hits: [] };
  const pinned = await loadPlatformFromRepo(release.platform_version);
  if (pinned.hash !== release.platform_hash)
    throw new Error("Knowledge release platform pin mismatch.");
  if (!pinned.platform.merchant_support_contract)
    return { handled: false, hits: [] };
  const result = await supabase
    .from("kn2_unit_versions")
    .select("*")
    .eq("workspace_id", request.workspaceId)
    .eq("shop_id", request.trustedShopId)
    .lte("from_seq", release.seq)
    .limit(5000);
  if (result.error) throw new Error(result.error.message);
  const activeMembers = (result.data ?? []).filter(
    (u) => u.to_seq === null || u.to_seq > release.seq,
  );
  const members = activeMembers.filter(
    (u) => u.payload?.contract === "merchant_support/v1",
  );
  const allDocumentMembers =
    members.length > 0 && members.length === activeMembers.length;
  for (const u of members)
    if (
      validateUnit(pinned.platform, u).length ||
      extractReferences(pinned.platform, u.kind, u.payload).errors.length
    )
      throw new Error("Invalid activated merchant knowledge.");
  const query = clean(request.query).toLowerCase();
  const queryWords = words(query);
  if (/\b(?:time|days|arrive)\b/.test(query)) queryWords.add("delivery");
  if (/\b(?:price|cost|fee)\b/.test(query)) queryWords.add("shipping");
  if (/\b(?:threshold|free)\b/.test(query)) queryWords.add("free");
  const identities = new Map(
    members.flatMap((u) =>
      u.payload.product_bindings.map((b) => [b.id, b.title]),
    ),
  );
  if (
    request.productContext &&
    request.productContext.workspaceId !== request.workspaceId
  )
    return { handled: true, hits: [] };
  const selectedProducts = [...identities]
    .filter(([, title]) => query.includes(title.toLowerCase()))
    .map(([id]) => id);
  if (
    !selectedProducts.length &&
    request.productContext &&
    identities.has(request.productContext.productId)
  )
    selectedProducts.push(request.productContext.productId);
  let ranked = members
    .filter((u) => {
      const p = u.payload;
      const a = p.applicability;
      if (
        a.kind !== "merchant" &&
        selectedProducts.length &&
        !a.product_ids.some((id) => selectedProducts.includes(id))
      )
        return false;
      const rt = runtimeKnowledgeType(u);
      return (
        !request.knowledgeTypes?.length || request.knowledgeTypes.includes(rt)
      );
    })
    .map((u) => {
      const p = u.payload,
        contentWords = words(`${p.title} ${p.text}`);
      let score = 0;
      for (const w of queryWords) if (contentWords.has(w)) score++;
      // Product identity chooses scope, but is not itself an answer to a task.
      if (selectedProducts.length) {
        for (const id of selectedProducts)
          for (const w of words(identities.get(id)))
            if (queryWords.has(w) && contentWords.has(w)) score--;
      }
      return { u, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.u.id.localeCompare(b.u.id))
    .slice(0, Math.max(1, Math.min(request.limit ?? 5, 20)));
  let policyCoverage;
  if (request.knowledgeTypes?.includes("policy") && request.policyRequirements?.length) {
    const selection = selectMaterialPolicyUnits(members.filter(u => u.payload.semantic_type === "POLICY"
      || ["damaged_item", "warranty"].includes(u.domain_key)), request.policyRequirements, selectedProducts, request.limit);
    policyCoverage = selection.coverage;
    ranked = selection.units.map(u => ({ u, score: 1 }));
  }
  return {
    handled: allDocumentMembers,
    hits: ranked.map(({ u, score }, i) => {
      const p = u.payload;
      const type = runtimeKnowledgeType(u);
      const steps = p.steps?.map((s, index) => ({
        block_id: `step_${index + 1}`,
        kind: "instruction",
        text: s.text,
        list_style: "ordered",
      }));
      const structuredData = {
        ...(policyCoverage ? { policy_coverage: policyCoverage } : {}),
        semantic_type: p.semantic_type,
        support_domain: u.domain_key,
        applicability: p.applicability,
        source_location: p.source_location,
        ...(steps
          ? {
              procedure: {
                task: { key: u.unit_id, title: p.title },
                blocks: steps,
              },
            }
          : {}),
      };
      return {
        record: {
          id: u.id,
          workspaceId: request.workspaceId,
          knowledgeType: type,
          authority:
            p.semantic_type === "POLICY"
              ? "authoritative"
              : p.semantic_type === "PROCEDURE"
                ? "operational"
                : p.semantic_type === "GUIDANCE"
                  ? "guidance"
                  : "reference",
          title: p.title,
          content: p.text,
          structuredData,
          sourceKind: "knowledge_v2_release",
          sourceId: p.provenance[0].source_id,
          sourceUri: null,
          sourceLabel: p.title,
          contentHash: u.content_hash,
          publishedAt: null,
          observedAt: null,
          expiresAt: null,
          metadata: {
            lifecycle_status: "published",
            shop_id: request.trustedShopId,
            release_seq: release.seq,
            applies_to: {
              kind: p.applicability.kind === "merchant" ? "all" : "products",
              product_ids: p.applicability.product_ids,
            },
          },
          chunks: [p.text],
        },
        score,
        rank: i + 1,
        taskRelevance: score,
        evidenceSections: [
          { heading: p.title, chunkIds: [u.id], content: p.text },
        ],
        matchReason: "structured",
        taskSpecificity: "sufficient",
        procedureCandidates: [],
      };
    }),
  };
}
