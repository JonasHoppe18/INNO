type ReplyParserStrategy =
  | "empty"
  | "raw_fallback"
  | "zendesk_marker"
  | "on_wrote"
  | "forwarded_separator"
  | "header_block"
  | "header_block_scandinavian"
  | "outlook_ios_signature"
  | "angle_quote"
  | "gmail_quote"
  | "blockquote";

type ParsedEmailBodies = {
  cleanBodyText: string;
  quotedBodyText: string | null;
  cleanBodyHtml: string | null;
  quotedBodyHtml: string | null;
  parserStrategy: ReplyParserStrategy;
  quotedHistoryDetected: boolean;
  cleanExtractionSucceeded: boolean;
  matchedBoundaryLine: string | null;
  cleanBodyPreview: string;
};

const QUOTED_INTRO_RE =
  /^(?:(?:on|den|d\.) .{0,240} (?:wrote|skrev|schrieb|a écrit)\s*:|(?:fra|from|från)\s*:.*(?:\n|$))/i;
const FORWARDED_SEPARATOR_RE =
  /^(?:-+\s*(?:original message|forwarded message|videresendt besked|oprindelig meddelelse)\s*-+|begin forwarded message:|videresendt besked:|oprindelig meddelelse|[-_]{2,}\s*forwarded by zendesk\s*[-_]{2,})$/i;
