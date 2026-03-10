export type RoutingCategory = "support" | string;

export type RoutingTargetCategory = {
  key: string;
  label: string;
};

export type RoutingClassification = {
  category: RoutingCategory;
  confidence: number;
  reason: string;
  source: "heuristic" | "llm" | "fallback";
  subject: string;
  excerpt: string;
};

type ClassifierInput = {
  subject?: string | null;
  body?: string | null;
};

type ClassifierOptions = {
  activeCategories?: RoutingTargetCategory[];
};

type HeuristicRule = {
  categoryKey: string;
  patterns: RegExp[];
};

type HeuristicOutcome = {
  category: RoutingCategory;
  confidence: number;
  reason: string;
  supportGuardHits: number;
  decisiveNonSupport: boolean;
};

type LlmOutcome =
  | {
      ok: true;
      category: RoutingCategory;
      confidence: number;
    }
  | {
      ok: false;
      error: "llm_unavailable" | "llm_http_error" | "llm_invalid_json" | "llm_parse_error";
    };

const OPENAI_MODEL = Deno.env.get("ROUTING_CLASSIFIER_MODEL") ?? "gpt-4o-mini";
const MAX_EXCERPT_CHARS = Number(Deno.env.get("ROUTING_CLASSIFIER_MAX_CHARS") ?? "420");
const LLM_NON_SUPPORT_THRESHOLD = Number(
  Deno.env.get("ROUTING_CLASSIFIER_NON_SUPPORT_THRESHOLD") ?? "0.75",
);

const HEURISTIC_DECISIVE_SCORE = 0.92;
const HEURISTIC_MIN_MARGIN = 0.26;
const STRONG_SUPPORT_GUARD_HITS = 2;

const HEURISTIC_RULES: HeuristicRule[] = [
  {
    categoryKey: "invoice",
    patterns: [
      /\binvoice\b/i,
      /\bfactu(?:re|ra|ra\s+electronica)\b/i,
      /\brechnung\b/i,
      /\bbilling\b/i,
      /\bpayment\s+due\b/i,
      /\bpurchase\s+order\b/i,
      /\bbon\s+de\s+commande\b/i,
      /\baccounts?\s+payable\b/i,
      /\bremittance\b/i,
      /\bpo\s*#?\s*\d+\b/i,
    ],
  },
  {
    categoryKey: "job",
    patterns: [
      /\bjob\b/i,
      /\bemploi\b/i,
      /\btrabajo\b/i,
      /\bstelle\b/i,
      /\bapplication\b/i,
      /\bcandidate\b/i,
      /\bresume\b/i,
      /\bcurriculum\s+vitae\b/i,
      /\bcv\b/i,
      /\bcover\s+letter\b/i,
      /\brecruit(?:er|ing)?\b/i,
      /\bcareer\b/i,
      /\bans.gning\b/i,
    ],
  },
  {
    categoryKey: "partnership",
    patterns: [
      /\bpartnership\b/i,
      /\bpartership\b/i,
      /\bpartnerskab\b/i,
      /\bpartenariat\b/i,
      /\bcolaboraci.n\b/i,
      /\bcollaboration\b/i,
      /\baffiliate\b/i,
      /\baffiliat(?:e|ion)\b/i,
      /\bsponsor(?:ship)?\b/i,
      /\bbrand\s+deal\b/i,
      /\breseller\b/i,
      /\bdistribution\s+partner\b/i,
      /\bb2b\b/i,
      /\bwholesale\b/i,
      /\bagency\b/i,
      /\bbusiness\s+proposal\b/i,
    ],
  },
];

const SUPPORT_GUARD_PATTERNS: RegExp[] = [
  /\border\b/i,
  /\bordre\b/i,
  /\bpedido\b/i,
  /\bcommande\b/i,
  /\bbestellung\b/i,
  /\bstatus\b/i,
  /\btracking\b/i,
  /\brefund\b/i,
  /\brefun(?:d|do)\b/i,
  /\b(return|retur|devoluci.n|retour)\b/i,
  /\bexchange\b/i,
  /\bcancel(?:lation|ar|led)?\b/i,
  /\bshipping\b/i,
  /\bdelivery\b/i,
  /\bdelay(?:ed)?\b/i,
  /\bdamaged?\b/i,
  /\bwrong\s+product\b/i,
  /\bpayment\s+problem\b/i,
  /\bwhere\s+is\s+my\s+order\b/i,
];

