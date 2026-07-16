// Pure helpers for the full-history Zendesk import. No I/O.

// One-time cost model per ticket (July 2026 list prices):
// - redaction: gpt-4o-mini, ~700 input + ~500 output tokens
//   ($0.15/1M in, $0.60/1M out) => ~$0.000405/ticket
// - embedding: text-embedding-3-small, ~400 tokens ($0.02/1M) => ~$0.000008
// Total: ~$0.000413/ticket. Rounded to 0.0004 (<3% variance) so that 2-decimal
// display rounding remains exactly linear in tests — this is a coarse pre-run estimate,
// not billing.
const USD_PER_TICKET = 0.0004;
const DKK_PER_USD = 7.0; // coarse — this is an ESTIMATE shown pre-run, not billing

export type ZendeskConversationTurn = {
  role: "customer" | "agent";
  body: string;
  sourceId?: string;
};

export type ZendeskComment = {
  id?: string | number | null;
  author_id?: string | number | null;
  public?: boolean;
  html_body?: unknown;
  plain_body?: unknown;
  body?: unknown;
  metadata?: { flags?: unknown } | null;
};

export type ZendeskAuthorRoleMap =
  | ReadonlyMap<string, unknown>
  | Readonly<Record<string, unknown>>;

export type AnchoredZendeskReply = {
  customerBody: string;
  agentReply: string;
  conversationContext: string | null;
  multiTurn: boolean;
  customerTurnId?: string;
  agentTurnId?: string;
};

/** Preserve authored paragraphs while removing Zendesk's HTML wrapper. */
export function stripZendeskHtml(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Detect explicit machine replies without deleting short human confirmations. */
export function isZendeskAutoReply(text: string): boolean {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) return true;
  return lower.includes("this is an automated reply") ||
    lower.includes("we have received your request") ||
    lower.includes("auto-reply") ||
    lower.includes("automatic reply") ||
    lower.includes("out of office") ||
    lower.includes("this mailbox is not monitored") ||
    lower.includes("do not reply to this email");
}

function authorRole(
  authorId: string,
  roles: ZendeskAuthorRoleMap,
): unknown {
  const get = (roles as ReadonlyMap<string, unknown>)?.get;
  if (typeof get === "function") {
    return get.call(roles, authorId);
  }
  return (roles as Readonly<Record<string, unknown>>)?.[authorId];
}

/**
 * Map Zendesk's user roles to the two roles accepted by the training corpus.
 * Collaborators and CCs remain customers because Zendesk reports them as
 * `end-user`; authors absent from the supplied lookup are intentionally dropped.
 */
export function classifyZendeskAuthor(
  authorId: string | number | null | undefined,
  roles: ZendeskAuthorRoleMap,
): ZendeskConversationTurn["role"] | null {
  if (authorId === null || authorId === undefined) return null;
  const role = String(authorRole(String(authorId), roles) ?? "")
    .trim()
    .toLowerCase();
  if (role === "agent" || role === "admin") return "agent";
  if (role === "end-user") return "customer";
  return null;
}

function hasZendeskSystemFlagFour(comment: ZendeskComment): boolean {
  const flags = comment?.metadata?.flags;
  const values = Array.isArray(flags) ? flags : [flags];
  return values.some((flag) => flag === 4 || flag === "4");
}

function zendeskCommentBody(comment: ZendeskComment): string {
  for (
    const candidate of [
      comment?.plain_body,
      comment?.body,
      comment?.html_body,
    ]
  ) {
    const body = stripZendeskHtml(String(candidate ?? ""));
    if (body) return body;
  }
  return "";
}

/** Unknown public authors are a hard barrier: dropping their turn could pair
 * a later agent reply with the wrong earlier customer message. */
export function hasUnclassifiedZendeskPublicComment(
  comments: readonly ZendeskComment[] | null | undefined,
  roles: ZendeskAuthorRoleMap,
): boolean {
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (
      !comment || comment.public !== true || hasZendeskSystemFlagFour(comment)
    ) {
      continue;
    }
    if (!zendeskCommentBody(comment)) continue;
    if (!classifyZendeskAuthor(comment.author_id, roles)) return true;
  }
  return false;
}

