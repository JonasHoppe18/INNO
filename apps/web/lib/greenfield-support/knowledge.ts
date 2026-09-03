import type {
  AuthorityLevel,
  KnowledgeHit,
  KnowledgeEvidence,
  KnowledgeRecord,
  KnowledgeSearchRequest,
  KnowledgeSourceInput,
  KnowledgeStore,
  KnowledgeType,
  JsonObject,
} from "./types";

const DEFAULT_CLASSIFICATION: Record<
  string,
  { knowledgeType: KnowledgeType; authority: AuthorityLevel }
> = {
  policy: { knowledgeType: "policy", authority: "authoritative" },
  return_policy: { knowledgeType: "policy", authority: "authoritative" },
  shipping_policy: { knowledgeType: "policy", authority: "authoritative" },
  warranty_policy: { knowledgeType: "policy", authority: "authoritative" },
  product: { knowledgeType: "product", authority: "reference" },
  product_catalog: { knowledgeType: "product", authority: "reference" },
  product_manual: { knowledgeType: "product", authority: "reference" },
  historical_ticket: { knowledgeType: "historic_support", authority: "example" },
  historic_support: { knowledgeType: "historic_support", authority: "example" },
  brand: { knowledgeType: "brand", authority: "guidance" },
  brand_guidance: { knowledgeType: "brand", authority: "guidance" },
  procedure: { knowledgeType: "procedural", authority: "authoritative" },
  customer_service_procedure: { knowledgeType: "procedural", authority: "authoritative" },
  operational_snapshot: { knowledgeType: "live_operational", authority: "operational" },
};

const AUTHORITY_WEIGHT: Record<AuthorityLevel, number> = {
  authoritative: 1,
  operational: 0.98,
  reference: 0.88,
  guidance: 0.78,
  example: 0.55,
};

const STOP_WORDS = new Set(
  "a an and are as at be can could for from how i in is it me my of on or order our please the this to was we what when where with would you your".split(
    " ",
  ),
);

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CONTENT_ROOTS = ["main", "article", "body"] as const;
const NON_CONTENT_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "portal",
  "dialog",
  "base",
  "link",
  "meta",
] as const;
const CHROME_TAGS = [
  "nav",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "textarea",
] as const;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  hellip: "…",
  ldquo: "“",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
  gt: ">",
};

