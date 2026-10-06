// URL-only Knowledge V2 ingestion.
//
// A submitted page is captured as immutable evidence first. The cleaner and
// extractor never publish anything: they only produce typed Returns proposals
// which remain in kn2_policies/kn2_review_items until a merchant approves them.

import { KnowledgeAuthzError } from "./authz.js";

const MAX_URL_LENGTH = 2048;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_CANONICAL_CHARS = 120_000;

function fail(code, message, status = 400) {
  throw new KnowledgeAuthzError(status, code, message);
}

export function normalizeSubmittedUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > MAX_URL_LENGTH) fail("invalid_url", "Enter a valid website URL.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("invalid_url", "Enter a valid website URL, including https://.");
  }
  if (!(parsed.protocol === "https:" || parsed.protocol === "http:")) {
    fail("invalid_url", "Only http:// and https:// website URLs can be captured.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0" ||
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    !hostname.includes(".")
  ) {
    fail("invalid_url", "Local or private network URLs cannot be captured.");
  }
  if (parsed.username || parsed.password) fail("invalid_url", "URLs with embedded credentials cannot be captured.");
  if (parsed.port && !((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80"))) {
    fail("invalid_url", "Custom ports are not supported for source capture.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const number = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(number, 0x10ffff)) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&copy;/gi, "©")
    .replace(/&reg;/gi, "®");
}

function removeElements(html, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  return html.replace(pattern, "\n");
}

function removeHiddenElements(html) {
  return html.replace(/<([a-z][\w:-]*)\b([^>]*(?:hidden|aria-hidden\s*=\s*["']?true|display\s*:\s*none|visibility\s*:\s*hidden)[^>]*)>[\s\S]*?<\/\1\s*>/gi, "\n");
}

// Deliberately small, dependency-free cleaner. It keeps block boundaries,
// headings, list entries, table rows/cells and FAQ text while dropping page
// chrome. The resulting text is evidence, not runtime Knowledge.
export function cleanHtmlToCanonicalText(html) {
  let value = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "nav", "form", "noscript", "svg", "iframe", "template", "head"]) value = removeElements(value, tag);
  value = removeHiddenElements(value);
  value = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<\/(?:td|th)\s*>/gi, "")
    .replace(/<\/(?:tr|p|div|section|article|main|aside|header|footer|h[1-6]|dt|dd|table|address)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  value = decodeHtml(value).replace(/\r/g, "");
  const lines = value
    .split(/\n+/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").replace(/\s+\|\s+/g, " | ").trim())
    .filter(Boolean);
  const canonical = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!canonical) fail("source_empty", "The page did not contain readable text.");
  return canonical.slice(0, MAX_CANONICAL_CHARS);
}

export function extractHtmlTitle(html, fallback = "Website source") {
  const match = String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = decodeHtml(match?.[1] ?? "").replace(/\s+/g, " ").trim();
  return title.slice(0, 160) || fallback;
}

export async function fetchUrlSource({ url, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const normalizedUrl = normalizeSubmittedUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Sona-Knowledge-Capture/0.1" },
    });
  } catch (error) {
    if (error?.name === "AbortError") fail("source_timeout", "The website took too long to respond.", 502);
    fail("source_fetch_failed", "Sona could not fetch that website. Check the URL and try again.", 502);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) fail("source_fetch_failed", `The website returned an error (${response.status}).`, 502);
  const contentType = String(response.headers?.get?.("content-type") ?? "").toLowerCase();
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    fail("unsupported_source", "This URL is not an HTML page. File and PDF ingestion are not available yet.");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_SOURCE_BYTES) fail("source_too_large", "This page is too large to capture. Try a more specific page.");
  const rawBytes = new Uint8Array(buffer);
  const html = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
  const canonicalText = cleanHtmlToCanonicalText(html);
  const finalUrl = normalizeSubmittedUrl(response.url || normalizedUrl);
  return {
    url: normalizedUrl,
    finalUrl,
    status: response.status,
    mime: contentType || "text/html",
    title: extractHtmlTitle(html, new URL(finalUrl).hostname),
    html,
    rawBytes,
    canonicalText,
  };
}

export function friendlyReturnsProposal(draft) {
  const titles = {
    accepted: "Whether returns are accepted",
    window: "Return window",
    method: "How to start a return",
    shipping: "Tracked return shipping",
    payer: "Who pays return shipping",
    address: "Return destination",
    destination: "Return destination guidance",
    refund_expectation: "Refund timing",
    timing: "Refund timing rule",
    exchange: "Exchange availability",
    restocking_none: "Restocking fee",
    item_conditions: "Return condition requirements",
  };
  const payload = draft?.payload ?? {};
  const value = payload.value ?? {};
  const summaryByKey = {
    accepted: value.accepted === false ? "The captured policy says returns are not accepted." : "The captured policy says returns are accepted.",
    window: value.duration?.amount ? `Eligible items can be returned within ${value.duration.amount} ${value.duration.unit === "calendar_day" ? "calendar days" : value.duration.unit}.` : "The captured policy defines a return window.",
    payer: value.payer === "merchant" ? "The merchant pays the return shipping." : "The customer arranges and pays the return shipping.",
    shipping: "The captured policy requires a tracked return shipping service.",
    refund_expectation: "The refund is initiated after the return reaches the merchant and the stated processing event occurs.",
    exchange: payload.state === "explicitly_none" || value.offered === false ? "The captured policy does not offer exchanges." : "The captured policy offers exchanges.",
  };
  return {
    title: titles[draft?.key] || "Returns guidance",
    summary: summaryByKey[draft?.key] || "A typed Returns proposal grounded in the captured source.",
    applicability: ["All supported products"],
    evidence: Array.isArray(draft?.evidence) ? draft.evidence[0] || "" : "",
  };
}

export function sourceStages() {
  return ["Capturing source", "Reading source", "Preparing proposals", "Ready for review"];
}

export function detectUnsupportedSections(canonicalText) {
  const text = String(canonicalText ?? "");
  const findings = [];
  const checks = [
    ["warranty", /\bwarranty\b|\bgaranti\b/i, "This source includes warranty guidance. URL Returns ingestion keeps it as evidence, but does not publish Warranty rules from this flow."],
    ["complaints", /\bcomplaint\b|\breklamation\b|\bdispute\b/i, "This source includes complaint or dispute guidance. It remains source evidence until the Warranty / Complaints contract is reviewed."],
    ["delivery", /\bshipping policy\b|carrier scan|dispatch(?:ed|ment)?|delivery exception|tracking number|delivery estimate/i, "This source includes delivery guidance. It is not converted into Returns Knowledge by this URL flow."],
  ];
  for (const [code, pattern, message] of checks) {
    const match = text.split(/\n+/).find((line) => pattern.test(line));
    if (match) findings.push({ code: `unsupported_${code}`, message, evidence: match.slice(0, 1200) });
  }
  return findings;
}