/** Convert public human Zendesk comments to ordered customer/agent turns. */
export function zendeskCommentsToTurns(
  comments: readonly ZendeskComment[] | null | undefined,
  roles: ZendeskAuthorRoleMap,
): ZendeskConversationTurn[] {
  const turns: ZendeskConversationTurn[] = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (
      !comment || comment.public !== true || hasZendeskSystemFlagFour(comment)
    ) {
      continue;
    }
    const role = classifyZendeskAuthor(comment.author_id, roles);
    if (!role) continue;
    const body = zendeskCommentBody(comment);
    if (!body) continue;
    // Customer text can legitimately quote one of these phrases. Only agent
    // turns are eligible for explicit textual auto-reply filtering.
    if (role === "agent" && isZendeskAutoReply(body)) continue;
    const sourceId = String(comment?.id ?? "").trim();
    turns.push({ role, body, ...(sourceId ? { sourceId } : {}) });
  }
  return turns;
}

/** Return Zendesk's next opaque page cursor, or null when pagination is done. */
export function nextZendeskPageCursor(page: {
  meta?: { has_more?: unknown; after_cursor?: unknown } | null;
}): string | null {
  if (page?.meta?.has_more !== true) return null;
  const cursor = String(page.meta.after_cursor ?? "").trim();
  return cursor || null;
}

type ZendeskRedactionFields = {
  subject: string;
  customer_msg: string;
  agent_reply: string;
  conversation_context: string;
};

function normalizePiiToken(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isLikelyCalendarDate(value: string): boolean {
  const compact = value.trim().replace(/[ ()]/g, "");
  return /^(?:\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{2,4})$/
    .test(compact);
}

function collectPhoneLikeTokens(text: string): string[] {
  const values = new Set<string>();
  const pattern = /(?:\+?\d[\d ().-]{5,}\d)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const candidate = String(match[0] || "").trim();
    const digitCount = (candidate.match(/\d/g) ?? []).length;
    if (
      digitCount >= 7 && digitCount <= 15 &&
      !isLikelyCalendarDate(candidate)
    ) {
      values.add(normalizePiiToken(candidate));
    }
    if (match[0] === "") pattern.lastIndex += 1;
  }
  return Array.from(values);
}

const PERSON_NAME_WORD_SOURCE = String.raw`[\p{Lu}][\p{L}\p{M}'’\-]{1,30}`;
const PERSON_NAME_BOUNDARY_SOURCE = String
  .raw`(?=\s*(?:[,!.]|\r?\n|$|[^\p{L}\p{N}\s]))`;

