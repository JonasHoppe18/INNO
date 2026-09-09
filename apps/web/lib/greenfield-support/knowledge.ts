import { PROCEDURE_BLOCK_KINDS } from "./types";
import type {
  AuthorityLevel,
  KnowledgeHit,
  KnowledgeEvidenceSection,
  KnowledgeRecord,
  KnowledgeProductContext,
  KnowledgeProcedureCandidate,
  KnowledgeSearchRequest,
  KnowledgeSourceInput,
  KnowledgeSourceCandidateInput,
  KnowledgeStore,
  KnowledgeType,
  JsonObject,
  ProcedureBlock,
  ProcedureBlockKind,
  KnowledgeSourceDocumentInput,
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
  "a an and are as at be can could did does for from how i in is it me my no not of on or order our please should still the this to was we what when where will with would you your".split(
    " ",
  ),
);

// Common support/product nouns help establish applicability but do not identify
// the customer's requested task. They remain in the original semantic and
// lexical queries; this set is only for the bounded task signal.
const TASK_CONTEXT_WORDS = new Set(
  "adapter audio bluetooth computer console device dongle headset headphones pc usb wireless work working problem issue help try tried need".split(" "),
);

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PROCEDURE_LABELS: Record<string, ProcedureBlockKind> = {
  prerequisite: "prerequisite",
  prerequisites: "prerequisite",
  instruction: "instruction",
  instructions: "instruction",
  step: "instruction",
  note: "note",
  notes: "note",
  warning: "warning",
  warnings: "warning",
  condition: "condition",
  conditions: "condition",
  "expected result": "expected_result",
  "expected outcome": "expected_result",
  result: "expected_result",
  alternative: "alternative",
  alternatives: "alternative",
};

function procedureKindLabel(value: string): ProcedureBlockKind | null {
  return PROCEDURE_LABELS[cleanText(value).toLowerCase()] ?? null;
}

function procedureTaskKey(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function procedureBlockText(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return cleanText((value as Record<string, unknown>).text);
  }
  return "";
}

function procedureBlockId(value: unknown, index: number): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const explicit = cleanText((value as Record<string, unknown>).block_id ?? (value as Record<string, unknown>).id);
    if (explicit) return explicit;
  }
  return `block_${index + 1}`;
}

function normalizeProcedureBlocks(value: unknown): ProcedureBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index): ProcedureBlock | null => {
    const object = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const text = procedureBlockText(item);
    if (!text) return null;
    const rawKind = cleanText(object.kind).toLowerCase();
    const kind = PROCEDURE_BLOCK_KINDS.includes(rawKind as ProcedureBlockKind)
      ? rawKind as ProcedureBlockKind
      : "instruction";
    const listStyle = object.list_style === "ordered" || object.listStyle === "ordered"
      ? "ordered"
      : object.list_style === "unordered" || object.listStyle === "unordered"
        ? "unordered"
        : null;
    const source = object.source && typeof object.source === "object" && !Array.isArray(object.source)
      ? object.source as Record<string, unknown>
      : null;
    return {
      block_id: procedureBlockId(item, index),
      kind,
      text,
      list_style: listStyle,
      ...(source ? {
        source: {
          line: Number.isFinite(Number(source.line)) ? Number(source.line) : null,
          ...(cleanText(source.section) ? { section: cleanText(source.section) } : {}),
          ...(cleanText(source.excerpt) ? { excerpt: cleanText(source.excerpt) } : {}),
        },
      } : {}),
    };
  }).filter(Boolean) as ProcedureBlock[];
}

/**
 * Deterministically preserves the small semantic vocabulary needed by a
 * procedure without asking a model to rewrite source values. Unknown prose is
 * retained as an instruction block; labels are only interpreted when explicit.
 */
export function parseProcedureBlocks(value: string): ProcedureBlock[] {
  const lines = String(value ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ProcedureBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index] ?? "";
    const trimmed = original.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({ kind: "heading", text: cleanText(heading[1]), list_style: null, source: { line: index + 1, excerpt: original } });
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    const unordered = trimmed.match(/^[-*•]\s+(.+)$/);
    const listText = ordered?.[1] ?? unordered?.[1] ?? null;
    const listStyle = ordered ? "ordered" : unordered ? "unordered" : null;
    const candidate = listText ?? trimmed;
    const labeled = candidate.match(/^([^:]{2,32}):\s+(.+)$/);
    const labeledKind = labeled ? procedureKindLabel(labeled[1]) : null;
    const kind = labeledKind
      ?? (/^if\b|^when\b|^unless\b|^only if\b/i.test(candidate) ? "condition" : null)
      ?? (/^(?:otherwise|alternatively|as an alternative)\b/i.test(candidate) ? "alternative" : null)
      ?? "instruction";
    const text = cleanText(labeled ? labeled[2] : candidate);
    if (!text) continue;

    const previous = blocks[blocks.length - 1];
    const isContinuation = !listText && !labeled && previous && previous.kind !== "heading"
      && !/[.!?:]$/.test(previous.text);
    if (isContinuation) {
      previous.text = `${previous.text}\n${text}`;
      if (previous.source) previous.source.excerpt = `${previous.source.excerpt ?? previous.text}\n${original}`;
      continue;
    }
    blocks.push({ kind, text, list_style: listStyle, source: { line: index + 1, excerpt: original } });
  }
  return normalizeProcedureBlocks(blocks);
}

export function splitMarkdownKnowledgeSource(
  source: Pick<KnowledgeSourceDocumentInput, "title" | "content"> & {
    knowledgeType?: KnowledgeType | null;
    authority?: AuthorityLevel | null;
  },
): KnowledgeSourceCandidateInput[] {
  const lines = String(source.content ?? "").replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ heading: string; lines: string[]; order: number; content: string }> = [];
  let current: { heading: string; lines: string[]; order: number } | null = null;
  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (content) sections.push({ ...current, content });
    current = null;
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      current = { heading: cleanText(heading[1]), lines: [], order: sections.length };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  if (!sections.length && cleanText(source.content)) {
    sections.push({ heading: cleanText(source.title) || "Knowledge section", lines: [source.content], order: 0, content: cleanText(source.content) });
  }
  return sections.map((section) => {
    const sourceTitle = cleanText(source.title) || "Knowledge";
    const normalizedSourceTitle = sourceTitle.toLowerCase();
    const normalizedHeading = cleanText(section.heading).toLowerCase();
    const title = normalizedHeading === normalizedSourceTitle || normalizedHeading.startsWith(`${normalizedSourceTitle} —`)
      ? section.heading
      : `${sourceTitle} — ${section.heading}`;
    const structuredData: JsonObject = {
      source_section: section.heading,
      source_section_order: section.order,
    };
    if (source.knowledgeType === "procedural") {
      const taskKey = procedureTaskKey(section.heading);
      structuredData.procedure = {
        task: { key: taskKey, title: section.heading },
        aliases: [],
        blocks: parseProcedureBlocks(section.content),
      };
    }
    return {
      recordKey: `section-${section.order + 1}-${procedureTaskKey(section.heading) || "knowledge"}`,
      title,
      content: section.content,
      knowledgeType: source.knowledgeType ?? "product",
      authority: source.authority ?? (source.knowledgeType === "policy" ? "authoritative" : "reference"),
      structuredData,
      metadata: { lifecycle_status: "draft", source_section: section.heading, source_section_order: section.order },
      sourceLocation: { section: section.heading, order: section.order },
      taskKey: source.knowledgeType === "procedural" ? procedureTaskKey(section.heading) : null,
      customerAliases: [],
    };
  });
}

