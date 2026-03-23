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

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeWhitespace(value) {
  return normalizeNewlines(value).replace(/[ \t]+\n/g, "\n").trim();
}

function stripLeadingNoise(text) {
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").trimEnd());
  let index = 0;
  while (index < lines.length) {
    const trimmed = String(lines[index] || "").trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (!LEADING_NOISE_RE.some((pattern) => pattern.test(trimmed))) break;
    index += 1;
  }
  const cleaned = lines.slice(index).join("\n").trim();
  return cleaned || normalizeWhitespace(text);
}

function isHeaderCluster(lines, startIndex) {
  const window = lines.slice(startIndex, startIndex + 7);
  const headerMatches = window.filter((line) => HEADER_LINE_RE.test(String(line || "").trim()));
  if (headerMatches.length >= 3) return true;
  if (headerMatches.length >= 2 && /^(?:from|fra|från)\s*:/i.test(String(lines[startIndex] || "").trim())) {
    return true;
  }
  return false;
}

function classifyQuotedLine(lines, index) {
  const trimmed = String(lines[index] || "").trim();
  if (!trimmed) return null;
  if (ZENDESK_MARKER_RE.test(trimmed)) return "zendesk_marker";
  if (trimmed.startsWith(">")) return "angle_quote";
  if (QUOTED_INTRO_RE.test(trimmed)) return "quoted_intro";
  if (FORWARDED_SEPARATOR_RE.test(trimmed)) return "forwarded_separator";
  if (isHeaderCluster(lines, index)) return "header_block";
  return null;
}

function splitTextBody(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return { cleanBodyText: "", quotedBodyText: null };
  }
  const lines = normalized.split("\n");
  let offset = 0;
  let sawNonEmptyContent = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = String(line || "").trim();
    if (trimmed) sawNonEmptyContent = true;
    if (!sawNonEmptyContent) {
      offset += line.length + 1;
      continue;
    }
    if (classifyQuotedLine(lines, index)) {
      return {
        cleanBodyText: stripLeadingNoise(normalized.slice(0, offset).trim()),
        quotedBodyText: normalized.slice(offset).trim() || null,
      };
    }
    offset += line.length + 1;
  }

  return { cleanBodyText: stripLeadingNoise(normalized), quotedBodyText: null };
}

export function deriveMessageBodies(message) {
  const storedCleanText = String(message?.clean_body_text || "").trim();
  const storedQuotedText = String(message?.quoted_body_text || "").trim();
  const storedCleanHtml = String(message?.clean_body_html || "").trim();
  const storedQuotedHtml = String(message?.quoted_body_html || "").trim();
  const rawBodyHtml = String(message?.body_html || "").trim();

  if (storedCleanText || storedQuotedText || storedCleanHtml || storedQuotedHtml) {
    return {
      cleanBodyText: storedCleanText || normalizeWhitespace(message?.body_text || ""),
      quotedBodyText: storedQuotedText || null,
      cleanBodyHtml: storedCleanHtml || null,
      quotedBodyHtml: storedQuotedHtml || null,
    };
  }

  const fallback = splitTextBody(message?.body_text || message?.snippet || "");
  return {
    cleanBodyText:
      fallback.cleanBodyText || normalizeWhitespace(message?.body_text || message?.snippet || ""),
    quotedBodyText: fallback.quotedBodyText,
    cleanBodyHtml: rawBodyHtml || null,
    quotedBodyHtml: null,
  };
}
