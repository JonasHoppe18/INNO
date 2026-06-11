// Deterministic, dependency-free selector for Product Support PREVIEW runs.
//
// Goal: from an explicit draft Product Support document (one shop + one
// product_scope), pick only the H2 sections relevant to the latest customer
// message instead of injecting every section. This avoids dilution on
// ambiguous tickets.
//
// Design constraints (see slice spec):
//  - pure function, deterministic ordering
//  - no shop/product hardcoding, no A-Spire-specific rules
//  - custom user-created headings remain eligible (scoring is lexical, not a
//    fixed heading list)
//  - selects ONLY from the sections passed in (already shop/document/product
//    scoped by the caller) — it never reaches across products or shops
//  - max 3 sections, prefers a single focused section
//
// Scoring is lexical IDF over the section corpus: tokens that appear in every
// section (e.g. the product name in each chunk's title) get ~zero weight, so
// the discriminating words drive selection. Stored embeddings are intentionally
// NOT required here; the `embedding` field is kept on the type for a future
// semantic upgrade, but adding it would require exposing embeddings in the
// preview loader (documented separately) and is out of scope for this slice.

export type ProductSupportSection = {
  chunk_id: string;
  section_key: string;
  section_heading: string;
  content: string;
  section_order?: number;
  embedding?: number[];
};