const FORWARD_CHAIN_PATTERNS = [
  /^on\s.+wrote:$/i,
  /^from:\s.+$/i,
  /^sent:\s.+$/i,
  /^to:\s.+$/i,
  /^subject:\s.+$/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^begin forwarded message/i,
  /^mensaje reenviado/i,
  /^message transf.r.e/i,
  /^weitergeleitete nachricht/i,
  /^\s*>/,
];

const SIGNATURE_BREAK_PATTERNS = [
  /^--\s*$/,
  /^best regards[,\.\s]*$/i,
  /^kind regards[,\.\s]*$/i,
  /^regards[,\.\s]*$/i,
  /^venlig hilsen[,\.\s]*$/i,
  /^med venlig hilsen[,\.\s]*$/i,
  /^saludos[,\.\s]*$/i,
  /^cordialement[,\.\s]*$/i,
  /^mit freundlichen gr(?:u|ue)(?:s|ss)en[,\.\s]*$/i,
  /^sent from my/i,
  /^disclaimer[:\s]/i,
  /^confidentiality notice[:\s]/i,
  /^aviso legal[:\s]/i,
  /^avis de confidentialit.[:\s]/i,
];

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCategoryKey(value: unknown): string {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizeCategories(categories: RoutingTargetCategory[]): RoutingTargetCategory[] {
  const seen = new Set<string>();
  const result: RoutingTargetCategory[] = [];
  for (const item of categories || []) {
    const key = normalizeCategoryKey(item?.key);
    if (!key || key === "support" || seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      label: asString(item?.label) || key,
    });
  }
  return result;
}

function normalizeSubject(subject: string): string {
  return String(subject || "")
    .replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlPreservingLines(value: string): string {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function trimAtForwardedChain(lines: string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    const next = line.trim();
    if (!next) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (FORWARD_CHAIN_PATTERNS.some((pattern) => pattern.test(next))) break;
    kept.push(next);
  }
  return kept;
}

function trimAtSignature(lines: string[]): string[] {
  const kept: string[] = [];
  let emptyStreak = 0;
  for (const line of lines) {
    const next = line.trim();
    if (!next) {
      emptyStreak += 1;
      if (emptyStreak <= 1 && kept.length) kept.push("");
      continue;
    }
    if (SIGNATURE_BREAK_PATTERNS.some((pattern) => pattern.test(next))) {
      if (kept.length >= 2) break;
    }
    emptyStreak = 0;
    kept.push(next);
  }
  return kept;
}

function cleanBodyForRouting(rawBody: string): string {
  const raw = stripHtmlPreservingLines(rawBody);
  if (!raw) return "";
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trimEnd());
  const withoutChain = trimAtForwardedChain(lines);
  const withoutSignature = trimAtSignature(withoutChain);
  return withoutSignature.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildExcerpt(value: string, maxChars: number): string {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 120) return compact.slice(0, 420);
  return compact.slice(0, Math.max(180, Math.min(700, Math.round(maxChars))));
}

function countPatternHits(patterns: RegExp[], text: string): number {
  if (!text) return 0;
  return patterns.reduce((sum, pattern) => (pattern.test(text) ? sum + 1 : sum), 0);
}

function scoreRule(rule: HeuristicRule, subject: string, excerpt: string): number {
  const subjectHits = countPatternHits(rule.patterns, subject);
  const bodyHits = countPatternHits(rule.patterns, excerpt);
  if (!subjectHits && !bodyHits) return 0;

  const subjectScore = subjectHits > 0 ? 0.8 : 0;
  const bodyScore = bodyHits > 0 ? 0.16 : 0;
  const extraBody = bodyHits >= 2 ? 0.08 : 0;
  return clampConfidence(subjectScore + bodyScore + extraBody);
}

