// Hybrid (lexical + semantic) selector for Product Support PREVIEW runs.
//
// Goal: from an explicit draft Product Support document (one shop + one
// product_scope), pick only the H2 sections relevant to the latest customer
// message instead of injecting every section.
//
// Why hybrid (calibrated against the real A-Spire Wireless document):
//  - The stored section embeddings live in a COMPRESSED space (every chunk
//    shares the product title + domain vocabulary), so query↔section cosine
//    margins are tiny (~0.002–0.10) and pure semantic argmax mis-ranks English
//    (e.g. "not connecting to the wireless dongle" ties two dongle sections;
//    "does not work properly" scores HIGHER than many specific issues).
//  - Lexical heading-anchored scoring is therefore MORE precise for English
//    exact matches and must lead when it has a confident heading anchor.
//  - Semantic similarity is the PRIMARY cross-lingual signal exactly where
//    lexical has nothing to match — Danish wording vs English headings
//    ("Mikrofonen virker med kabel, men ikke ... donglen" → "Microphone works
//    with the cable but not with the dongle"). It is used as a margin-gated
//    rescue so noise leads to abstention, never a wrong guide.
//
// Design constraints (see slice spec):
//  - deterministic ordering after scores are computed
//  - no shop/product hardcoding, no A-Spire-specific rules, no translation dict
//  - custom user-created headings remain eligible
//  - selects ONLY from the sections passed in (already shop/document/product
//    scoped by the caller) — never reaches across products or shops
//  - max 3 sections, prefers a single focused section
//  - low score → abstain; no full-document fallback

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
  semantic_scores?: number[];
  lexical_scores?: number[];
};

