type ReplyParserStrategy =
  | "empty"
  | "raw_fallback"
  | "zendesk_marker"
  | "quoted_intro"
  | "forwarded_separator"
  | "header_block"
  | "angle_quote"
  | "html_quote";

type ParsedEmailBodies = {
  cleanBodyText: string;
  quotedBodyText: string | null;
  cleanBodyHtml: string | null;
  quotedBodyHtml: string | null;
  parserStrategy: ReplyParserStrategy;
  quotedHistoryDetected: boolean;
  cleanExtractionSucceeded: boolean;
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
  { strategy: "html_quote", pattern: /<div\b[^>]*class=(["'])gmail_quote\1/i },
  { strategy: "html_quote", pattern: /<blockquote\b/i },
  { strategy: "html_quote", pattern: /<hr\b[^>]*id=(["'])replySplit\1/i },
  { strategy: "html_quote", pattern: /<!--\s*OriginalMessageHeader\s*-->/i },
  { strategy: "forwarded_separator", pattern: /-{2,}\s*(?:Original Message|Forwarded message|Forwarded by Zendesk)\s*-{2,}/i },
  { strategy: "quoted_intro", pattern: /(?:^|>|\s)(?:On|Den|Fra|From)[\s\S]{0,240}?(?:wrote:|skrev:|schrieb:)/i },
];

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

function isHeaderCluster(lines: string[], startIndex: number) {
  const window = lines.slice(startIndex, startIndex + 7);
  const headerMatches = window.filter((line) => HEADER_LINE_RE.test(line.trim()));
  if (headerMatches.length >= 3) return true;
  if (headerMatches.length >= 2 && /^(?:from|fra|från)\s*:/i.test(lines[startIndex]?.trim() || "")) {
    return true;
  }
  return false;
}

function classifyQuotedLine(lines: string[], index: number): ReplyParserStrategy | null {
  const trimmed = lines[index]?.trim() || "";
  if (!trimmed) return null;
  if (ZENDESK_MARKER_RE.test(trimmed)) return "zendesk_marker";
  if (trimmed.startsWith(">")) return "angle_quote";
  if (QUOTED_INTRO_RE.test(trimmed)) return "quoted_intro";
  if (FORWARDED_SEPARATOR_RE.test(trimmed)) return "forwarded_separator";
  if (isHeaderCluster(lines, index)) return "header_block";
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
    const strategy = classifyQuotedLine(lines, index);
    if (strategy) {
      return { index: offset, strategy };
    }
    offset += line.length + 1;
  }

  return { index: -1, strategy: null as ReplyParserStrategy | null };
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

  if (!matches.length) return { index: -1, strategy: null as ReplyParserStrategy | null };
  matches.sort((a, b) => a.index - b.index);
  return matches[0];
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
    };
  }

  const textResult = rawText ? findTextQuotedSplit(rawText) : { index: -1, strategy: null };
  const htmlResult = rawHtml ? findHtmlQuotedSplit(rawHtml) : { index: -1, strategy: null };

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

  return {
    cleanBodyText: cleanBodyText || rawText,
    quotedBodyText,
    cleanBodyHtml,
    quotedBodyHtml,
    parserStrategy,
    quotedHistoryDetected,
    cleanExtractionSucceeded,
  };
}