function stripElementBlocks(value: string, tags: readonly string[]): string {
  const pattern = new RegExp(
    `<(${tags.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "gi",
  );
  return value.replace(pattern, " ");
}

function stripMarkedNoise(value: string): string {
  const marker =
    "cookie|consent|gdpr|newsletter|subscribe|popup|modal|overlay|site[-_ ]?nav|main[-_ ]?nav|breadcrumb|announcement[-_ ]?bar";
  const marked = new RegExp(
    `<([a-z][\\w:-]*)\\b(?=[^>]*(?:id|class|role|aria-label|data-[\\w:-]+)\\s*=\\s*[\"'][^\"']*(?:${marker})[^\"']*[\"'])[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "gi",
  );
  const hidden = /<([a-z][\w:-]*)\b(?=[^>]*(?:\bhidden\b|aria-hidden\s*=\s*[\"']true[\"']|style\s*=\s*[\"'][^\"']*display\s*:\s*none))[^>]*>[\s\S]*?<\/\1\s*>/gi;
  return value.replace(marked, " ").replace(hidden, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const codePoint = Number(digits);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&#x([\da-f]+);/gi, (_, digits: string) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&([a-z]+);/gi, (full, name: string) => HTML_ENTITY_MAP[name.toLowerCase()] ?? full);
}

function extractContentRoot(value: string): { content: string; tag: (typeof CONTENT_ROOTS)[number] | null } {
  for (const tag of CONTENT_ROOTS) {
    const match = value.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
    if (match?.[1]?.trim()) return { content: match[1], tag };
  }
  return { content: value, tag: null };
}

function extractMetaSummary(value: string): string {
  const descriptions: string[] = [];
  for (const match of value.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content && (name === "description" || name === "og:description" || name === "twitter:description")) {
      descriptions.push(decodeHtmlEntities(content));
    }
  }
  const uniqueDescriptions = Array.from(new Set(descriptions));
  if (uniqueDescriptions.length) return uniqueDescriptions[0];
  const title = value.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  return title ? decodeHtmlEntities(title) : "";
}

function normalizeVisibleHtml(value: string): string {
  const withStructure = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n")
    .replace(/<t[dh]\b[^>]*>/gi, " ")
    .replace(/<\/(?:t[dh])\s*>/gi, " | ")
    .replace(/<\/(?:p|div|section|article|main|ul|ol|table|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeHtmlEntities(withStructure)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const deduplicated: string[] = [];
  for (const line of lines) {
    if (line === deduplicated[deduplicated.length - 1]) continue;
    deduplicated.push(line);
  }
  return deduplicated.join("\n\n");
}

/** Convert raw HTML to conservative visible source text without merchant-specific rules. */
export function cleanRawContent(value: unknown): string {
  const raw = String(value ?? "");
  if (!/<\/?[a-z][^>]*>/i.test(raw)) return cleanText(raw);
  const withoutBlocks = stripElementBlocks(raw.replace(/<!--[\s\S]*?-->/g, " "), NON_CONTENT_TAGS);
  const root = extractContentRoot(withoutBlocks);
  const chromeTags = root.tag === "main" || root.tag === "article" ? CHROME_TAGS : ["header", ...CHROME_TAGS];
  const visible = normalizeVisibleHtml(stripMarkedNoise(stripElementBlocks(root.content, chromeTags)));
  if (visible.length >= 80) return cleanText(visible);
  return cleanText([visible, extractMetaSummary(withoutBlocks)].filter(Boolean).join("\n"));
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function tokens(value: string): string[] {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `gk_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function sha256(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return stableId(value);
}

function splitIntoChunks(content: string, maxLength = 900): string[] {
  const paragraphs = content.split(/\n\s*\n/).map(cleanText).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [content]) {
    if (!current) {
      current = paragraph;
    } else if ((current + "\n\n" + paragraph).length <= maxLength) {
      current += `\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [content];
}

function classify(source: KnowledgeSourceInput) {
  const explicitType = source.knowledgeType;
  const sourceKind = cleanText(source.sourceKind).toLowerCase();
  const defaultValue = DEFAULT_CLASSIFICATION[sourceKind] ?? {
    knowledgeType: "product" as const,
    authority: "reference" as const,
  };
  return {
    knowledgeType: explicitType ?? defaultValue.knowledgeType,
    authority: source.authority ?? defaultValue.authority,
  };
}

/** Generic structured extraction hooks. Source metadata always wins over heuristics. */
function extractStructuredData(source: KnowledgeSourceInput): JsonObject {
  const result: JsonObject = { ...(source.metadata ?? {}), ...(source.structuredData ?? {}) };
  const returnWindow = source.content.match(/\b(\d{1,3})\s*(?:day|days|dage)\b/i)?.[1];
  if (returnWindow && result.return_window_days == null) {
    result.return_window_days = Number(returnWindow);
  }
  return result;
}

export async function normalizeKnowledgeSource(
  workspaceId: string,
  source: KnowledgeSourceInput,
): Promise<KnowledgeRecord> {
  const normalizedWorkspaceId = cleanText(workspaceId);
  if (!normalizedWorkspaceId) throw new Error("workspaceId is required for knowledge ingestion.");
  const content = cleanRawContent(source.content);
  if (!content) throw new Error("Knowledge content is required.");
  if (!cleanText(source.sourceKind) || !cleanText(source.sourceId)) {
    throw new Error("Knowledge provenance requires sourceKind and sourceId.");
  }
  const classification = classify(source);
  const title = cleanText(source.title) || content.slice(0, 100);
  // Hash content rather than an external source id so repeated imports from
  // different source records do not create duplicate searchable facts.
  const canonical = [normalizedWorkspaceId, classification.knowledgeType, content].join("\u001f");
  const contentHash = await sha256(canonical);
  return {
    id: stableId(`${normalizedWorkspaceId}:${contentHash}`),
    workspaceId: normalizedWorkspaceId,
    knowledgeType: classification.knowledgeType,
    authority: classification.authority,
    title,
    content,
    structuredData: extractStructuredData(source),
    sourceKind: cleanText(source.sourceKind),
    sourceId: cleanText(source.sourceId),
    sourceUri: cleanText(source.sourceUri) || null,
    sourceLabel: cleanText(source.sourceLabel) || null,
    contentHash,
    publishedAt: cleanText(source.publishedAt) || null,
    observedAt: cleanText(source.observedAt) || null,
    expiresAt: cleanText(source.expiresAt) || null,
    metadata: { ...(source.metadata ?? {}) },
    chunks: splitIntoChunks(content),
  };
}

function isExpired(record: KnowledgeRecord, now: number): boolean {
  if (!record.expiresAt) return false;
  const expiry = Date.parse(record.expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

function freshnessScore(record: KnowledgeRecord, now: number): number {
  const date = Date.parse(record.observedAt || record.publishedAt || "");
  if (!Number.isFinite(date)) return 0.5;
  const ageDays = Math.max(0, (now - date) / 86_400_000);
  return Math.max(0.35, 1 - ageDays / 365);
}

function searchRecord(record: KnowledgeRecord, query: string, now: number): KnowledgeHit | null {
  if (record.knowledgeType === "live_operational") return null;
  if (isExpired(record, now)) return null;
  const queryTokens = new Set(tokens(query));
  if (!queryTokens.size) return null;
  const titleTokens = new Set(tokens(record.title));
  const bodyTokens = new Set(tokens(`${record.content} ${JSON.stringify(record.structuredData)}`));
  const titleMatches = Array.from(queryTokens).filter((token) => titleTokens.has(token)).length;
  const bodyMatches = Array.from(queryTokens).filter((token) => bodyTokens.has(token)).length;
  if (!titleMatches && !bodyMatches) return null;
  const phraseBonus = record.content.toLowerCase().includes(cleanText(query).toLowerCase()) ? 0.25 : 0;
  const lexical = bodyMatches / queryTokens.size;
  const score =
    (lexical + titleMatches / Math.max(queryTokens.size, 1) * 0.35 + phraseBonus) *
    AUTHORITY_WEIGHT[record.authority] *
    (0.75 + freshnessScore(record, now) * 0.25);
  return {
    record,
    score,
    matchReason: titleMatches ? "title" : Object.keys(record.structuredData).length ? "structured" : "lexical",
  };
}

export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly records = new Map<string, KnowledgeRecord>();

  async ingest(workspaceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord> {
    const record = await normalizeKnowledgeSource(workspaceId, source);
    const key = `${record.workspaceId}:${record.contentHash}`;
    const existing = this.records.get(key);
    if (existing) return existing;
    this.records.set(key, record);
    return record;
  }

  async replaceSource(workspaceId: string, sourceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord> {
    const normalizedWorkspaceId = cleanText(workspaceId);
    const normalizedSourceId = cleanText(sourceId);
    if (!normalizedWorkspaceId || !normalizedSourceId || cleanText(source.sourceId) !== normalizedSourceId) {
      throw new Error("Source replacement requires matching workspace and source identity.");
    }
    const replacement = await this.ingest(normalizedWorkspaceId, source);
    for (const [key, record] of this.records) {
      if (
        record.workspaceId === normalizedWorkspaceId &&
        record.sourceId === normalizedSourceId &&
        record.id !== replacement.id
      ) {
        this.records.delete(key);
      }
    }
    return replacement;
  }

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeHit[]> {
    const workspaceId = cleanText(request.workspaceId);
    if (!workspaceId) throw new Error("workspaceId is required for knowledge search.");
    const now = Date.now();
    const allowedTypes = request.knowledgeTypes ? new Set(request.knowledgeTypes) : null;
    return Array.from(this.records.values())
      .filter((record) => record.workspaceId === workspaceId)
      .filter((record) => !allowedTypes || allowedTypes.has(record.knowledgeType))
      .map((record) => searchRecord(record, request.query, now))
      .filter(Boolean)
      .sort((a, b) => (b as KnowledgeHit).score - (a as KnowledgeHit).score)
      .slice(0, Math.max(1, Math.min(request.limit ?? 5, 20))) as KnowledgeHit[];
  }
}

/** Production adapter. The RPC is tenant-filtered again in SQL, not just here. */
export class SupabaseKnowledgeStore implements KnowledgeStore {
  constructor(private readonly serviceClient: any) {}

  private async loadEvidenceWindows(workspaceId: string, rows: any[]): Promise<Map<string, KnowledgeEvidence[]>> {
    const recordIds = Array.from(new Set(rows.map((row) => String(row.id ?? "")).filter(Boolean)));
    if (!recordIds.length) return new Map();

    const { data, error } = await this.serviceClient
      .from("greenfield_knowledge_chunks")
      .select("id,record_id,chunk_index,content")
      .eq("workspace_id", workspaceId)
      .in("record_id", recordIds);
    if (error) throw new Error(error.message);

    const chunksByRecord = new Map<string, Array<{ id: string; index: number; content: string }>>();
    for (const row of Array.isArray(data) ? data : []) {
      const recordId = String(row.record_id ?? "");
      if (!recordId) continue;
      const chunks = chunksByRecord.get(recordId) ?? [];
      chunks.push({
        id: String(row.id),
        index: Number(row.chunk_index ?? 0),
        content: String(row.content ?? ""),
      });
      chunksByRecord.set(recordId, chunks);
    }

    const windows = new Map<string, KnowledgeEvidence[]>();
    for (const row of rows) {
      const recordId = String(row.id ?? "");
      const selectedIndex = Number(row.chunk_index ?? 0);
      const chunks = chunksByRecord.get(recordId) ?? [];
      if (!chunks.some((chunk) => chunk.id === String(row.chunk_id ?? ""))) {
        chunks.push({
          id: String(row.chunk_id ?? ""),
          index: selectedIndex,
          content: String(row.chunk_content ?? ""),
        });
      }
      windows.set(
        recordId,
        chunks
          .filter((chunk) => Math.abs(chunk.index - selectedIndex) <= 1)
          .sort((left, right) => left.index - right.index)
          .map((chunk) => ({
            chunkId: chunk.id,
            chunkIndex: chunk.index,
            content: chunk.content,
          })),
      );
    }
    return windows;
  }

  private async embedQuery(query: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
    const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: query, encoding_format: "float" }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message;
      throw new Error(message ? `Embedding request failed: ${message}` : `Embedding request failed (${response.status}).`);
    }
    const embedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error("Embedding response did not contain a query vector.");
    return embedding;
  }

  async ingest(workspaceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord> {
    const record = await normalizeKnowledgeSource(workspaceId, source);
    const { data, error } = await this.serviceClient
      .from("greenfield_knowledge_records")
      .upsert({
        workspace_id: record.workspaceId,
        knowledge_type: record.knowledgeType,
        authority: record.authority,
        title: record.title,
        content: record.content,
        structured_data: record.structuredData,
        source_kind: record.sourceKind,
        source_id: record.sourceId,
        source_uri: record.sourceUri,
        source_label: record.sourceLabel,
        content_hash: record.contentHash,
        published_at: record.publishedAt,
        observed_at: record.observedAt,
        expires_at: record.expiresAt,
        metadata: record.metadata,
      }, { onConflict: "workspace_id,content_hash" })
      .select("*")
      .single();
    if (error || !data?.id) throw new Error(error?.message || "Could not store greenfield knowledge record.");
    const chunks = record.chunks.map((content, chunkIndex) => ({
      workspace_id: record.workspaceId,
      record_id: data.id,
      chunk_index: chunkIndex,
      content,
    }));
    const chunkResult = await this.serviceClient
      .from("greenfield_knowledge_chunks")
      .upsert(chunks, { onConflict: "record_id,chunk_index" });
    if (chunkResult.error) throw new Error(chunkResult.error.message);
    return { ...record, id: String(data.id) };
  }

  /** Ingest first, then remove only older copies of this tenant/source pair. */
  async replaceSource(workspaceId: string, sourceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord> {
    const normalizedWorkspaceId = cleanText(workspaceId);
    const normalizedSourceId = cleanText(sourceId);
    if (!normalizedWorkspaceId || !normalizedSourceId || cleanText(source.sourceId) !== normalizedSourceId) {
      throw new Error("Source replacement requires matching workspace and source identity.");
    }
    const record = await this.ingest(normalizedWorkspaceId, source);
    const { error } = await this.serviceClient
      .from("greenfield_knowledge_records")
      .delete()
      .eq("workspace_id", normalizedWorkspaceId)
      .eq("source_id", normalizedSourceId)
      .neq("content_hash", record.contentHash);
    if (error) throw new Error(error.message);
    return record;
  }

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeHit[]> {
    const queryEmbedding = await this.embedQuery(request.query);
    const { data, error } = await this.serviceClient.rpc("greenfield_search_knowledge_semantic", {
      p_workspace_id: request.workspaceId,
      p_query_embedding: queryEmbedding,
      p_knowledge_types: request.knowledgeTypes ?? null,
      p_limit: request.limit ?? 5,
    });
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    const evidenceWindows = await this.loadEvidenceWindows(request.workspaceId, rows);
    return rows.map((row: any, index: number) => ({
      record: {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        knowledgeType: row.knowledge_type,
        authority: row.authority,
        title: row.title,
        content: row.content,
        structuredData: row.structured_data ?? {},
        sourceKind: row.source_kind,
        sourceId: row.source_id,
        sourceUri: row.source_uri ?? null,
        sourceLabel: row.source_label ?? null,
        contentHash: row.content_hash,
        publishedAt: row.published_at ?? null,
        observedAt: row.observed_at ?? null,
        expiresAt: row.expires_at ?? null,
        metadata: row.metadata ?? {},
        chunks: Array.isArray(row.chunks) ? row.chunks : [row.content],
      },
      score: Number(row.score ?? 0),
      rank: index + 1,
      evidenceWindow: evidenceWindows.get(String(row.id)) ?? [],
      matchReason: row.match_reason ?? "semantic",
    }));
  }
}