function collectExplicitPiiTokens(text: string): string[] {
  const tokens = new Set<string>();
  const addMatches = (
    pattern: RegExp,
    group = 0,
  ) => {
    const globalPattern = pattern.global
      ? pattern
      : new RegExp(pattern.source, `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      const token = normalizePiiToken(String(match[group] || ""));
      if (token.length >= 3) tokens.add(token);
      if (match[0] === "") globalPattern.lastIndex += 1;
    }
  };
  const nonPersonNameParts = new Set([
    "acezone",
    "agent",
    "care",
    "customer",
    "department",
    "experience",
    "happiness",
    "helpdesk",
    "operations",
    "sales",
    "service",
    "success",
    "support",
    "team",
    "technical",
    "the",
    "there",
  ]);
  const addNameMatches = (pattern: RegExp, group = 1) => {
    const globalPattern = pattern.global
      ? pattern
      : new RegExp(pattern.source, `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      const token = normalizePiiToken(String(match[group] || ""));
      const parts = token.split(/\s+/).filter(Boolean);
      const personParts = parts.filter((part) =>
        part.length >= 3 && !nonPersonNameParts.has(part)
      );
      if (personParts.length > 0) {
        // Keep a full multi-part personal name only when the phrase contains no
        // organization/team vocabulary. "ACEZONE Team" and "Customer Service
        // Team" are brand identities, not PII; "Emil ACEZONE Team" still
        // contributes the personal part "Emil".
        if (
          parts.length > 1 &&
          parts.every((part) => !nonPersonNameParts.has(part))
        ) {
          tokens.add(token);
        }
        for (const part of personParts) tokens.add(part);
      }
      if (match[0] === "") globalPattern.lastIndex += 1;
    }
  };

  addMatches(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  for (const token of collectPhoneLikeTokens(text)) tokens.add(token);
  addMatches(
    /(?:order|ordre|ordrenummer|tracking|track|serial|serienummer|telefon|phone|postal|postnummer|zip)\s*(?:number|nummer|nr\.?|no\.?|#|:)?\s*([A-Z0-9-]{4,})/gi,
    1,
  );
  addNameMatches(
    new RegExp(
      String
        .raw`(?:[Mm]y name is|[Jj]eg hedder|[Nn]ame|[Nn]avn)\s*(?:[Ii]s|[Ee]r|:)?\s*(${PERSON_NAME_WORD_SOURCE}(?:\s+${PERSON_NAME_WORD_SOURCE}){0,3})${PERSON_NAME_BOUNDARY_SOURCE}`,
      "gu",
    ),
  );
  addNameMatches(
    new RegExp(
      String
        .raw`(?:^|\n)\s*(?:[Hh]i|[Hh]ello|[Hh]ey|[Hh]ej|[Hh]ejsa|[Kk]ære|[Dd]ear|[Hh]allo|[Bb]onjour|[Hh]ola|[Cc]iao)\s+(${PERSON_NAME_WORD_SOURCE}(?:\s+${PERSON_NAME_WORD_SOURCE}){0,2})${PERSON_NAME_BOUNDARY_SOURCE}`,
      "gu",
    ),
  );
  addNameMatches(
    new RegExp(
      String
        .raw`(?:[Bb]est regards|[Kk]ind regards|[Ww]arm regards|[Rr]egards|[Ss]incerely|[Cc]heers|[Mm]ed venlig hilsen|[Vv]enlig hilsen|[Dd]e bedste hilsner|[Mm]ange hilsner|[Mm]vh)\s*[,!:\-]?\s*(?:\n\s*)?(${PERSON_NAME_WORD_SOURCE}(?:\s+${PERSON_NAME_WORD_SOURCE}){0,2})${PERSON_NAME_BOUNDARY_SOURCE}`,
      "gu",
    ),
  );
  addMatches(
    /\b(\d{4,6}\s+[A-ZÆØÅÄÖÜ][A-ZÆØÅÄÖÜa-zæøåäöüß'’-]{2,30}(?:\s+[A-ZÆØÅÄÖÜ][A-ZÆØÅÄÖÜa-zæøåäöüß'’-]{1,30}){0,2})\b/g,
    1,
  );

  for (const line of text.split(/\r?\n/)) {
    if (
      line.length <= 120 &&
      /\d/.test(line) &&
      /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|drive|boulevard|vej|gade|all[eé]|strasse|straße|rue)\b/i
        .test(
          line,
        )
    ) {
      const token = normalizePiiToken(line);
      if (token.length >= 5) tokens.add(token);
    }
  }
  return Array.from(tokens);
}

function containsStandalonePiiToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

/** Fail closed when deterministic checks find PII that survived redaction. */
export function hasResidualZendeskPii(
  raw: ZendeskRedactionFields,
  redacted: ZendeskRedactionFields,
): boolean {
  const rawText = Object.values(raw).join("\n");
  const redactedText = Object.values(redacted).join("\n");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(redactedText)) {
    return true;
  }
  if (collectPhoneLikeTokens(redactedText).length > 0) return true;

  const normalizedOutput = normalizePiiToken(redactedText);
  return collectExplicitPiiTokens(rawText).some((token) =>
    containsStandalonePiiToken(normalizedOutput, token)
  );
}