function procedureStructuredData(source: KnowledgeSourceInput, initial: JsonObject): JsonObject {
  if (source.knowledgeType !== "procedural") return initial;
  const procedure = initial.procedure && typeof initial.procedure === "object" && !Array.isArray(initial.procedure)
    ? initial.procedure as JsonObject
    : {};
  const explicitBlocks = normalizeProcedureBlocks(
    procedure.blocks ?? initial.procedure_blocks ?? initial.procedure_steps,
  );
  const blocks = explicitBlocks.length ? explicitBlocks : parseProcedureBlocks(source.content);
  const explicitTask = procedure.task && typeof procedure.task === "object" && !Array.isArray(procedure.task)
    ? procedure.task as JsonObject
    : {};
  const taskTitle = cleanText(explicitTask.title) || cleanText(source.title) || "Procedure";
  const taskKey = procedureTaskKey(source.taskKey || explicitTask.key || initial.task_key || taskTitle);
  const aliases = Array.from(new Set([
    ...(source.customerAliases ?? []),
    ...(Array.isArray(procedure.aliases) ? procedure.aliases : []),
    ...(Array.isArray(initial.customer_language_aliases) ? initial.customer_language_aliases : []),
  ].map(cleanText).filter(Boolean))).slice(0, 20);
  return {
    ...initial,
    procedure: {
      ...procedure,
      task: { key: taskKey, title: taskTitle },
      aliases,
      blocks,
    },
    procedure_blocks: blocks,
    // Keep the existing response contract stable while the richer canonical
    // shape is introduced. The renderer can use kind/list_style/source later.
    procedure_steps: blocks,
    task_key: taskKey,
    customer_language_aliases: aliases,
  };
}

/**
 * Exposes a procedure's source paragraphs as ordered, source-bound values.
 * The model may choose which values are relevant, but it cannot rewrite them
 * in the response contract or combine values from different records.
 */
export function extractProcedureSteps(value: string): JsonObject[] {
  const paragraphs = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map(cleanText)
    .filter(Boolean);
  if (!paragraphs.length) return [];

  const first = paragraphs[0];
  const firstLooksLikeHeading = paragraphs.length > 1 && (
    /^faq\b|^manual\b|^questions\b/i.test(first)
    || /\?$/.test(first)
    || /^\d+[.)]\s+.*\?$/.test(first)
    || (!/[.!?]$/.test(first) && !/^[-*•]\s/.test(first) && !/^\d+[.)]\s/.test(first))
  );
  const sourceParagraphs = firstLooksLikeHeading ? paragraphs.slice(1) : paragraphs;
  const steps: JsonObject[] = [];
  for (const paragraph of sourceParagraphs) {
    const lines = paragraph.split(/\n(?=(?:[-*•]|\d+[.)]|[a-z][.)])\s+)/i);
    for (const line of lines) {
      const text = cleanText(line).replace(/^(?:[-*•]|\d+[.)]|[a-z][.)])\s+/i, "").trim();
      if (!text) continue;
      steps.push({ text });
    }
  }
  return steps.slice(0, 64);
}

