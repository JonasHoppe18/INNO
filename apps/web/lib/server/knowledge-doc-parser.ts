export type KnowledgeDocumentSection = {
  heading: string;
  normalized_heading: string;
  section_key: string;
  content: string;
  order: number;
  metadata: Record<string, unknown>;
  warnings: string[];
};

type HeadingMetadata = {
  section_key: string;
  metadata?: Record<string, unknown>;
};

const KNOWN_HEADINGS: Array<[RegExp, HeadingMetadata]> = [
  [/^return window$/, { section_key: "return_window" }],
  [/^opened or tested products$/, { section_key: "opened_or_tested_products" }],
  [/^return shipping(?: and costs)?$/, { section_key: "return_shipping" }],
  [/^refund processing$/, { section_key: "refund_processing" }],
  [
    /^default return address$/,
    {
      section_key: "return_address",
      metadata: { address_type: "ordinary_return", region_scope: "default" },
    },
  ],
  [
    /^us return address$/,
    {
      section_key: "return_address",
      metadata: { address_type: "ordinary_return", region_scope: "US" },
    },
  ],
  [
    /^eu return address$/,
    {
      section_key: "return_address",
      metadata: { address_type: "ordinary_return", region_scope: "EU" },
    },
  ],
  [
    /^uk return address$/,
    {
      section_key: "return_address",
      metadata: { address_type: "ordinary_return", region_scope: "UK" },
    },
  ],
  [/^third party purchases$/, { section_key: "third_party_purchases" }],
  [/^internal guidance$/, { section_key: "internal_guidance", metadata: { audience: "internal" } }],
];

export function normalizeKnowledgeHeading(heading: string): string {
  return String(heading || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function knowledgeHeadingSlug(heading: string): string {
  const normalized = normalizeKnowledgeHeading(heading);
  return normalized
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "untitled_section";
}

function metadataForHeading(normalizedHeading: string): HeadingMetadata {
  for (const [pattern, value] of KNOWN_HEADINGS) {
    if (pattern.test(normalizedHeading)) {
      return { section_key: value.section_key, metadata: { ...(value.metadata ?? {}) } };
    }
  }

  const repairAddress = normalizedHeading.match(/^(.+?) repair address$/);
  if (repairAddress?.[1]) {
    return {
      section_key: "repair_address",
      metadata: {
        address_type: "warranty_repair",
        product_scope: knowledgeHeadingSlug(repairAddress[1]).replace(/_/g, "-"),
      },
    };
  }

  return { section_key: knowledgeHeadingSlug(normalizedHeading) };
}

export function parseKnowledgeDocumentSections(markdown: string): KnowledgeDocumentSection[] {
  const normalized = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n");
  const lines = normalized.split("\n");
  const sections: KnowledgeDocumentSection[] = [];
  let current:
    | {
      heading: string;
      normalized_heading: string;
      section_key: string;
      metadata: Record<string, unknown>;
      lines: string[];
      warnings: string[];
    }
    | null = null;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    const warnings = [...current.warnings];
    if (!content) warnings.push("empty_section");
    sections.push({
      heading: current.heading,
      normalized_heading: current.normalized_heading,
      section_key: current.section_key,
      content,
      order: sections.length,
      metadata: { ...current.metadata },
      warnings,
    });
    current = null;
  };

  for (const line of lines) {
    const h2 = line.match(/^##(?!#)\s+(.+?)\s*#*\s*$/);
    if (h2) {
      flush();
      const heading = h2[1].trim();
      const normalized_heading = normalizeKnowledgeHeading(heading);
      const headingMetadata = metadataForHeading(normalized_heading);
      current = {
        heading,
        normalized_heading,
        section_key: headingMetadata.section_key,
        metadata: headingMetadata.metadata ?? {},
        lines: [],
        warnings: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();

  return sections;
}