export type ProductSupportSectionSelection = {
  selected_sections: ProductSupportSection[];
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type ProductSupportSelectorInput = {
  latest_customer_message: string;
  conversation_history?: string;
  sections: ProductSupportSection[];
};

// Generic English/support stopwords. No product or shop terms here — product
// names are suppressed automatically by IDF (they appear in every section).
const STOPWORDS = new Set([
  "the", "and", "but", "with", "for", "are", "was", "were", "you", "your",
  "yours", "our", "ours", "their", "them", "they", "this", "that", "these",
  "those", "not", "does", "did", "done", "how", "what", "why", "when", "where",
  "who", "can", "could", "would", "should", "will", "shall", "may", "might",
  "have", "has", "had", "been", "being", "from", "into", "onto", "out", "off",
  "its", "it's", "i'm", "i've", "anymore", "anything", "something", "really",
  "just", "only", "also", "still", "now", "then", "than", "there", "here",
  "any", "all", "some", "more", "most", "much", "very", "too", "able", "get",
  "got", "getting", "keep", "keeps", "kept", "make", "makes", "made", "please",
  "thanks", "thank", "hello", "hi", "hey", "regards", "able",
]);

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function uniqueTokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

// Tuning constants. Selection is HEADING-ANCHORED: a section is only a real
// candidate when a discriminating query word appears in its H2 heading. Section
// body text is used only as a weak tie-breaker, never to make a section
// eligible — this stops generic sections (e.g. "Product overview") from leaking
// in just because they happen to mention a common word.
const MIN_TOKEN_IDF = 0.15; // below this a token is ~ubiquitous (product name, "wireless")
const CONTENT_WEIGHT = 0.2; // body matches count far less than heading matches
const CONTENT_FALLBACK_MIN = 1.2; // when no heading anchors, body must be strong to inject
const HIGH_ANCHOR_IDF = 1.2; // a rare, specific heading word (e.g. "pulsating", "cracking")
const HIGH_DOMINANCE = 1.3; // primary must beat 2nd by this ratio for "high"
const SECONDARY_RATIO = 0.85; // a 2nd/3rd section must be close to the top...
const DISTINCT_SECONDARY_IDF = 1.6; // ...and add its OWN rare heading concept
const MAX_SECTIONS = 3;

export function selectProductSupportSections(
  input: ProductSupportSelectorInput,
): ProductSupportSectionSelection {
  const sections = Array.isArray(input?.sections) ? input.sections : [];
  if (!sections.length) {
    return {
      selected_sections: [],
      confidence: "low",
      reason: "no_sections_available",
    };
  }

  // Document-frequency over the provided section corpus → IDF weights. Tokens
  // that appear in every section (the product name in each chunk's title) get
  // ~zero weight automatically — no product/shop hardcoding needed.
  const sectionTokenSets = sections.map((section) =>
    uniqueTokenSet(`${section.section_heading} ${section.content}`)
  );
  const sectionHeadingSets = sections.map((section) =>
    uniqueTokenSet(section.section_heading)
  );
  const n = sections.length;
  const df = new Map<string, number>();
  for (const set of sectionTokenSets) {
    for (const token of set) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const idf = (token: string): number => {
    const d = df.get(token) ?? 0;
    if (d === 0) return 0;
    return Math.log((n + 1) / (d + 1));
  };

  // Query tokens: latest message at full weight, history as a light addition.
  const queryWeights = new Map<string, number>();
  for (const token of tokenize(input.latest_customer_message)) {
    queryWeights.set(token, Math.max(queryWeights.get(token) ?? 0, 1));
  }
  if (input.conversation_history) {
    for (const token of tokenize(input.conversation_history)) {
      queryWeights.set(token, Math.max(queryWeights.get(token) ?? 0, 0.5));
    }
  }

  type Scored = {
    index: number;
    headingMatchCount: number;
    headingScore: number;
    combined: number;
    bestHeadingIdf: number;
    headingAnchorTokens: Set<string>;
    headingLength: number;
  };

  const scored: Scored[] = sections.map((section, index) => {
    const headingTokens = sectionHeadingSets[index];
    const sectionTokens = sectionTokenSets[index];
    let headingScore = 0;
    let headingMatchCount = 0;
    let bestHeadingIdf = 0;
    let contentScore = 0;
    const headingAnchorTokens = new Set<string>();
    for (const [token, qWeight] of queryWeights) {
      const tokenIdf = idf(token);
      if (tokenIdf < MIN_TOKEN_IDF) continue;
      if (headingTokens.has(token)) {
        headingScore += tokenIdf * qWeight;
        headingMatchCount += 1;
        headingAnchorTokens.add(token);
        if (tokenIdf > bestHeadingIdf) bestHeadingIdf = tokenIdf;
      } else if (sectionTokens.has(token)) {
        contentScore += tokenIdf * qWeight;
      }
    }
    return {
      index,
      headingMatchCount,
      headingScore,
      combined: headingScore + CONTENT_WEIGHT * contentScore,
      bestHeadingIdf,
      headingAnchorTokens,
      headingLength: headingTokens.size,
      // content-only fallback score retained on the side
      // (encoded via combined when headingScore === 0)
    };
  });

  // Primary candidates must be heading-anchored.
  const anchored = scored.filter((s) => s.headingMatchCount > 0);

  if (anchored.length === 0) {
    // No heading anchor anywhere. Only inject if SOME section has a strong body
    // match; otherwise abstain (ambiguous question).
    const bestByContent = [...scored].sort((a, b) => b.combined - a.combined)[0];
    if (bestByContent && bestByContent.combined >= CONTENT_FALLBACK_MIN) {
      return {
        selected_sections: [sections[bestByContent.index]],
        confidence: "medium",
        reason: "single_focused_section",
      };
    }
    return {
      selected_sections: [],
      confidence: "low",
      reason: "ambiguous_no_specific_section",
    };
  }

  // Deterministic ranking: more heading anchors, then higher combined score,
  // then a shorter (more focused) heading, then original section order.
  const ranked = [...anchored].sort((a, b) => {
    if (b.headingMatchCount !== a.headingMatchCount) {
      return b.headingMatchCount - a.headingMatchCount;
    }
    if (b.combined !== a.combined) return b.combined - a.combined;
    if (a.headingLength !== b.headingLength) return a.headingLength - b.headingLength;
    return a.index - b.index;
  });

  const primary = ranked[0];
  const selected: Scored[] = [primary];

  // Secondary sections (focused-first): only add a section that is close to the
  // primary AND contributes its own rare heading concept the primary lacks.
  for (const candidate of ranked.slice(1)) {
    if (selected.length >= MAX_SECTIONS) break;
    if (candidate.combined < primary.combined * SECONDARY_RATIO) {
      // Still allow when the query clearly spans multiple strong concepts.
      if (candidate.headingMatchCount < primary.headingMatchCount) continue;
    }
    const distinctAnchor = [...candidate.headingAnchorTokens].some(
      (token) =>
        !primary.headingAnchorTokens.has(token) && idf(token) >= DISTINCT_SECONDARY_IDF,
    );
    if (!distinctAnchor) continue;
    selected.push(candidate);
  }

  const second = ranked[1];
  const dominant = !second || primary.combined >= second.combined * HIGH_DOMINANCE;
  const confidence: "high" | "medium" =
    (primary.headingMatchCount >= 2 ||
        (primary.bestHeadingIdf >= HIGH_ANCHOR_IDF && dominant)) && dominant
      ? "high"
      : "medium";

  // Primary first, remaining selected in document order for a stable read.
  const rest = selected
    .slice(1)
    .sort((a, b) => a.index - b.index);
  const ordered = [primary, ...rest];

  return {
    selected_sections: ordered.map((s) => sections[s.index]),
    confidence,
    reason: ordered.length > 1
      ? "multiple_relevant_sections"
      : "single_focused_section",
  };
}

export const PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION =
  "The issue is not specific enough to choose a troubleshooting guide. Ask one focused clarification question. Do not suggest troubleshooting steps yet.";