export function structuredKnowledgeData(record: Pick<KnowledgeRecord, "knowledgeType" | "structuredData" | "content">): JsonObject {
  if (record.knowledgeType !== "procedural") return record.structuredData;
  const rawProcedure = record.structuredData.procedure && typeof record.structuredData.procedure === "object" && !Array.isArray(record.structuredData.procedure)
    ? record.structuredData.procedure as JsonObject
    : null;
  const safeProcedure = rawProcedure
    ? Object.fromEntries(Object.entries(rawProcedure).filter(([key]) => !["aliases", "customer_language_aliases"].includes(key))) as JsonObject
    : null;
  const safeStructuredData = Object.fromEntries(
    Object.entries(record.structuredData).filter(([key]) => !["aliases", "customer_language_aliases"].includes(key)),
  ) as JsonObject;
  const explicit = normalizeProcedureBlocks(
    record.structuredData.procedure_blocks
      ?? record.structuredData.procedure_steps
      ?? (record.structuredData.procedure as JsonObject | undefined)?.blocks,
  );
  return {
    ...safeStructuredData,
    ...(safeProcedure ? { procedure: safeProcedure } : {}),
    procedure_steps: explicit.length ? explicit : extractProcedureSteps(record.content),
  };
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
  for (const match of Array.from(value.matchAll(/<meta\b[^>]*>/gi))) {
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

const MAX_EVIDENCE_CHARS = 3_600;
const MAX_EVIDENCE_SECTIONS = 4;

export interface KnowledgeEvidenceChunk {
  chunkId: string;
  chunkIndex: number;
  content: string;
}

interface EvidenceBlock extends KnowledgeEvidenceChunk {
  isHeading: boolean;
  order: number;
}

interface EvidenceSectionCandidate {
  heading: string;
  blocks: EvidenceBlock[];
  order: number;
}

function isGenericHeading(value: string): boolean {
  const heading = cleanText(value);
  if (!heading || heading.length < 2 || heading.length > 120) return false;
  if (/^(?:[-*•]|\d+[.)])\s*/.test(heading)) return false;
  if (/^(?:https?:\/\/|www\.|mailto:)/i.test(heading)) return false;
  if (/^\d/.test(heading) || /[@|]/.test(heading)) return false;
  if (/[.!?;,:]$/.test(heading)) return false;
  return heading.split(/\s+/).length <= 10;
}

function buildEvidenceSections(chunks: KnowledgeEvidenceChunk[]): EvidenceSectionCandidate[] {
  const orderedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const sections: EvidenceSectionCandidate[] = [];
  let current: EvidenceSectionCandidate = { heading: "Source context", blocks: [], order: 0 };
  let order = 0;

  for (const chunk of orderedChunks) {
    const blocks = chunk.content.split(/\n\s*\n/).map(cleanText).filter(Boolean);
    for (const content of blocks) {
      const isHeading = isGenericHeading(content);
      if (isHeading && current.blocks.some((block) => !block.isHeading)) {
        sections.push(current);
        current = { heading: content, blocks: [], order: sections.length };
      } else if (isHeading && current.blocks.length && current.heading !== "Source context") {
        current.heading = `${current.heading} / ${content}`;
      } else if (isHeading && !current.blocks.length) {
        current.heading = content;
      }
      current.blocks.push({
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        content,
        isHeading,
        order: order++,
      });
    }
  }
  if (current.blocks.length) sections.push(current);

  // A run of labels such as "Compatibility / All" is one structured region.
  // Merge heading-only regions into the following content-bearing region.
  const merged: EvidenceSectionCandidate[] = [];
  for (const section of sections) {
    const hasBody = section.blocks.some((block) => !block.isHeading);
    if (!hasBody && merged.length === 0) {
      merged.push(section);
      continue;
    }
    if (!hasBody && merged.length) {
      const previous = merged[merged.length - 1];
      if (!previous.blocks.some((block) => !block.isHeading)) {
        previous.heading = `${previous.heading} / ${section.heading}`;
        previous.blocks.push(...section.blocks);
      } else {
        merged.push(section);
      }
      continue;
    }
    if (merged.length && !merged[merged.length - 1].blocks.some((block) => !block.isHeading)) {
      const prefix = merged.pop() as EvidenceSectionCandidate;
      section.heading = `${prefix.heading} / ${section.heading}`;
      section.blocks = [...prefix.blocks, ...section.blocks];
    }
    merged.push(section);
  }
  return merged.map((section, index) => ({ ...section, order: index }));
}

function compatibleToken(left: string, right: string): boolean {
  return left === right || (left.length >= 5 && right.length >= 5 && (left.startsWith(right) || right.startsWith(left)));
}

function queryOverlap(queryTokens: Set<string>, value: string): number {
  const candidateTokens = Array.from(new Set(tokens(value)));
  return Array.from(queryTokens).filter((queryToken) => candidateTokens.some((candidate) => compatibleToken(queryToken, candidate))).length;
}

function sectionDistance(section: EvidenceSectionCandidate, selectedIndex: number): number {
  return Math.min(...section.blocks.map((block) => Math.abs(block.chunkIndex - selectedIndex)));
}

function renderEvidenceSection(
  section: EvidenceSectionCandidate,
  queryTokens: Set<string>,
  selectedIndex: number,
  budget: number,
): KnowledgeEvidenceSection | null {
  if (budget < 1) return null;
  const allContent = section.blocks.map((block) => block.content).join("\n\n");
  let selectedBlocks = section.blocks;
  if (allContent.length > budget) {
    const rankedBlocks = section.blocks
      .map((block) => ({
        block,
        score: queryOverlap(queryTokens, block.content) + (block.chunkIndex === selectedIndex ? 0.05 : 0),
        distance: Math.abs(block.chunkIndex - selectedIndex),
      }))
      .sort((left, right) => right.score - left.score || left.distance - right.distance || left.block.order - right.block.order);
    const chosen: EvidenceBlock[] = [];
    let length = 0;
    for (const item of rankedBlocks) {
      const addition = item.block.content.length + (chosen.length ? 2 : 0);
      if (length + addition > budget) continue;
      chosen.push(item.block);
      length += addition;
    }
    selectedBlocks = chosen.sort((left, right) => left.order - right.order);
  }
  if (!selectedBlocks.length) return null;
  const content = selectedBlocks.map((block) => block.content).join("\n\n");
  if (!content) return null;
  return {
    heading: section.heading,
    content,
    chunkIds: Array.from(new Set(selectedBlocks.map((block) => block.chunkId))),
  };
}

/** Select bounded raw evidence sections from chunks already returned for one semantic record. */
export function selectEvidenceSections(
  chunks: KnowledgeEvidenceChunk[],
  selectedIndex: number,
  query: string,
  maxChars = MAX_EVIDENCE_CHARS,
): KnowledgeEvidenceSection[] {
  const sections = buildEvidenceSections(chunks);
  if (!sections.length || maxChars <= 0) return [];
  const queryTokens = new Set(tokens(query));
  const scored = sections.map((section) => {
    const overlap = queryOverlap(queryTokens, `${section.heading}\n${section.blocks.map((block) => block.content).join("\n")}`);
    const distance = sectionDistance(section, selectedIndex);
    const containsSelected = section.blocks.some((block) => block.chunkIndex === selectedIndex);
    return {
      section,
      overlap,
      distance,
      containsSelected,
      score: overlap + (containsSelected ? 0.05 : 0) + (overlap ? 0.02 / (distance + 1) : 0),
    };
  });
  const eligible = scored.filter((item) => item.overlap > 0 || item.containsSelected);
  const ranked = (eligible.length ? eligible : scored.filter((item) => item.containsSelected)).sort(
    (left, right) => right.score - left.score || right.overlap - left.overlap || left.distance - right.distance || left.section.order - right.section.order,
  );

  const selected: KnowledgeEvidenceSection[] = [];
  let remaining = maxChars;
  for (const item of ranked.slice(0, MAX_EVIDENCE_SECTIONS)) {
    const evidence = renderEvidenceSection(item.section, queryTokens, selectedIndex, remaining);
    if (!evidence) continue;
    selected.push(evidence);
    remaining -= evidence.content.length + 2;
    if (remaining <= 0) break;
  }
  return selected;
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
  return procedureStructuredData(source, result);
}

function procedureChunkContent(content: string, structuredData: JsonObject, knowledgeType: KnowledgeType): string {
  if (knowledgeType !== "procedural") return content;
  const blocks = normalizeProcedureBlocks(structuredData.procedure_blocks ?? structuredData.procedure_steps);
  if (!blocks.length) return content;
  return blocks.map((block) => block.text).join("\n\n");
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
  const normalizedSource = { ...source, content, knowledgeType: classification.knowledgeType };
  const structuredData = extractStructuredData(normalizedSource);
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
    structuredData,
    sourceKind: cleanText(source.sourceKind),
    sourceId: cleanText(source.sourceId),
    sourceUri: cleanText(source.sourceUri) || null,
    sourceLabel: cleanText(source.sourceLabel) || null,
    contentHash,
    publishedAt: cleanText(source.publishedAt) || null,
    observedAt: cleanText(source.observedAt) || null,
    expiresAt: cleanText(source.expiresAt) || null,
    metadata: { ...(source.metadata ?? {}) },
    chunks: splitIntoChunks(procedureChunkContent(content, structuredData, classification.knowledgeType)),
    sourceVersion: source.sourceVersion == null ? null : Math.max(1, Number(source.sourceVersion) || 1),
    sourceContentHash: cleanText(source.sourceContentHash) || null,
    sourceLocation: source.sourceLocation && typeof source.sourceLocation === "object" ? source.sourceLocation : null,
    sourceRecordKey: cleanText(source.sourceRecordKey) || null,
    taskKey: cleanText(source.taskKey) || cleanText((structuredData.procedure as JsonObject | undefined)?.task_key) || cleanText(structuredData.task_key) || null,
    customerAliases: Array.from(new Set((source.customerAliases ?? []).map(cleanText).filter(Boolean))),
  };
}

export async function normalizeKnowledgeSourceDocument(
  workspaceId: string,
  source: KnowledgeSourceDocumentInput,
): Promise<{ source: KnowledgeSourceInput; records: KnowledgeRecord[]; sourceContentHash: string }> {
  const normalizedContent = cleanRawContent(source.content);
  if (!normalizedContent) throw new Error("Knowledge source content is required.");
  if (!cleanText(source.sourceKind) || !cleanText(source.sourceId)) {
    throw new Error("Knowledge provenance requires sourceKind and sourceId.");
  }
  const sourceContentHash = await sha256([cleanText(workspaceId), cleanText(source.sourceKind), cleanText(source.sourceId), normalizedContent].join("\u001f"));
  const sourceBase: KnowledgeSourceInput = {
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    title: source.title,
    content: normalizedContent,
    sourceUri: source.sourceUri,
    sourceLabel: source.sourceLabel,
    sourceVersion: source.sourceVersion ?? 1,
    sourceContentHash,
    metadata: source.metadata,
  };
  const records = [];
  for (const candidate of source.candidates) {
    records.push(await normalizeKnowledgeSource(workspaceId, {
      ...sourceBase,
      sourceRecordKey: candidate.recordKey,
      title: candidate.title,
      content: candidate.content,
      knowledgeType: candidate.knowledgeType,
      authority: candidate.authority,
      structuredData: candidate.structuredData,
      metadata: { ...(source.metadata ?? {}), ...(candidate.metadata ?? {}) },
      sourceLocation: candidate.sourceLocation,
      taskKey: candidate.taskKey,
      customerAliases: candidate.customerAliases,
    }));
  }
  return { source: sourceBase, records, sourceContentHash };
}