export function mergeZendeskImportTags(
  existing: unknown,
  required = ["pii_scrubbed", "final_agent_anchor_v1"],
): string[] {
  const tags = Array.isArray(existing)
    ? existing.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...tags, ...required]));
}

export type ZendeskRefreshCuration = {
  tags: string[];
  intent: string | null;
  language: string | null;
  csat_score: number | null;
  outcome: "inserted" | "refreshed";
};

/**
 * Preserve pair-level labels only when the exact customer/agent comment anchor
 * is unchanged. A legacy or newly changed anchor is a different training
 * example and must be reviewed again.
 */
export function planZendeskRefreshCuration(input: {
  existing?: {
    tags?: unknown;
    intent?: unknown;
    language?: unknown;
    csat_score?: unknown;
  } | null;
  anchorTag: string;
  jobId: string;
}): ZendeskRefreshCuration {
  const existingTags = Array.isArray(input.existing?.tags)
    ? input.existing.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  const creationTag = `zendesk_import_job:${input.jobId}`;
  const sameAnchor = existingTags.includes(input.anchorTag);
  const insertedByThisJob = existingTags.includes(creationTag);
  const outcome = !input.existing || insertedByThisJob
    ? "inserted"
    : "refreshed";
  const preservedTags = sameAnchor
    ? existingTags
    : existingTags.filter((tag) =>
      tag === "pii_scrubbed" ||
      tag === "migrated_from_agent_knowledge" ||
      tag.startsWith("zendesk_import_job:")
    );
  const requiredTags = [
    "pii_scrubbed",
    "final_agent_anchor_v1",
    input.anchorTag,
    ...(!input.existing ? [creationTag] : []),
    ...(input.existing && !sameAnchor ? ["pair_labels_reset_v1"] : []),
  ];

  return {
    tags: mergeZendeskImportTags(preservedTags, requiredTags),
    intent: sameAnchor && typeof input.existing?.intent === "string"
      ? input.existing.intent
      : null,
    language: sameAnchor && typeof input.existing?.language === "string"
      ? input.existing.language
      : null,
    csat_score: sameAnchor && typeof input.existing?.csat_score === "number"
      ? input.existing.csat_score
      : null,
    outcome,
  };
}

export function countZendeskRefreshResults(
  externalTicketIds: string[],
  existingExternalTicketIds: Iterable<string>,
): { inserted: number; updated: number } {
  const existing = new Set(
    Array.from(existingExternalTicketIds, (id) => String(id)),
  );
  const uniqueIds = Array.from(
    new Set(externalTicketIds.map((id) => String(id))),
  );
  const updated = uniqueIds.filter((id) => existing.has(id)).length;
  return { inserted: uniqueIds.length - updated, updated };
}

/**
 * Build the same leak-free reply anchor used by the live Zendesk eval:
 * - ground truth is the final eligible public agent reply
 * - input is the last customer turn before that reply
 * - context contains only turns strictly before the input customer turn
 *
 * Callers remain responsible for filtering private comments, auto-replies and
 * empty bodies before invoking this helper.
 */
export type ZendeskAnchorFailureReason =
  | "no_public_human_turns"
  | "no_public_agent_reply"
  | "no_customer_before_final_agent";

export type ZendeskAnchorAnalysis =
  | { anchored: AnchoredZendeskReply; reason: null }
  | { anchored: null; reason: ZendeskAnchorFailureReason };