function classifyWithHeuristics(
  subject: string,
  excerpt: string,
  activeCategoryKeys: Set<string>,
): HeuristicOutcome {
  const combined = `${subject}\n${excerpt}`.trim();
  const supportGuardHits = countPatternHits(SUPPORT_GUARD_PATTERNS, combined);

  const scored = HEURISTIC_RULES.filter((rule) => activeCategoryKeys.has(rule.categoryKey))
    .map((rule) => ({
      category: rule.categoryKey,
      score: scoreRule(rule, subject, excerpt),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((row) => row.score > 0);

  if (!scored.length) {
    return {
      category: "support",
      confidence: supportGuardHits > 0 ? 0.7 : 0.35,
      reason: supportGuardHits > 0 ? "heuristic:support_guard" : "heuristic:no_match",
      supportGuardHits,
      decisiveNonSupport: false,
    };
  }

  const top = scored[0];
  const second = scored[1];
  const margin = top.score - (second?.score ?? 0);

  if (supportGuardHits >= STRONG_SUPPORT_GUARD_HITS && top.score < 0.98) {
    return {
      category: "support",
      confidence: 0.78,
      reason: "heuristic:support_guard",
      supportGuardHits,
      decisiveNonSupport: false,
    };
  }

  const decisiveNonSupport =
    top.score >= HEURISTIC_DECISIVE_SCORE && margin >= HEURISTIC_MIN_MARGIN;
  if (decisiveNonSupport) {
    return {
      category: top.category,
      confidence: top.score,
      reason: `heuristic:${top.category}`,
      supportGuardHits,
      decisiveNonSupport: true,
    };
  }

  return {
    category: "support",
    confidence: clampConfidence(Math.max(0.45, 0.76 - margin / 2)),
    reason: "heuristic:inconclusive",
    supportGuardHits,
    decisiveNonSupport: false,
  };
}

async function classifyWithLlm(
  subject: string,
  excerpt: string,
  activeCategories: RoutingTargetCategory[],
): Promise<LlmOutcome> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "llm_unavailable" };
  }

  const keySet = ["support", ...activeCategories.map((item) => item.key)];
  const labels = activeCategories
    .map((item) => `${item.key}=${item.label}`)
    .join("|");

  const systemPrompt =
    "Classify inbound email intent into exactly one allowed category. " +
    "Use support for customer order/help issues. Return strict JSON only.";
  const userPrompt =
    `allowed:${keySet.join("|")}\nlabels:${labels || "none"}\n` +
    `subject:${subject || "(none)"}\nexcerpt:${excerpt || "(empty)"}\n` +
    '{"category":"one_allowed_value","confidence":0.0,"reason":"short"}';

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        max_tokens: 55,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      return { ok: false, error: "llm_http_error" };
    }

    const data = await response.json().catch(() => null);
    const content = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!content) {
      return { ok: false, error: "llm_invalid_json" };
    }

    const parsed = JSON.parse(content);
    const rawCategory = normalizeCategoryKey(parsed?.category);
    const category = rawCategory && keySet.includes(rawCategory) ? rawCategory : "support";
    const confidence = clampConfidence(Number(parsed?.confidence ?? 0));

    return { ok: true, category, confidence };
  } catch {
    return { ok: false, error: "llm_parse_error" };
  }
}

export async function classifyInboundRouting(
  input: ClassifierInput,
  options: ClassifierOptions = {},
): Promise<RoutingClassification> {
  const activeCategories = normalizeCategories(options?.activeCategories || []);
  const subject = normalizeSubject(String(input?.subject || ""));
  const cleanedBody = cleanBodyForRouting(String(input?.body || ""));
  const excerpt = buildExcerpt(cleanedBody, MAX_EXCERPT_CHARS);

  if (!activeCategories.length) {
    return {
      category: "support",
      confidence: 1,
      reason: "fallback:no_active_categories",
      source: "fallback",
      subject,
      excerpt,
    };
  }

  const activeCategoryKeys = new Set(activeCategories.map((item) => item.key));
  const heuristic = classifyWithHeuristics(subject, excerpt, activeCategoryKeys);
  if (heuristic.decisiveNonSupport && heuristic.category !== "support") {
    return {
      category: heuristic.category,
      confidence: heuristic.confidence,
      reason: heuristic.reason,
      source: "heuristic",
      subject,
      excerpt,
    };
  }

  const llm = await classifyWithLlm(subject, excerpt, activeCategories);
  if (!llm.ok) {
    return {
      category: "support",
      confidence: 0.45,
      reason: "fallback:llm_error",
      source: "fallback",
      subject,
      excerpt,
    };
  }

  if (llm.category === "support") {
    return {
      category: "support",
      confidence: llm.confidence,
      reason: "llm:support",
      source: "llm",
      subject,
      excerpt,
    };
  }

  const threshold = clampConfidence(LLM_NON_SUPPORT_THRESHOLD);
  if (llm.confidence < threshold) {
    return {
      category: "support",
      confidence: llm.confidence,
      reason: "fallback:low_confidence",
      source: "fallback",
      subject,
      excerpt,
    };
  }

  if (heuristic.supportGuardHits >= STRONG_SUPPORT_GUARD_HITS && llm.confidence < 0.9) {
    return {
      category: "support",
      confidence: llm.confidence,
      reason: "fallback:support_guard",
      source: "fallback",
      subject,
      excerpt,
    };
  }

  return {
    category: llm.category,
    confidence: llm.confidence,
    reason: `llm:${llm.category}`,
    source: "llm",
    subject,
    excerpt,
  };
}
