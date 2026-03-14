type EmailHeader = { name: string; value: string };

export type InboxClassification = {
  bucket: "ticket" | "notification";
  reason: string;
  score: number;
};

type InboxClassificationInput = {
  from?: string | null;
  subject?: string | null;
  body?: string | null;
  headers?: EmailHeader[] | Record<string, string> | null;
};

const AUTO_SENDER_PATTERNS = [
  /(^|[^a-z])no[-_. ]?reply([^a-z]|$)/i,
  /(^|[^a-z])do[-_. ]?not[-_. ]?reply([^a-z]|$)/i,
  /(^|[^a-z])donotreply([^a-z]|$)/i,
  /mailer-daemon/i,
  /postmaster/i,
  /bounce/i,
  /notification/i,
  /notifications/i,
  /updates/i,
  /tracking/i,
  /shipment/i,
  /delivery/i,
  /receipts?/i,
  /billing/i,
  /orders?/i,
];

const AUTO_HEADER_RULES = [
  { name: "auto-submitted", test: (value: string) => value && value !== "no" },
  { name: "precedence", test: (value: string) => /bulk|list|junk|auto_reply/i.test(value) },
  { name: "x-auto-response-suppress", test: (value: string) => /all|dr|rn|nrn|oof/i.test(value) },
  { name: "x-autoreply", test: (value: string) => Boolean(value) },
  { name: "x-autorespond", test: (value: string) => Boolean(value) },
  { name: "x-ms-exchange-generated-message-source", test: (value: string) => Boolean(value) },
  { name: "feedback-id", test: (value: string) => Boolean(value) },
  { name: "list-id", test: (value: string) => Boolean(value) },
  { name: "list-unsubscribe", test: (value: string) => Boolean(value) },
];

const NOTIFICATION_PATTERNS = [
  /\border\s+(?:confirmation|confirmed|receipt)\b/i,
  /\bpayment\s+(?:confirmation|received|successful|processed)\b/i,
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\bshipment\b/i,
  /\bshipping\s+(?:confirmation|update|label|notice|notification|details|status)\b/i,
  /\btracking\s+(?:number|details|link|update|information)\b/i,
  /\bout\s+for\s+delivery\b/i,
  /\bdelivered\b/i,
  /\bdelivery\s+(?:confirmation|notice|notification|update|attempt)\b/i,
  /\bpackage\s+(?:has\s+)?(?:shipped|arrived|delivered)\b/i,
  /\byour\s+order\s+(?:has\s+)?(?:shipped|been\s+shipped|is\s+on\s+the\s+way|is\s+out\s+for\s+delivery|was\s+delivered)\b/i,
  /\bthanks?\s+for\s+your\s+order\b/i,
  /\bconfirmation\s+email\b/i,
  /\bthis\s+is\s+an\s+automated\b/i,
  /\bautomated\s+(?:message|email|notification|confirmation)\b/i,
  /\bdo\s+not\s+reply\b/i,
  /\bno[- ]?reply\b/i,
  /\bsystem-generated\b/i,
  /\btransaction(?:al)?\s+email\b/i,
  /\bsubscription\s+(?:confirmed|renewed|updated)\b/i,
  /\baccount\s+(?:verification|confirmed|updated)\b/i,
  /\blogin\s+code\b/i,
  /\bsecurity\s+code\b/i,
  /\bpassword\s+reset\b/i,
];

const HUMAN_SUPPORT_PATTERNS = [
  /\?/,
  /\bcan\s+you\b/i,
  /\bcould\s+you\b/i,
  /\bwould\s+you\b/i,
  /\bplease\s+help\b/i,
  /\bi\s+need\b/i,
  /\bi\s+want\b/i,
  /\bi\s+would\s+like\b/i,
  /\bwhere\s+is\s+my\s+(?:order|package)\b/i,
  /\bmy\s+(?:order|package)\b/i,
  /\bnot\s+delivered\b/i,
  /\bhas(?:n't| not)\s+arrived\b/i,
  /\bwrong\s+(?:item|product|size|color)\b/i,
  /\bdamaged\b/i,
  /\bdefective\b/i,
  /\breturn\b/i,
  /\brefund\b/i,
  /\bcancel\b/i,
  /\bexchange\b/i,
];

function normalizeHeaders(headers?: EmailHeader[] | Record<string, string> | null) {
  if (!headers) return {} as Record<string, string>;
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, header) => {
      if (!header?.name) return acc;
      acc[header.name.toLowerCase()] = String(header.value ?? "").trim().toLowerCase();
      return acc;
    }, {});
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      String(value ?? "").trim().toLowerCase(),
    ]),
  );
}

function extractSenderEmail(from: string): string {
  const match = String(from || "").match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  const emailMatch = String(from || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0].trim().toLowerCase() : String(from || "").trim().toLowerCase();
}

function countMatches(patterns: RegExp[], value: string): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

export function classifyInboxBucket(input: InboxClassificationInput): InboxClassification {
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  const normalizedSubject = subject.toLowerCase();
  const normalizedBody = body.toLowerCase();
  const combined = `${normalizedSubject}\n${normalizedBody}`;
  const senderEmail = extractSenderEmail(String(input.from || ""));
  const senderLocalPart = senderEmail.split("@")[0] || senderEmail;
  const headers = normalizeHeaders(input.headers);

  let notificationScore = 0;
  let ticketScore = 0;
  const reasons: string[] = [];

  const senderHits = countMatches(AUTO_SENDER_PATTERNS, senderLocalPart);
  if (senderHits > 0) {
    notificationScore += Math.min(3, senderHits + 1);
    reasons.push("auto_sender_pattern");
  }

  for (const rule of AUTO_HEADER_RULES) {
    if (rule.test(String(headers[rule.name] || ""))) {
      notificationScore += 2;
      reasons.push(`header:${rule.name}`);
    }
  }

  const notificationHits = countMatches(NOTIFICATION_PATTERNS, combined);
  if (notificationHits > 0) {
    notificationScore += notificationHits * 2;
    reasons.push("transactional_language");
  }

  const supportHits = countMatches(HUMAN_SUPPORT_PATTERNS, combined);
  if (supportHits > 0) {
    ticketScore += Math.min(4, supportHits);
    reasons.push("human_support_intent");
  }

  const bodyWordCount = normalizedBody.split(/\s+/).filter(Boolean).length;
  const hasAutoHeader = reasons.some((reason) => reason.startsWith("header:"));
  const hasSenderSignal = reasons.includes("auto_sender_pattern");
  const hasNotificationLanguage = reasons.includes("transactional_language");
  const hasSupportIntent = reasons.includes("human_support_intent");

  if ((hasAutoHeader || hasSenderSignal) && !hasSupportIntent && bodyWordCount <= 120) {
    notificationScore += 2;
    reasons.push("machine_like_structure");
  }

  if (subject && !body && hasNotificationLanguage) {
    notificationScore += 1;
    reasons.push("subject_only_transactional");
  }

  if (notificationScore >= 4 && ticketScore === 0) {
    return {
      bucket: "notification",
      reason: reasons.join(","),
      score: notificationScore,
    };
  }

  if (notificationScore >= 6 && ticketScore <= 1) {
    return {
      bucket: "notification",
      reason: reasons.join(","),
      score: notificationScore,
    };
  }

  return {
    bucket: "ticket",
    reason: hasSupportIntent ? reasons.join(",") : "default_ticket",
    score: Math.max(ticketScore, 1),
  };
}