export function analyzeZendeskReplyAnchor(
  turns: ZendeskConversationTurn[],
): ZendeskAnchorAnalysis {
  const conversation = (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const sourceId = String(turn?.sourceId || "").trim();
      return {
        role: turn?.role,
        body: String(turn?.body || "").trim(),
        ...(sourceId ? { sourceId } : {}),
      };
    })
    .filter((turn): turn is ZendeskConversationTurn =>
      (turn.role === "customer" || turn.role === "agent") && Boolean(turn.body)
    );

  if (conversation.length === 0) {
    return { anchored: null, reason: "no_public_human_turns" };
  }

  let lastAgentIndex = -1;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === "agent") {
      lastAgentIndex = index;
      break;
    }
  }
  if (lastAgentIndex < 0) {
    return { anchored: null, reason: "no_public_agent_reply" };
  }

  let answeredCustomerIndex = -1;
  for (let index = lastAgentIndex - 1; index >= 0; index -= 1) {
    if (conversation[index].role === "customer") {
      answeredCustomerIndex = index;
      break;
    }
  }
  if (answeredCustomerIndex < 0) {
    return { anchored: null, reason: "no_customer_before_final_agent" };
  }

  const priorTurns = conversation.slice(0, answeredCustomerIndex);
  const conversationContext = priorTurns.length > 0
    ? priorTurns
      .map((turn) =>
        `${turn.role === "customer" ? "Customer" : "Agent"}: ${turn.body}`
      )
      .join("\n\n")
    : null;

  return {
    anchored: {
      customerBody: conversation[answeredCustomerIndex].body,
      agentReply: conversation[lastAgentIndex].body,
      conversationContext,
      multiTurn: priorTurns.length > 0,
      ...(conversation[answeredCustomerIndex].sourceId
        ? { customerTurnId: conversation[answeredCustomerIndex].sourceId }
        : {}),
      ...(conversation[lastAgentIndex].sourceId
        ? { agentTurnId: conversation[lastAgentIndex].sourceId }
        : {}),
    },
    reason: null,
  };
}

export function anchorFinalAgentReply(
  turns: ZendeskConversationTurn[],
): AnchoredZendeskReply | null {
  return analyzeZendeskReplyAnchor(turns).anchored;
}

export function estimateImportCost(input: { ticketCount: number }): {
  ticketCount: number;
  usd: number;
  dkk: number;
} {
  const n = Math.max(0, Math.floor(Number(input?.ticketCount ?? 0)));
  const usd = Math.round(n * USD_PER_TICKET * 100) / 100;
  const dkk = Math.round(usd * DKK_PER_USD * 100) / 100;
  return { ticketCount: n, usd, dkk };
}

export function nextCursor(input: {
  statuses: string[];
  cursor: { status: string; page: number } | null;
  pageHadFullBatch: boolean;
}): { status: string; page: number } | null {
  const statuses = input?.statuses ?? [];
  if (!statuses.length) return null;
  if (!input?.cursor) return { status: statuses[0], page: 1 };
  const { status, page } = input.cursor;
  if (input.pageHadFullBatch) return { status, page: page + 1 };
  const idx = statuses.indexOf(status);
  if (idx === -1 || idx === statuses.length - 1) return null;
  return { status: statuses[idx + 1], page: 1 };
}

export function nextExportCursor(input: {
  statuses: string[];
  cursor: { status: string; after: string | null };
  hasMore: boolean;
  afterCursor: string | null;
  now?: string;
}): { status: string; after: string | null; after_created_at?: string } | null {
  if (input.hasMore) {
    const afterCursor = String(input.afterCursor || "").trim();
    if (!afterCursor) {
      throw new Error(
        "Zendesk export pagination claimed more results without a cursor.",
      );
    }
    return {
      status: input.cursor.status,
      after: afterCursor,
      after_created_at: input.now ?? new Date().toISOString(),
    };
  }
  const index = input.statuses.indexOf(input.cursor.status);
  if (index < 0 || index >= input.statuses.length - 1) return null;
  return { status: input.statuses[index + 1], after: null };
}

export function isRetryableImportStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function parseRetryAfterMs(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

export function importRetryDelayMs(input: {
  attempt: number;
  retryAfterMs?: number | null;
}): number {
  const attempt = Math.max(0, Math.floor(input?.attempt ?? 0));
  const exponential = Math.min(12_000, 750 * 2 ** attempt);
  return Math.max(exponential, Math.min(15_000, input?.retryAfterMs ?? 0));
}
