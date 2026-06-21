// supabase/functions/generate-draft-v2/stages/product-specs.ts
//
// Structured, platform-neutral product specs (Stage 4B-3-2).
//
// Sona compares products from curated, confirmed specs in
// public.shop_product_specs — never by guessing from product descriptions or
// prose retrieval. PURE module (no DB, no LLM): the pipeline fetches rows and
// passes them in.
//
// Resolution rules (mirror product-compatibility):
//   - product-specific rows (product_id = the product) override brand-wide rows
//     (product_id = null) for the same spec_key,
//   - only confidence='confirmed' rows are ever served,
//   - a missing spec is "Not specified" (never inferred as "No").

const NOT_SPECIFIED = "Not specified";

export interface SpecRow {
  product_id: number | null;
  spec_key: string;
  spec_group: string;
  spec_value: string;
  value_bool: boolean | null;
  value_num: number | null;
  unit: string | null;
  display_order: number;
  comparable: boolean;
  confidence: "confirmed" | "suggested";
  // Stage 4B-3-2d: provenance/review metadata for suggested specs. Carried for
  // typing/storage only — the resolver and comparison never read these, so
  // they cannot affect customer-facing output.
  evidence_text?: string | null;
  source_url?: string | null;
  extracted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
}

export interface ResolvedSpec {
  spec_key: string;
  spec_group: string;
  spec_value: string;
  unit: string | null;
  display_order: number;
  comparable: boolean;
}

export interface ProductSpecs {
  productId: number | null;
  title: string;
  specs: ResolvedSpec[];
}

export interface ComparisonRow {
  spec_key: string;
  spec_group: string;
  display_order: number;
  values: Array<{ title: string; value: string }>;
}

/**
 * Confirmed specs for a product: product-specific rows override brand-wide
 * (null) rows per spec_key; suggested rows are dropped.
 */
export function resolveProductSpecs(
  rows: SpecRow[] | null | undefined,
  opts: { productId: number | null },
): ResolvedSpec[] {
  const confirmed = (Array.isArray(rows) ? rows : []).filter(
    (r) => r.confidence === "confirmed",
  );
  const bySpec = new Map<string, SpecRow>();
  for (const row of confirmed) {
    const matchesProduct = opts.productId != null &&
      row.product_id === opts.productId;
    const isBrand = row.product_id == null;
    if (!matchesProduct && !isBrand) continue;
    const existing = bySpec.get(row.spec_key);
    if (!existing) {
      bySpec.set(row.spec_key, row);
      continue;
    }
    const existingIsProduct = opts.productId != null &&
      existing.product_id === opts.productId;
    if (matchesProduct && !existingIsProduct) {
      bySpec.set(row.spec_key, row);
    }
  }
  return Array.from(bySpec.values()).map((r) => ({
    spec_key: r.spec_key,
    spec_group: r.spec_group,
    spec_value: r.spec_value,
    unit: r.unit,
    display_order: r.display_order,
    comparable: r.comparable,
  }));
}

function formatValue(spec: ResolvedSpec): string {
  const v = String(spec.spec_value ?? "").trim();
  if (!v) return NOT_SPECIFIED;
  return spec.unit ? `${v} ${spec.unit}` : v;
}

/**
 * Aligns comparable, confirmed specs across products by spec_key, ordered by
 * display_order (then spec_key). Missing values render as "Not specified" — the
 * comparison never guesses or invents.
 */
export function buildSpecComparison(
  products: ProductSpecs[] | null | undefined,
): ComparisonRow[] {
  const list = Array.isArray(products) ? products : [];

  // Collect comparable spec_keys with their canonical group/order.
  const meta = new Map<
    string,
    { spec_group: string; display_order: number }
  >();
  for (const p of list) {
    for (const s of p.specs) {
      if (!s.comparable) continue;
      if (!meta.has(s.spec_key)) {
        meta.set(s.spec_key, {
          spec_group: s.spec_group,
          display_order: s.display_order,
        });
      }
    }
  }

  const keys = Array.from(meta.keys()).sort((a, b) => {
    const da = meta.get(a)!.display_order;
    const db = meta.get(b)!.display_order;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });

  return keys.map((spec_key) => {
    const m = meta.get(spec_key)!;
    return {
      spec_key,
      spec_group: m.spec_group,
      display_order: m.display_order,
      values: list.map((p) => {
        const match = p.specs.find(
          (s) => s.spec_key === spec_key && s.comparable,
        );
        return {
          title: p.title,
          value: match ? formatValue(match) : NOT_SPECIFIED,
        };
      }),
    };
  });
}