const ZENDESK_MARKER_RE =
  /^(?:##-\s*)?(?:please type your reply above this line|reply above this line|skriv venligst dit svar over denne linje|svar venligst over denne linje)(?:\s*-##)?$/i;
const HEADER_LINE_RE =
  /^(?:from|sent|date|to|subject|cc|bcc|fra|sendt|dato|til|emne|kopi|från|skickat)\s*:/i;
const LEADING_NOISE_RE = [
  /^(?:##-\s*)?(?:please type your reply above this line|reply above this line)(?:\s*-##)?$/i,
  /^your request\s*(?:\(#?\d+\))?\s*has been updated\.?$/i,
  /^to add additional comments, reply to this email\.?$/i,
  /^you can add a comment by replying to this email\.?$/i,
  /^this email is a service from zendesk\.?$/i,
];

const HTML_MARKERS: Array<{ strategy: ReplyParserStrategy; pattern: RegExp }> = [
  { strategy: "zendesk_marker", pattern: /##-\s*please type your reply above this line\s*-##/i },
  { strategy: "zendesk_marker", pattern: /reply above this line/i },
  { strategy: "gmail_quote", pattern: /<div\b[^>]*class=(["'])gmail_quote\1/i },
  { strategy: "blockquote", pattern: /<blockquote\b/i },
  { strategy: "blockquote", pattern: /<hr\b[^>]*id=(["'])replySplit\1/i },
  { strategy: "blockquote", pattern: /<!--\s*OriginalMessageHeader\s*-->/i },
  { strategy: "forwarded_separator", pattern: /-{2,}\s*(?:Original Message|Forwarded message|Forwarded by Zendesk)\s*-{2,}/i },
  { strategy: "on_wrote", pattern: /(?:^|>|\s)(?:On|Den|Fra|From)[\s\S]{0,240}?(?:wrote:|skrev:|schrieb:)/i },
];

const CANONICAL_HEADER_PREFIXES = [
  "from",
  "sent",
  "date",
  "to",
  "subject",
  "cc",
  "bcc",
  "fra",
  "sendt",
  "dato",
  "til",
  "emne",
  "kopi",
  "fran",
  "skickat",
  "till",
  "amne",
];

const SCANDINAVIAN_HEADER_PREFIXES = [
  "fra",
  "sendt",
  "dato",
  "til",
  "emne",
  "kopi",
  "fran",
  "skickat",
  "till",
  "amne",
];

const OUTLOOK_IOS_SIGNATURE_RE =
  /^(?:sent from outlook for ios|sendt fra outlook til ios|sendt fra outlook for ios|get outlook for ios)$/i;

function normalizeNewlines(value: string) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeWhitespace(value: string) {
  return normalizeNewlines(value).replace(/[ \t]+\n/g, "\n").trim();
}

function stripLeadingNoise(text: string) {
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").trimEnd());
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (!LEADING_NOISE_RE.some((pattern) => pattern.test(trimmed))) {
      break;
    }
    index += 1;
  }
  const cleaned = lines.slice(index).join("\n").trim();
  return cleaned || normalizeWhitespace(text);
}

function canonicalizeLine(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .toLowerCase();
}

function getHeaderPrefix(line: string) {
  const canonical = canonicalizeLine(line);
  const match = canonical.match(/^([a-z]+)\s*:/);
  const prefix = match?.[1] || "";
  return CANONICAL_HEADER_PREFIXES.includes(prefix) ? prefix : null;
}

function detectHeaderBlock(lines: string[], startIndex: number) {
  let headerCount = 0;
  let scandinavianCount = 0;
  let firstHeaderPrefix: string | null = null;
  let subjectLikeCount = 0;
  let consumedNonEmpty = 0;

  for (let index = startIndex; index < lines.length && index < startIndex + 10; index += 1) {
    const line = String(lines[index] || "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    consumedNonEmpty += 1;
    const prefix = getHeaderPrefix(trimmed);
    if (!prefix) {
      break;
    }
    if (!firstHeaderPrefix) firstHeaderPrefix = prefix;
    headerCount += 1;
    if (SCANDINAVIAN_HEADER_PREFIXES.includes(prefix)) scandinavianCount += 1;
    if (["subject", "emne", "amne"].includes(prefix)) subjectLikeCount += 1;
  }

  if (!headerCount) {
    return null;
  }

  const beginsLikeReplyHeader = ["from", "fra", "fran", "sent", "sendt", "skickat"].includes(
    firstHeaderPrefix || "",
  );
  const isValidCluster =
    headerCount >= 3 ||
    (headerCount >= 2 && beginsLikeReplyHeader) ||
    (headerCount >= 2 && subjectLikeCount >= 1);

  if (!isValidCluster) return null;

  return {
    strategy:
      scandinavianCount > 0 ? ("header_block_scandinavian" as const) : ("header_block" as const),
    consumedNonEmpty,
  };
}

function hasHeaderBlockAfterSignature(lines: string[], startIndex: number) {
  for (let index = startIndex + 1; index < lines.length && index <= startIndex + 7; index += 1) {
    const trimmed = String(lines[index] || "").trim();
    if (!trimmed) continue;
    const headerBlock = detectHeaderBlock(lines, index);
    return Boolean(headerBlock);
  }
  return false;
}

function classifyQuotedLine(lines: string[], index: number) {
  const trimmed = lines[index]?.trim() || "";
  if (!trimmed) return null;
  const canonical = canonicalizeLine(trimmed);
  if (ZENDESK_MARKER_RE.test(trimmed)) {
    return { strategy: "zendesk_marker" as const, boundaryLine: trimmed };
  }
  if (OUTLOOK_IOS_SIGNATURE_RE.test(canonical) && hasHeaderBlockAfterSignature(lines, index)) {
    return { strategy: "outlook_ios_signature" as const, boundaryLine: trimmed };
  }
  if (trimmed.startsWith(">")) {
    return { strategy: "angle_quote" as const, boundaryLine: trimmed };
  }
  if (QUOTED_INTRO_RE.test(trimmed)) {
    return { strategy: "on_wrote" as const, boundaryLine: trimmed };
  }
  if (FORWARDED_SEPARATOR_RE.test(trimmed)) {
    return { strategy: "forwarded_separator" as const, boundaryLine: trimmed };
  }
  const headerBlock = detectHeaderBlock(lines, index);
  if (headerBlock) {
    return { strategy: headerBlock.strategy, boundaryLine: trimmed };
  }
  return null;
}

function findTextQuotedSplit(text: string) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");
  let offset = 0;
  let sawNonEmptyContent = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed) sawNonEmptyContent = true;
    if (!sawNonEmptyContent) {
      offset += line.length + 1;
      continue;
    }
    const match = classifyQuotedLine(lines, index);
    if (match) {
      return { index: offset, strategy: match.strategy, boundaryLine: match.boundaryLine };
    }
    offset += line.length + 1;
  }

  return {
    index: -1,
    strategy: null as ReplyParserStrategy | null,
    boundaryLine: null as string | null,
  };
}

function trimHtmlBoundary(html: string, fromStart: boolean) {
  if (!html) return "";
  return fromStart
    ? html.replace(/^(?:\s|<br\s*\/?>|&nbsp;)+/gi, "")
    : html.replace(/(?:\s|<br\s*\/?>|&nbsp;)+$/gi, "");
}

function stripLeadingNoiseHtml(html: string) {
  let next = String(html || "").trim();
  next = next.replace(/^(?:\s|<div[^>]*>\s*<\/div>|<p[^>]*>\s*<\/p>|<br\s*\/?>)+/gi, "");
  next = next.replace(
    /^(?:<div[^>]*>|<p[^>]*>)?\s*(?:##-\s*)?(?:please type your reply above this line|reply above this line)(?:\s*-##)?\s*(?:<\/div>|<\/p>)?/i,
    "",
  );
  return next.trim();
}

function findHtmlQuotedSplit(html: string) {
  const matches = HTML_MARKERS
    .map(({ strategy, pattern }) => {
      const match = pattern.exec(html);
      return typeof match?.index === "number" ? { index: match.index, strategy } : null;
    })
    .filter(Boolean) as Array<{ index: number; strategy: ReplyParserStrategy }>;

  if (!matches.length) {
    return {
      index: -1,
      strategy: null as ReplyParserStrategy | null,
      boundaryLine: null as string | null,
    };
  }
  matches.sort((a, b) => a.index - b.index);
  return { ...matches[0], boundaryLine: null as string | null };
}

function buildPreview(value: string, maxLength = 160) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function parseEmailReplyBodies(input: {
  text?: string | null;
  html?: string | null;
}): ParsedEmailBodies {
  const rawText = normalizeWhitespace(String(input?.text || ""));
  const rawHtml = String(input?.html || "").trim();

  if (!rawText && !rawHtml) {
    return {
      cleanBodyText: "",
      quotedBodyText: null,
      cleanBodyHtml: rawHtml || null,
      quotedBodyHtml: null,
      parserStrategy: "empty",
      quotedHistoryDetected: false,
      cleanExtractionSucceeded: false,
      matchedBoundaryLine: null,
      cleanBodyPreview: "",
    };
  }

  const textResult = rawText
    ? findTextQuotedSplit(rawText)
    : { index: -1, strategy: null as ReplyParserStrategy | null, boundaryLine: null as string | null };
  const htmlResult = rawHtml
    ? findHtmlQuotedSplit(rawHtml)
    : { index: -1, strategy: null as ReplyParserStrategy | null, boundaryLine: null as string | null };

  const quotedBodyText =
    textResult.index >= 0 ? rawText.slice(textResult.index).trim() || null : null;
  const initialCleanText =
    textResult.index >= 0 ? rawText.slice(0, textResult.index).trim() : rawText;
  const cleanBodyText = stripLeadingNoise(initialCleanText);

  const cleanBodyHtml =
    htmlResult.index >= 0
      ? trimHtmlBoundary(stripLeadingNoiseHtml(rawHtml.slice(0, htmlResult.index)), false) || null
      : quotedBodyText
      ? null
      : stripLeadingNoiseHtml(rawHtml) || null;
  const quotedBodyHtml =
    htmlResult.index >= 0
      ? trimHtmlBoundary(rawHtml.slice(htmlResult.index), true) || null
      : null;

  const parserStrategy =
    textResult.strategy ||
    htmlResult.strategy ||
    (cleanBodyText && cleanBodyText !== rawText ? "zendesk_marker" : rawText || rawHtml ? "raw_fallback" : "empty");
  const quotedHistoryDetected = Boolean(quotedBodyText || quotedBodyHtml);
  const cleanExtractionSucceeded = Boolean(
    cleanBodyText &&
      normalizeWhitespace(cleanBodyText) &&
      normalizeWhitespace(cleanBodyText) !== normalizeWhitespace(rawText || "") &&
      quotedHistoryDetected,
  );
  const matchedBoundaryLine = textResult.boundaryLine || htmlResult.boundaryLine || null;
  const cleanBodyPreview = buildPreview(cleanBodyText || rawText);

  return {
    cleanBodyText: cleanBodyText || rawText,
    quotedBodyText,
    cleanBodyHtml,
    quotedBodyHtml,
    parserStrategy,
    quotedHistoryDetected,
    cleanExtractionSucceeded,
    matchedBoundaryLine,
    cleanBodyPreview,
  };
}