export type ProductSupportSelectorInput = {
  latest_customer_message: string;
  conversation_history?: string;
  sections: ProductSupportSection[];
  query_embedding?: number[];
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

function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --- Lexical scoring (heading-anchored) -------------------------------------
const MIN_TOKEN_IDF = 0.15; // below this a token is ~ubiquitous (product name)
const CONTENT_WEIGHT = 0.2; // body matches count far less than heading matches
const HIGH_ANCHOR_IDF = 1.2; // a rare, specific heading word (e.g. "pulsating")
const HIGH_DOMINANCE = 1.3; // primary must beat 2nd by this ratio for "high"
const SECONDARY_RATIO = 0.85;
const DISTINCT_SECONDARY_IDF = 1.6;
const MAX_SECTIONS = 3;

// --- Semantic rescue thresholds (calibrated on real DA/EN query cosines) -----
// Margins are tiny in this compressed space; we gate on the top-vs-second
// margin so a noisy near-tie abstains instead of injecting a wrong guide.
const SEM_MARGIN_MIN = 0.06; // below → abstain (e.g. ambiguous EN margin ~0.042)
const SEM_MARGIN_HIGH = 0.10; // at/above → high confidence (clear cross-lingual hit)

type LexScored = {
  index: number;
  headingMatchCount: number;
  headingScore: number;
  combined: number;
  bestHeadingIdf: number;
  headingAnchorTokens: Set<string>;
  headingLength: number;
};

type LexResult = {
  selection: ProductSupportSectionSelection;
  anchoredPrimary: boolean;
  lexicalScores: number[];
};

function scoreLexical(
  input: ProductSupportSelectorInput,
  sections: ProductSupportSection[],
): LexResult {
  const sectionTokenSets = sections.map((s) =>
    uniqueTokenSet(`${s.section_heading} ${s.content}`)
  );
  const sectionHeadingSets = sections.map((s) => uniqueTokenSet(s.section_heading));
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

  const queryWeights = new Map<string, number>();
  for (const token of tokenize(input.latest_customer_message)) {
    queryWeights.set(token, Math.max(queryWeights.get(token) ?? 0, 1));
  }
  if (input.conversation_history) {
    for (const token of tokenize(input.conversation_history)) {
      queryWeights.set(token, Math.max(queryWeights.get(token) ?? 0, 0.5));
    }
  }

  const scored: LexScored[] = sections.map((section, index) => {
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
    };
  });

  const lexicalScores = scored.map((s) => Number(s.combined.toFixed(4)));
  const anchored = scored.filter((s) => s.headingMatchCount > 0);

  if (anchored.length === 0) {
    return {
      selection: { selected_sections: [], confidence: "low", reason: "lexical_no_anchor" },
      anchoredPrimary: false,
      lexicalScores,
    };
  }

  const ranked = [...anchored].sort((a, b) => {
    if (b.headingMatchCount !== a.headingMatchCount) {
      return b.headingMatchCount - a.headingMatchCount;
    }
    if (b.combined !== a.combined) return b.combined - a.combined;
    if (a.headingLength !== b.headingLength) return a.headingLength - b.headingLength;
    return a.index - b.index;
  });

  const primary = ranked[0];
  const selected: LexScored[] = [primary];
  for (const candidate of ranked.slice(1)) {
    if (selected.length >= MAX_SECTIONS) break;
    if (candidate.combined < primary.combined * SECONDARY_RATIO) {
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

  const rest = selected.slice(1).sort((a, b) => a.index - b.index);
  const ordered = [primary, ...rest];

  return {
    selection: {
      selected_sections: ordered.map((s) => sections[s.index]),
      confidence,
      reason: ordered.length > 1 ? "lexical_multiple_sections" : "lexical_single_section",
    },
    anchoredPrimary: true,
    lexicalScores,
  };
}

export function selectProductSupportSections(
  input: ProductSupportSelectorInput,
): ProductSupportSectionSelection {
  const sections = Array.isArray(input?.sections) ? input.sections : [];
  if (!sections.length) {
    return { selected_sections: [], confidence: "low", reason: "no_sections_available" };
  }

  const lex = scoreLexical(input, sections);

  // Semantic scores are diagnostics-only when the lexical path leads.
  const queryEmbedding = Array.isArray(input.query_embedding) ? input.query_embedding : null;
  const haveEmbeddings = queryEmbedding != null && sections.some((s) => Array.isArray(s.embedding));
  const semanticScores: number[] | undefined = haveEmbeddings
    ? sections.map((s) =>
      Array.isArray(s.embedding)
        ? Number(cosineSimilarity(queryEmbedding as number[], s.embedding).toFixed(4))
        : 0
    )
    : undefined;

  const withDiag = (sel: ProductSupportSectionSelection): ProductSupportSectionSelection => ({
    ...sel,
    ...(semanticScores ? { semantic_scores: semanticScores } : {}),
    lexical_scores: lex.lexicalScores,
  });

  // 1) English precision: a confident lexical heading anchor leads. Lexical is
  //    measurably more precise than semantic for exact English matches.
  if (lex.anchoredPrimary && lex.selection.confidence !== "low") {
    return withDiag(lex.selection);
  }

  // 2) Cross-lingual rescue: lexical has no anchor. Use semantic similarity
  //    (the primary cross-lingual signal), margin-gated so noise abstains.
  if (semanticScores) {
    const ranked = semanticScores
      .map((sim, index) => ({ index, sim }))
      .sort((a, b) => b.sim - a.sim || a.index - b.index);
    const top = ranked[0];
    const second = ranked[1];
    const margin = top.sim - (second?.sim ?? 0);
    if (margin >= SEM_MARGIN_MIN) {
      return withDiag({
        selected_sections: [sections[top.index]],
        confidence: margin >= SEM_MARGIN_HIGH ? "high" : "medium",
        reason: "semantic_single_section",
      });
    }
    // Semantic too ambiguous → abstain (clarification), never inject a guess.
    return withDiag({
      selected_sections: [],
      confidence: "low",
      reason: "semantic_low_margin",
    });
  }

  // 3) No embeddings available → fall back to the lexical result (abstain).
  return withDiag(lex.selection);
}

// Marker/instruction stored as the preview blockText when no Product Support
// section matches (low confidence). The ACTUAL behavior is enforced
// deterministically by clarification-only writer mode (the pipeline suppresses
// troubleshooting knowledge and the writer asks one clarification question in
// the resolved language) — so this stays a short, language-agnostic instruction
// with NO canned per-language reply text. Preview/test only.
export const PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION = [
  "# PRODUCT SUPPORT PREVIEW — NO MATCHING SECTION (explicit test/simulation run only)",
  "No section of the product-support document matches the customer's message.",
  "Ask exactly one concise clarification question in the customer's language and do not provide troubleshooting steps.",
].join("\n");