// Comparison-intent cues.
const COMPARISON_CUE =
  /\bvs\.?\b|\bversus\b|\bdifference\b|\bcompare(d)?\b|\bbetter\b|\bwhich (one|is)\b|\bor\b/i;

function normTitle(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Returns the known product titles mentioned in the text. Longer titles are
 * matched first so "A-Spire Wireless" wins over "A-Spire".
 */
export function detectComparisonQuery(
  text: string | null | undefined,
  knownProductTitles: string[] | null | undefined,
): string[] {
  const hay = normTitle(text);
  if (!hay) return [];
  const titles = (Array.isArray(knownProductTitles) ? knownProductTitles : [])
    .filter((t) => normTitle(t).length > 0)
    .sort((a, b) => normTitle(b).length - normTitle(a).length);

  const found: string[] = [];
  let remaining = hay;
  for (const title of titles) {
    const n = normTitle(title);
    if (remaining.includes(n)) {
      found.push(title);
      // Remove the matched span so a shorter prefix title (A-Spire) does not
      // also match inside "A-Spire Wireless".
      remaining = remaining.replace(n, " ");
    }
  }
  return found;
}

export function isComparisonQuestion(
  text: string | null | undefined,
  knownProductTitles: string[] | null | undefined,
): boolean {
  const products = detectComparisonQuery(text, knownProductTitles);
  if (products.length < 2) return false;
  return COMPARISON_CUE.test(String(text ?? ""));
}

/**
 * Render a deterministic writer directive from a structured comparison. Only
 * comparable confirmed specs are shown; missing values are "Not specified" and
 * the writer is told never to guess. Returns "" when not asked or when there is
 * nothing confirmed to compare.
 */
export function buildComparisonDirective(
  comparison: ComparisonRow[] | null | undefined,
  products: ProductSpecs[] | null | undefined,
  opts: { wasAsked: boolean },
): string {
  if (!opts.wasAsked) return "";
  const rows = Array.isArray(comparison) ? comparison : [];
  const productList = Array.isArray(products) ? products : [];

  // Confirmed positioning facts (spec_group='positioning', kept out of the
  // technical table via comparable=false). resolveProductSpecs already dropped
  // suggested rows, so anything here is confirmed.
  const positioning = productList
    .map((p) => ({
      title: p.title,
      specs: (p.specs ?? [])
        .filter((s) => s.spec_group === "positioning")
        .sort((a, b) => a.display_order - b.display_order),
    }))
    .filter((p) => p.specs.length > 0);

  // Require at least one real comparable fact OR some positioning guidance —
  // otherwise there is nothing confirmed to say.
  const hasFact = rows.some((r) =>
    r.values.some((v) => v.value !== NOT_SPECIFIED)
  );
  if (!hasFact && positioning.length === 0) return "";

  const titles = productList.map((p) => p.title);
  const header = titles.length
    ? `# PRODUCT COMPARISON — CONFIRMED SPECS (authoritative): ${
      titles.join(" vs ")
    }`
    : "# PRODUCT COMPARISON — CONFIRMED SPECS (authoritative)";

  const lines: string[] = [header];
  for (const row of rows) {
    const parts = row.values.map((v) => `${v.title}: ${v.value}`).join(" | ");
    lines.push(`- ${row.spec_key} — ${parts}`);
  }

  if (positioning.length > 0) {
    lines.push("", "# CUSTOMER GUIDANCE (positioning, authoritative)");
    for (const p of positioning) {
      const parts = p.specs.map((s) => `${s.spec_key}: ${s.spec_value}`).join(" ");
      lines.push(`- ${p.title} — ${parts}`);
    }
  }

  lines.push(
    "",
    "Writing guidance:",
    "- Start with the practical difference — who each product is for — using the customer guidance above.",
    "- Then summarise the key confirmed technical differences in natural customer-service language; do not write a dry key-value dump.",
    "- Close with a short recommendation when the customer's need is clear.",
    "- Phrase one-sided features positively (e.g. \"the X additionally offers Y\"); avoid saying \"Not specified\" unless necessary, and never assert a product lacks a feature you have no data for.",
    "- Use ONLY the confirmed facts above; do not guess or invent missing facts, and never use suggested/unconfirmed specs — do not mention DAC, sound-quality/comfort/feature ratings, or outdoor mode unless they appear as confirmed facts above.",
  );
  return lines.join("\n");
}
