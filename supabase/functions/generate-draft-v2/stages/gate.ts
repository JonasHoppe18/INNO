// supabase/functions/generate-draft-v2/stages/gate.ts

export interface GateInput {
  thread: Record<string, unknown>;
  latestMessage: Record<string, unknown>;
  shop: Record<string, unknown>;
}

export interface GateResult {
  should_process: boolean;
  reason: string;
}

const FORWARDED_SEPARATOR_RE =
  /(?:^|\n)\s*(?:-+\s*(?:forwarded message|original message|videresendt besked|oprindelig meddelelse)\s*-+|begin forwarded message:|videresendt besked:|oprindelig meddelelse|[-_]{2,}\s*forwarded by zendesk\s*[-_]{2,})\s*(?:\n|$)/i;

const FORWARDED_HEADER_RE =
  /\b(?:From|Fra|Date|Dato|Sent|Sendt|Subject|Emne|To|Til|Cc):\s*.+/i;

function stripHtml(text: string): string {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ");
}

function normalizeWhitespace(text: string): string {
  return stripHtml(text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeDirectCustomerRequest(text: string): boolean {
  const value = normalizeWhitespace(text).toLowerCase();
  if (!value) return false;
  if (/[?？]/.test(value)) return true;
  return /\b(?:please|pls|can you|could you|would you|help|need|i need|we need|how do|how can|what should|what do|kan i|kan du|kan jeg|hjælp|hvad gør|hvad skal|jeg vil|vi vil|vil gerne|bedes|venligst)\b/i
    .test(value);
}

function looksLikeInternalForwardPreface(text: string): boolean {
  const value = normalizeWhitespace(text);
  if (!value) return false;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 45 || value.length > 350) return false;
  if (looksLikeDirectCustomerRequest(value)) return false;

  const lower = value.toLowerCase();
  const hasStatusLanguage =
    /\b(?:modtaget|mottaget|received|arrived|registreret|registered|repair|reparation|rma|return|retur|warranty|garanti|case|sag|ticket|claim|replacement|ombytning)\b/i
      .test(lower);
  const hasLogShape =
    /\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(lower) ||
    /\b\d+\s*(?:stk|pcs?|piece|pieces|x)\b/i.test(lower);

  return hasStatusLanguage || hasLogShape;
}

export function isForwardedInternalStatusNote(body: string): boolean {
  const value = normalizeWhitespace(body);
  const separatorMatch = value.match(FORWARDED_SEPARATOR_RE);
  if (!separatorMatch?.index) return false;

  const preface = value.slice(0, separatorMatch.index).trim();
  const forwardedPart = value.slice(separatorMatch.index + separatorMatch[0].length);
  if (!FORWARDED_HEADER_RE.test(forwardedPart)) return false;

  return looksLikeInternalForwardPreface(preface);
}

export async function runGate(
  { latestMessage }: GateInput,
): Promise<GateResult> {
  const msg = latestMessage as {
    clean_body_text?: string;
    body_text?: string;
    from_email?: string;
    from_me?: boolean;
  };

  const body = msg.clean_body_text ?? msg.body_text ?? "";

  if (msg.from_me === true) {
    return { should_process: false, reason: "latest_message_from_agent" };
  }

  if (!body || body.trim().length < 5) {
    return { should_process: false, reason: "empty_body" };
  }

  // Skip auto-replies / delivery failures
  const lowerBody = body.toLowerCase();
  const isAutoReply = lowerBody.includes("mailer-daemon") ||
    lowerBody.includes("delivery status notification") ||
    lowerBody.includes("auto-reply") ||
    lowerBody.includes("out of office") ||
    lowerBody.includes("automatic reply");

  if (isAutoReply) {
    return { should_process: false, reason: "auto_reply" };
  }

  if (isForwardedInternalStatusNote(body)) {
    return { should_process: false, reason: "forwarded_internal_status_note" };
  }

  return { should_process: true, reason: "ok" };
}