function isExpired(record: KnowledgeRecord, now: number): boolean {
  if (!record.expiresAt) return false;
  const expiry = Date.parse(record.expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

function isPublished(record: KnowledgeRecord | { metadata?: JsonObject }): boolean {
  const lifecycle = String(record.metadata?.lifecycle_status ?? "").trim().toLowerCase();
  return !["draft", "unpublished", "archived"].includes(lifecycle);
}

function normalizedProductText(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lexicalQueryVariants(query: string): string[] {
  const source = cleanText(query);
  const variants = new Set<string>(source ? [source] : []);
  const words = source.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? [];
  for (let index = 0; index < words.length; index += 1) {
    if (!words[index].includes("-")) continue;
    const phrase = [words[index]];
    for (let next = index + 1; next < words.length && phrase.length < 4; next += 1) {
      if (!/^[A-Z][A-Za-z0-9-]*$/.test(words[next])) break;
      phrase.push(words[next]);
    }
    variants.add(phrase.join(" "));
  }
  return Array.from(variants).slice(0, 4);
}

function applicableProductScore(row: any, query: string): number {
  const models = rowProductModels(row);
  const normalizedQuery = normalizedProductText(query);
  return models.reduce((best: number, model: string) => (
    normalizedQuery.includes(model) ? Math.max(best, model.length) : best
  ), 0);
}

function rowProductModels(row: any): string[] {
  const structuredModels = Array.isArray(row?.structured_data?.applies_to?.product_models)
    ? row.structured_data.applies_to.product_models
    : [];
  const metadataModels = Array.isArray(row?.metadata?.applies_to?.product_models)
    ? row.metadata.applies_to.product_models
    : [];
  return [...structuredModels, ...metadataModels].map(normalizedProductText).filter(Boolean);
}

function rowProcedureMetadata(row: any): { taskKey: string | null; title: string; aliases: string[] } {
  const structuredData = row?.structured_data
    ?? row?.record?.record?.structuredData
    ?? row?.record?.structuredData
    ?? {};
  const procedure = structuredData?.procedure && typeof structuredData.procedure === "object" && !Array.isArray(structuredData.procedure)
    ? structuredData.procedure
    : {};
  const task = procedure.task && typeof procedure.task === "object" && !Array.isArray(procedure.task)
    ? procedure.task
    : {};
  const aliases = [
    ...(Array.isArray(row?.customer_aliases) ? row.customer_aliases : []),
    ...(Array.isArray(row?.record?.record?.customerAliases) ? row.record.record.customerAliases : []),
    ...(Array.isArray(procedure.aliases) ? procedure.aliases : []),
    ...(Array.isArray(procedure.customer_language_aliases) ? procedure.customer_language_aliases : []),
    ...(Array.isArray(structuredData.customer_language_aliases) ? structuredData.customer_language_aliases : []),
  ].map(cleanText).filter(Boolean);
  return {
    taskKey: cleanText(row?.task_key ?? task.key ?? structuredData.task_key) || null,
    title: cleanText(task.title ?? row?.title),
    aliases: Array.from(new Set(aliases)),
  };
}

function rowRelevanceText(row: any): string {
  const title = cleanText(row?.title);
  const chunk = cleanText(row?.chunk_content ?? row?.content ?? "");
  const knowledgeType = String(row?.knowledge_type ?? row?.record?.record?.knowledgeType ?? row?.record?.knowledgeType ?? "");
  if (knowledgeType === "procedural" || row?.structured_data?.procedure) {
    const procedure = rowProcedureMetadata(row);
    // A canonical task key is the stable task identity. Display titles may
    // contain secondary actions such as "re-pair" and should not make two
    // distinct procedures compete as the same task.
    return procedure.taskKey
      ? [procedure.taskKey, ...procedure.aliases].filter(Boolean).join(" ")
      : [title, procedure.title, ...procedure.aliases].filter(Boolean).join(" ");
  }
  if (title) return title;
  return chunk.split(/\n\s*\n/)[0] ?? "";
}

function rowProcedureCandidate(row: any): KnowledgeProcedureCandidate {
  const procedure = rowProcedureMetadata(row);
  return { taskKey: procedure.taskKey, title: procedure.title || cleanText(row?.title) || "Procedure" };
}

function tokenForms(token: string): Set<string> {
  const forms = new Set([token]);
  if (token.length >= 6 && token.endsWith("ing")) forms.add(token.slice(0, -3));
  if (token.length >= 5 && token.endsWith("ed")) forms.add(token.slice(0, -2));
  if (token.length >= 5 && token.endsWith("s")) forms.add(token.slice(0, -1));
  if (token.length >= 7 && token.startsWith("re")) forms.add(token.slice(2));
  return forms;
}

function taskTokensMatch(left: string, right: string): boolean {
  const leftForms = tokenForms(left);
  const rightForms = tokenForms(right);
  return Array.from(leftForms).some((leftForm) => Array.from(rightForms).some((rightForm) => compatibleToken(leftForm, rightForm)));
}

interface TaskRelevanceSignals {
  score: number;
  matches: number;
  titleMatches: number;
  bodyMatches: number;
  matchedTerms: string[];
  queryTerms: number;
}

function productTokenSet(rows: any[], productContext: KnowledgeProductContext | null): Set<string> {
  const values = [
    ...(productContext?.productModels ?? []),
    ...rows.flatMap((row) => rowProductModels(row)),
  ];
  return new Set(values.flatMap((value) => tokens(value)));
}

function taskRelevanceSignals(rows: any[], query: string, productContext: KnowledgeProductContext | null): Map<string, TaskRelevanceSignals> {
  const productTokens = productTokenSet(rows, productContext);
  const queryTokens = Array.from(new Set(tokens(query))).filter((token) => !productTokens.has(token) && !TASK_CONTEXT_WORDS.has(token));
  const documentTokens = rows.map((row) => new Set(tokens(rowRelevanceText(row)).filter((token) => !productTokens.has(token) && !TASK_CONTEXT_WORDS.has(token))));
  const documentFrequency = new Map<string, number>();
  for (const queryToken of queryTokens) {
    const frequency = documentTokens.filter((candidateTokens) => Array.from(candidateTokens).some((candidateToken) => taskTokensMatch(queryToken, candidateToken))).length;
    documentFrequency.set(queryToken, frequency);
  }
  // Terms shared by most candidate titles/headings describe the product or
  // channel, not the customer's specific task. Keep recall broad, but do not
  // let those terms decide which evidence is primary.
  const hasExplicitProductSignal = Boolean(productContext)
    || rows.some((row) => rowProductModels(row).some((model) => normalizedProductText(query).includes(model)));
  const genericThreshold = rows.length <= 2 && hasExplicitProductSignal
    ? 3
    : Math.max(2, Math.ceil(rows.length * 0.4));
  const taskTerms = queryTokens.filter((token) => (documentFrequency.get(token) ?? 0) < genericThreshold);
  const signals = new Map<string, TaskRelevanceSignals>();
  for (const row of rows) {
    const relevanceText = rowRelevanceText(row);
    const relevanceTokens = new Set(tokens(relevanceText).filter((token) => !productTokens.has(token) && !TASK_CONTEXT_WORDS.has(token)));
    const matchingTerms = taskTerms.filter((queryToken) => Array.from(relevanceTokens).some((candidateToken) => taskTokensMatch(queryToken, candidateToken)));
    const bodyTokens = new Set(tokens(cleanText(row?.content ?? row?.chunk_content ?? "")).filter((token) => !productTokens.has(token) && !TASK_CONTEXT_WORDS.has(token)));
    const bodyMatches = taskTerms.filter((queryToken) => Array.from(bodyTokens).some((candidateToken) => taskTokensMatch(queryToken, candidateToken))).length;
    const coverage = matchingTerms.length / Math.max(taskTerms.length, 1);
    const boundedBodySupport = Math.min(0.2, bodyMatches * 0.05);
    signals.set(rowRelevanceKey(row), {
      score: Math.min(1, coverage + boundedBodySupport),
      matches: matchingTerms.length,
      titleMatches: matchingTerms.length,
      bodyMatches,
      matchedTerms: matchingTerms,
      queryTerms: taskTerms.length,
    });
  }
  return signals;
}

function rowRelevanceKey(row: any): string {
  return String(
    row?.id
      ?? row?.source_id
      ?? row?.content_hash
      ?? row?.record?.record?.id
      ?? row?.record?.record?.sourceId
      ?? row?.record?.record?.contentHash
      ?? "",
  );
}

function sortKnowledgeRows(rows: any[], query: string, productContext: KnowledgeProductContext | null): { rows: any[]; signals: Map<string, TaskRelevanceSignals> } {
  const signals = taskRelevanceSignals(rows, query, productContext);
  const hasApplicableProduct = rows.some((row) => applicableProductScore(row, query) > 0);
  const hasTaskSignal = rows.some((row) => (signals.get(rowRelevanceKey(row))?.score ?? 0) > 0);
  const sorted = [...rows].sort((left, right) => {
    if (hasTaskSignal) {
      const taskDifference = (signals.get(rowRelevanceKey(right))?.score ?? 0) - (signals.get(rowRelevanceKey(left))?.score ?? 0);
      if (taskDifference) return taskDifference;
    }
    // Applicability is a constraint before ranking. When a generic procedure
    // and an exact product procedure are both eligible, the customer's task
    // signal must decide which evidence is primary.
    if (hasApplicableProduct) {
      const productDifference = applicableProductScore(right, query) - applicableProductScore(left, query);
      if (productDifference) return productDifference;
    }
    return Number(right.score ?? 0) - Number(left.score ?? 0)
      || String(right.observed_at ?? "").localeCompare(String(left.observed_at ?? ""));
  });
  return { rows: sorted, signals };
}

function procedureSelectionInfo(rows: any[], signals: Map<string, TaskRelevanceSignals>, query: string): {
  taskSpecificity: "sufficient" | "insufficient";
  procedureCandidates: KnowledgeProcedureCandidate[];
} {
  const procedureRows = rows.filter((row) => String(row?.knowledge_type ?? row?.record?.record?.knowledgeType ?? row?.record?.knowledgeType ?? "") === "procedural");
  const procedureCandidates = Array.from(new Map(
    procedureRows
      .map((row) => ({ row, metadata: rowProcedureMetadata(row) }))
      // Legacy bundled procedure rows can remain searchable, but they do not
      // provide a canonical task label that is safe to offer for clarification.
      .filter(({ metadata }) => Boolean(metadata.taskKey))
      .map(({ row }) => {
        const candidate = rowProcedureCandidate(row);
        return [`${candidate.taskKey ?? ""}:${candidate.title.toLowerCase()}`, candidate] as const;
      }),
  ).values()).slice(0, 8);
  if (procedureRows.length <= 1) {
    if (!procedureRows.length) return { taskSpecificity: "insufficient", procedureCandidates };
    const onlySignal = signals.get(rowRelevanceKey(procedureRows[0]));
    const canonicalTask = rowProcedureMetadata(procedureRows[0]).taskKey;
    return {
      // A canonical single procedure can answer a broad query. A legacy
      // bundled row without a task identity cannot: it must not become a
      // back door for arbitrary procedural disclosure.
      taskSpecificity: canonicalTask || (onlySignal?.titleMatches ?? 0) > 0 ? "sufficient" : "insufficient",
      procedureCandidates,
    };
  }

  const directTaskCandidates = procedureRows
    .map((row) => ({ row, signal: signals.get(rowRelevanceKey(row)) }))
    .filter(({ signal }) => (signal?.titleMatches ?? 0) > 0)
    .sort((left, right) => (
      (right.signal?.score ?? 0) - (left.signal?.score ?? 0)
      || Number(right.row.score ?? 0) - Number(left.row.score ?? 0)
    ));
  if (!directTaskCandidates.length || directTaskCandidates.length === 1) {
    return { taskSpecificity: directTaskCandidates.length ? "sufficient" : "insufficient", procedureCandidates };
  }

  // Two procedures matching the same customer term are competing answers.
  // A semantic tie cannot break that competition safely; a larger explicit
  // task match can, while disjoint matches represent an explicit multi-task.
  const top = directTaskCandidates[0].signal!;
  const second = directTaskCandidates[1].signal!;
  const sharedTerms = top.matchedTerms.filter((term) => second.matchedTerms.includes(term));
  const clearTaskWinner = top.matches > second.matches;
  const productScores = directTaskCandidates.map(({ row }) => applicableProductScore(row, query));
  const highestProductScore = Math.max(...productScores);
  const hasUniqueProductWinner = highestProductScore > 0
    && productScores.filter((score) => score === highestProductScore).length === 1;
  return {
    taskSpecificity: sharedTerms.length && !clearTaskWinner && !hasUniqueProductWinner ? "insufficient" : "sufficient",
    procedureCandidates,
  };
}

function selectKnowledgeRows(rows: any[], query: string, productContext: KnowledgeProductContext | null, finalLimit: number, knowledgeTypes?: KnowledgeType[]): {
  rows: any[];
  signals: Map<string, TaskRelevanceSignals>;
  taskSpecificity?: "sufficient" | "insufficient";
  procedureCandidates?: KnowledgeProcedureCandidate[];
} {
  const ranked = sortKnowledgeRows(rows, query, productContext);
  if (!knowledgeTypes?.includes("procedural") || !ranked.rows.length) {
    return { rows: ranked.rows.slice(0, finalLimit), signals: ranked.signals };
  }

  const procedureInfo = procedureSelectionInfo(ranked.rows, ranked.signals, query);
  if (procedureInfo.taskSpecificity === "insufficient") {
    return {
      rows: ranked.rows.slice(0, 1),
      signals: ranked.signals,
      ...procedureInfo,
    };
  }

  const top = ranked.rows[0];
  const topSignal = ranked.signals.get(rowRelevanceKey(top))?.score ?? 0;
  const selected = ranked.rows.filter((row, index) => {
    if (index === 0) return true;
    const candidateSignal = ranked.signals.get(rowRelevanceKey(row));
    const signal = candidateSignal?.score ?? 0;
    const topMatches = ranked.signals.get(rowRelevanceKey(top))?.matchedTerms ?? [];
    const candidateMatches = candidateSignal?.matchedTerms ?? [];
    const separateTask = candidateMatches.some((term) => !topMatches.includes(term));
    // A second procedure is retained only when it independently matches the
    // task and is close enough to be complementary evidence.
    return signal > 0
      && (candidateSignal?.titleMatches ?? 0) > 0
      && (signal >= topSignal * 0.75 || separateTask);
  });
  return { rows: selected.slice(0, finalLimit), signals: ranked.signals, ...procedureInfo };
}

function relevantToExplicitQuery(row: any, request: KnowledgeSearchRequest, productContext: KnowledgeProductContext | null): boolean {
  if (isKnowledgeRecordApplicable({
    workspaceId: String(row.workspace_id ?? request.workspaceId),
    metadata: row.metadata ?? {},
  }, productContext)) return true;
  // A customer-named product is a retrieval hint, not authorization. It may
  // surface a matching scoped record when no trusted catalog binding exists;
  // tenant/workspace filtering remains server-owned and unchanged.
  if (productContext) return false;
  const models = Array.isArray(row?.metadata?.applies_to?.product_models)
    ? row.metadata.applies_to.product_models.map(normalizedProductText).filter(Boolean)
    : [];
  const query = normalizedProductText(request.query);
  return models.some((model: string) => query.includes(model));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean)
    : [];
}

/**
 * Applicability is a deterministic constraint around semantic retrieval.
 * Product ids are the stronger representation when both representations exist.
 */
export function isKnowledgeRecordApplicable(
  record: Pick<KnowledgeRecord, "workspaceId" | "metadata">,
  productContext?: KnowledgeProductContext | null,
): boolean {
  const appliesTo = record.metadata?.applies_to;
  if (!appliesTo || typeof appliesTo !== "object" || Array.isArray(appliesTo)) return true;

  const rawProductIds = (appliesTo as JsonObject).product_ids;
  const productIds = stringList(rawProductIds);
  const hasProductIdRestriction = rawProductIds != null && (!Array.isArray(rawProductIds) || rawProductIds.length > 0);
  const productModels = stringList((appliesTo as JsonObject).product_models);
  if (!hasProductIdRestriction && !productModels.length) return true;
  if (!productContext || productContext.workspaceId !== record.workspaceId) return false;

  if (hasProductIdRestriction) {
    return productIds.includes(cleanText(productContext.productId));
  }

  const contextModels = productContext.productModels.map(normalizedProductText).filter(Boolean);
  return productModels
    .map(normalizedProductText)
    .filter(Boolean)
    .some((model) => contextModels.includes(model));
}

function freshnessScore(record: KnowledgeRecord, now: number): number {
  const date = Date.parse(record.observedAt || record.publishedAt || "");
  if (!Number.isFinite(date)) return 0.5;
  const ageDays = Math.max(0, (now - date) / 86_400_000);
  return Math.max(0.35, 1 - ageDays / 365);
}

function searchRecord(record: KnowledgeRecord, query: string, now: number): KnowledgeHit | null {
  if (record.knowledgeType === "live_operational") return null;
  if (!isPublished(record)) return null;
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

  async ingestSource(workspaceId: string, source: KnowledgeSourceDocumentInput) {
    const normalized = await normalizeKnowledgeSourceDocument(workspaceId, source);
    const candidateKeys = new Set(normalized.records.map((record) => record.sourceRecordKey).filter(Boolean));
    for (const [key, existing] of Array.from(this.records.entries())) {
      if (
        existing.workspaceId === workspaceId
        && existing.sourceId === source.sourceId
        && existing.sourceRecordKey
        && !candidateKeys.has(existing.sourceRecordKey)
      ) {
        this.records.set(key, {
          ...existing,
          metadata: { ...existing.metadata, lifecycle_status: "unpublished", source_refresh_state: "removed" },
        });
      }
    }
    const records: KnowledgeRecord[] = [];
    for (const record of normalized.records) {
      const existingEntry = Array.from(this.records.entries()).find(([, existing]) => (
        existing.workspaceId === workspaceId
        && existing.sourceId === record.sourceId
        && existing.sourceRecordKey === record.sourceRecordKey
      ));
      if (existingEntry && existingEntry[1].contentHash !== record.contentHash) this.records.delete(existingEntry[0]);
      records.push(await this.ingest(workspaceId, record));
    }
    return { sourceId: source.sourceId, sourceVersion: normalized.records[0]?.sourceVersion ?? source.sourceVersion ?? 1, records };
  }

  async replaceSource(workspaceId: string, sourceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord> {
    const normalizedWorkspaceId = cleanText(workspaceId);
    const normalizedSourceId = cleanText(sourceId);
    if (!normalizedWorkspaceId || !normalizedSourceId || cleanText(source.sourceId) !== normalizedSourceId) {
      throw new Error("Source replacement requires matching workspace and source identity.");
    }
    const replacement = await this.ingest(normalizedWorkspaceId, source);
    for (const [key, record] of Array.from(this.records.entries())) {
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
    const eligibleRecords = Array.from(this.records.values())
      .filter((record) => record.workspaceId === workspaceId)
      .filter((record) => !allowedTypes || allowedTypes.has(record.knowledgeType))
      .filter((record) => isKnowledgeRecordApplicable(record, request.productContext));
    const hits = eligibleRecords
      .map((record) => searchRecord(record, request.query, now))
      .filter(Boolean) as KnowledgeHit[];
    const rows = hits.map((hit) => ({
      id: hit.record.id,
      score: hit.score,
      observed_at: hit.record.observedAt,
      structured_data: hit.record.structuredData,
      metadata: hit.record.metadata,
      title: hit.record.title,
      content: hit.record.content,
      chunk_content: hit.record.chunks[0] ?? hit.record.content,
      record: hit,
    }));
    const selected = selectKnowledgeRows(
      rows,
      request.taskQuery ?? request.query,
      request.productContext ?? null,
      Math.max(1, Math.min(request.limit ?? 5, 20)),
      request.knowledgeTypes,
    );
    return selected.rows.map((row, index) => ({
      ...row.record,
      taskRelevance: selected.signals.get(rowRelevanceKey(row))?.score ?? 0,
      taskTitleMatches: selected.signals.get(rowRelevanceKey(row))?.titleMatches ?? 0,
      taskBodyMatches: selected.signals.get(rowRelevanceKey(row))?.bodyMatches ?? 0,
      rank: index + 1,
      taskSpecificity: selected.taskSpecificity,
      procedureCandidates: selected.procedureCandidates,
    }));
  }
}

/** Production adapter. The RPC is tenant-filtered again in SQL, not just here. */
export class SupabaseKnowledgeStore implements KnowledgeStore {
  constructor(private readonly serviceClient: any) {}

  private readonly productContextCache = new Map<string, KnowledgeProductContext | null>();

  private async resolveProductContext(request: KnowledgeSearchRequest): Promise<KnowledgeProductContext | null> {
    const shopId = cleanText(request.trustedShopId);
    if (!shopId) return null;
    const cacheKey = `${request.workspaceId}:${shopId}:${normalizedProductText(request.query)}`;
    if (this.productContextCache.has(cacheKey)) return this.productContextCache.get(cacheKey) ?? null;

    const { data: shop, error: shopError } = await this.serviceClient
      .from("shops")
      .select("id")
      .eq("id", shopId)
      .eq("workspace_id", request.workspaceId)
      .eq("platform", "shopify")
      .is("uninstalled_at", null)
      .maybeSingle();
    if (shopError) throw new Error(shopError.message);
    if (!shop?.id) {
      this.productContextCache.set(cacheKey, null);
      return null;
    }

    const { data, error } = await this.serviceClient
      .from("shop_products")
      .select("id,title,handle,external_id")
      .eq("shop_ref_id", shop.id)
      .limit(5000);
    if (error) throw new Error(error.message);
    const normalizedQuery = normalizedProductText(request.query);
    const candidates = (Array.isArray(data) ? data : [])
      .map((product: any) => ({
        product,
        identities: [product?.title, product?.handle]
          .map(normalizedProductText)
          .filter(Boolean),
      }))
      .filter(({ identities }) => identities.some((identity) => normalizedQuery.includes(identity)))
      .sort((left, right) => Math.max(...right.identities.map((value) => value.length)) - Math.max(...left.identities.map((value) => value.length)));

    const strongestLength = candidates.length
      ? Math.max(...candidates[0].identities.map((value: string) => value.length))
      : 0;
    const strongest = candidates.filter(({ identities }) => identities.some((identity) => identity.length === strongestLength));
    // `shop_products.id` is an internal mirror key, not the merchant's
    // Shopify product identity. Applicability metadata is bound to the
    // verified external Shopify id; never fall back to the mirror key.
    const verifiedShopifyProductId = cleanText(strongest[0]?.product?.external_id);
    const context = strongest.length === 1 && verifiedShopifyProductId
      ? {
          workspaceId: request.workspaceId,
          productId: verifiedShopifyProductId,
          productModels: [strongest[0].product?.title, strongest[0].product?.handle].map(cleanText).filter(Boolean),
        }
      : null;
    this.productContextCache.set(cacheKey, context);
    return context;
  }

  private async loadEvidenceSections(workspaceId: string, rows: any[], query: string): Promise<Map<string, KnowledgeEvidenceSection[]>> {
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

    const sections = new Map<string, KnowledgeEvidenceSection[]>();
    for (const row of rows) {
      const recordId = String(row.id ?? "");
      const selectedIndex = Number(row.chunk_index ?? 0);
      const chunks = chunksByRecord.get(recordId) ?? [];
      const selectedChunkId = String(row.chunk_id ?? "");
      if (selectedChunkId && !chunks.some((chunk) => chunk.id === selectedChunkId)) {
        chunks.push({
          id: selectedChunkId,
          index: selectedIndex,
          content: String(row.chunk_content ?? ""),
        });
      }
      sections.set(recordId, selectEvidenceSections(
        chunks.map((chunk) => ({ chunkId: chunk.id, chunkIndex: chunk.index, content: chunk.content })),
        selectedIndex,
        query,
      ));
    }
    return sections;
  }

  private async lexicalFallbackRows(request: KnowledgeSearchRequest, query: string, limit: number): Promise<any[]> {
    const rows: any[] = [];
    for (const variant of lexicalQueryVariants(query)) {
      const { data, error } = await this.serviceClient.rpc("greenfield_search_knowledge", {
        p_workspace_id: request.workspaceId,
        p_query: variant,
        p_knowledge_types: request.knowledgeTypes ?? null,
        p_limit: limit,
      });
      // Semantic retrieval remains the primary path. A lexical miss or an
      // unavailable fallback must not turn a successful semantic lookup into
      // a tool failure.
      if (error || !Array.isArray(data)) continue;
      rows.push(...data);
    }
    const unique = new Map<string, any>();
    for (const row of rows) {
      const id = String(row?.id ?? "");
      if (id && !unique.has(id)) unique.set(id, row);
    }
    return Array.from(unique.values());
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

  private async ensureChunkEmbeddings(workspaceId: string, recordId: string): Promise<void> {
    const { data, error } = await this.serviceClient
      .from("greenfield_knowledge_chunks")
      .select("id,content,embedding")
      .eq("workspace_id", workspaceId)
      .eq("record_id", recordId)
      .order("chunk_index");
    if (error) throw new Error(error.message);
    for (const chunk of Array.isArray(data) ? data : []) {
      if (chunk.embedding) continue;
      const embedding = await this.embedQuery(String(chunk.content ?? ""));
      const result = await this.serviceClient
        .from("greenfield_knowledge_chunks")
        .update({ embedding: `[${embedding.join(",")}]` })
        .eq("id", chunk.id)
        .eq("workspace_id", workspaceId);
      if (result.error) throw new Error(result.error.message);
    }
  }

  private async persistRecord(record: KnowledgeRecord, sourceUuid?: string | null): Promise<KnowledgeRecord> {
    let payload = {
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
      ...(sourceUuid ? { source_uuid: sourceUuid } : {}),
      ...(record.sourceVersion != null ? { source_version: record.sourceVersion } : {}),
      ...(record.sourceContentHash ? { source_content_hash: record.sourceContentHash } : {}),
      ...(record.sourceLocation ? { source_location: record.sourceLocation } : {}),
      ...(record.sourceRecordKey ? { source_record_key: record.sourceRecordKey } : {}),
      ...(record.taskKey ? { task_key: record.taskKey } : {}),
      ...(record.customerAliases?.length ? { customer_aliases: record.customerAliases } : {}),
    };
    const conflictTarget = record.sourceRecordKey
      ? "workspace_id,source_id,source_record_key"
      : "workspace_id,content_hash";
    let existingId: string | null = null;
    let existingContentHash: string | null = null;
    let matchedBySourceKey = false;
    if (record.sourceRecordKey) {
      const existingByKey = await this.serviceClient
        .from("greenfield_knowledge_records")
        .select("id,content_hash,metadata,source_kind,source_id,source_uri,source_label")
        .eq("workspace_id", record.workspaceId)
        .eq("source_id", record.sourceId)
        .eq("source_record_key", record.sourceRecordKey)
        .maybeSingle();
      if (existingByKey.error) throw new Error(existingByKey.error.message);
      existingId = existingByKey.data?.id ? String(existingByKey.data.id) : null;
      existingContentHash = existingByKey.data?.content_hash ? String(existingByKey.data.content_hash) : null;
      matchedBySourceKey = Boolean(existingId);
      const existing = existingId ? existingByKey : await this.serviceClient
        .from("greenfield_knowledge_records")
        .select("id,content_hash,metadata,source_kind,source_id,source_uri,source_label")
        .eq("workspace_id", record.workspaceId)
        .eq("content_hash", record.contentHash)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (!existingId) {
        existingId = existing.data?.id ? String(existing.data.id) : null;
        existingContentHash = existing.data?.content_hash ? String(existing.data.content_hash) : null;
      }
      if (existingId) {
        // Reusing an existing raw Greenfield record must not silently turn a
        // published legacy record into a draft. Source linkage is additive;
        // its current lifecycle/applicability remains authoritative.
        payload = { ...payload, metadata: { ...(record.metadata ?? {}), ...(existing.data?.metadata ?? {}) } };
        if (!matchedBySourceKey) {
          // Content-hash adoption is the compatibility path for the 24-record
          // legacy DEV corpus. Keep its original external provenance while
          // attaching the new first-class source relation.
          payload = {
            ...payload,
            source_kind: existing.data?.source_kind ?? payload.source_kind,
            source_id: existing.data?.source_id ?? payload.source_id,
            source_uri: existing.data?.source_uri ?? payload.source_uri,
            source_label: existing.data?.source_label ?? payload.source_label,
          };
        }
      }
    }
    const result = existingId
      ? await this.serviceClient.from("greenfield_knowledge_records").update(payload).eq("id", existingId).eq("workspace_id", record.workspaceId).select("*").single()
      : await this.serviceClient.from("greenfield_knowledge_records").upsert(payload, { onConflict: conflictTarget }).select("*").single();
    const { data, error } = result;
    if (error || !data?.id) throw new Error(error?.message || "Could not store greenfield knowledge record.");

    // A same-hash source update preserves the canonical record and derived
    // chunks. Changed content gets a clean derived index, while drafts remain
    // cheap to review. Published records also repair missing embeddings from
    // legacy or interrupted ingestion without changing canonical content.
    const contentChanged = Boolean(existingId && existingContentHash && existingContentHash !== record.contentHash);
    if (!existingId || contentChanged) {
      if (contentChanged) {
        const deleteChunks = await this.serviceClient
          .from("greenfield_knowledge_chunks")
          .delete()
          .eq("workspace_id", record.workspaceId)
          .eq("record_id", data.id);
        if (deleteChunks.error) throw new Error(deleteChunks.error.message);
      }
      const chunks = record.chunks.map((content, chunkIndex) => ({
        workspace_id: record.workspaceId,
        record_id: data.id,
        chunk_index: chunkIndex,
        content,
      }));
      if (chunks.length) {
        const chunkResult = await this.serviceClient
          .from("greenfield_knowledge_chunks")
          .insert(chunks);
        if (chunkResult.error) throw new Error(chunkResult.error.message);
      }
    }
    // Draft candidates are intentionally usable for review without paying for
    // embeddings. A published record must have every derived chunk indexed,
    // including when it was adopted from an older Greenfield row.
    if (isPublished({ metadata: payload.metadata })) await this.ensureChunkEmbeddings(record.workspaceId, String(data.id));
    return { ...record, id: String(data.id) };
  }

  async ingest(workspaceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord> {
    const normalized = await normalizeKnowledgeSource(workspaceId, source);
    return this.persistRecord(normalized);
  }

  async ingestSource(workspaceId: string, source: KnowledgeSourceDocumentInput) {
    const normalized = await normalizeKnowledgeSourceDocument(workspaceId, source);
    const sourceLookup = await this.serviceClient
      .from("greenfield_knowledge_sources")
      .select("id,source_version,content_hash")
      .eq("workspace_id", workspaceId)
      .eq("source_kind", source.sourceKind)
      .eq("source_id", source.sourceId)
      .maybeSingle();
    if (sourceLookup.error) throw new Error(sourceLookup.error.message);
    const currentVersion = Number(sourceLookup.data?.source_version ?? 0);
    const sourceVersion = sourceLookup.data && sourceLookup.data.content_hash !== normalized.sourceContentHash
      ? currentVersion + 1
      : currentVersion || Number(source.sourceVersion ?? 1);
    const sourceRow = await this.serviceClient
      .from("greenfield_knowledge_sources")
      .upsert({
        workspace_id: workspaceId,
        source_kind: source.sourceKind,
        source_id: source.sourceId,
        title: cleanText(source.title) || source.sourceId,
        raw_content: source.content,
        normalized_content: normalized.source.content,
        source_uri: cleanText(source.sourceUri) || null,
        source_label: cleanText(source.sourceLabel) || null,
        content_hash: normalized.sourceContentHash,
        source_version: sourceVersion,
        status: "draft",
        metadata: source.metadata ?? {},
      }, { onConflict: "workspace_id,source_kind,source_id" })
      .select("id")
      .single();
    if (sourceRow.error || !sourceRow.data?.id) throw new Error(sourceRow.error?.message || "Could not store greenfield knowledge source.");

    const candidateKeys = new Set(normalized.records.map((record) => record.sourceRecordKey).filter(Boolean));
    const existing = await this.serviceClient
      .from("greenfield_knowledge_records")
      .select("id,source_record_key,metadata")
      .eq("workspace_id", workspaceId)
      .eq("source_uuid", sourceRow.data.id);
    if (existing.error) throw new Error(existing.error.message);
    for (const row of Array.isArray(existing.data) ? existing.data : []) {
      if (!row.source_record_key || candidateKeys.has(row.source_record_key)) continue;
      const metadata = { ...(row.metadata ?? {}), lifecycle_status: "unpublished", source_refresh_state: "removed" };
      const update = await this.serviceClient
        .from("greenfield_knowledge_records")
        .update({ metadata })
        .eq("workspace_id", workspaceId)
        .eq("id", row.id);
      if (update.error) throw new Error(update.error.message);
    }

    const records: KnowledgeRecord[] = [];
    for (const record of normalized.records) {
      records.push(await this.persistRecord({ ...record, sourceVersion, sourceContentHash: normalized.sourceContentHash }, String(sourceRow.data.id)));
    }
    return { sourceId: String(sourceRow.data.id), sourceVersion, records };
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
    const finalLimit = Math.max(1, Math.min(request.limit ?? 5, 20));
    // The RPC is capped at 20; use the largest bounded pool available before
    // applicability filtering so an unrelated top hit cannot hide a valid one.
    const candidateLimit = Math.min(20, Math.max(finalLimit, finalLimit * 4));
    const queryEmbedding = await this.embedQuery(request.query);
    const productContext = await this.resolveProductContext(request);
    const { data, error } = await this.serviceClient.rpc("greenfield_search_knowledge_semantic", {
      p_workspace_id: request.workspaceId,
      p_query_embedding: queryEmbedding,
      p_knowledge_types: request.knowledgeTypes ?? null,
      p_limit: candidateLimit,
    });
    if (error) throw new Error(error.message);
    const semanticRows = (Array.isArray(data) ? data : [])
      .filter((row: any) => isPublished({ metadata: row.metadata ?? {} }))
      .filter((row: any) => relevantToExplicitQuery(row, request, productContext))
      .slice(0, candidateLimit);
    const lexicalRows = await this.lexicalFallbackRows(request, request.query, candidateLimit);
    const rowsById = new Map<string, any>();
    for (const row of semanticRows) rowsById.set(String(row.id), row);
    for (const row of lexicalRows) {
      if (!isPublished({ metadata: row.metadata ?? {} })) continue;
      if (!relevantToExplicitQuery(row, request, productContext)) continue;
      if (!rowsById.has(String(row.id))) rowsById.set(String(row.id), row);
    }
    const mergedRows = Array.from(rowsById.values());
    const explicitProductScores = mergedRows.map((row) => applicableProductScore(row, request.query));
    const strongestExplicitProduct = Math.max(...explicitProductScores, 0);
    const productScopedRows = strongestExplicitProduct > 0
      ? mergedRows.filter((row) => {
          const score = applicableProductScore(row, request.query);
          return score === 0 || score === strongestExplicitProduct;
        })
      : mergedRows;
    const selected = selectKnowledgeRows(productScopedRows, request.taskQuery ?? request.query, productContext, finalLimit, request.knowledgeTypes);
    const rows = selected.rows;
    const evidenceSections = await this.loadEvidenceSections(request.workspaceId, rows, request.query);
    return rows
      .map((row: any, index: number) => ({
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
        sourceVersion: row.source_version == null ? null : Number(row.source_version),
        sourceContentHash: row.source_content_hash ?? null,
        sourceLocation: row.source_location ?? null,
        sourceRecordKey: row.source_record_key ?? null,
        taskKey: row.task_key ?? null,
        customerAliases: Array.isArray(row.customer_aliases) ? row.customer_aliases : [],
      },
      score: Number(row.score ?? 0),
      taskRelevance: selected.signals.get(rowRelevanceKey(row))?.score ?? 0,
      taskTitleMatches: selected.signals.get(rowRelevanceKey(row))?.titleMatches ?? 0,
      taskBodyMatches: selected.signals.get(rowRelevanceKey(row))?.bodyMatches ?? 0,
      rank: index + 1,
      evidenceSections: evidenceSections.get(String(row.id)) ?? [],
      matchReason: row.match_reason ?? "semantic",
      taskSpecificity: selected.taskSpecificity,
      procedureCandidates: selected.procedureCandidates,
      }));
  }
}
