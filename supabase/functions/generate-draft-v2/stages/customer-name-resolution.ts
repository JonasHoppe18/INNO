export type ResolveCustomerNameInput = {
  latestCustomerMessage?: string | null;
  senderEmail?: string | null;
  senderDisplayName?: string | null;
  orderCustomerName?: string | null;
  orderCustomerEmail?: string | null;
  // Customer-entered "Name:" field from a detected Shopify contact-form relay.
  // The relay sender is mailer@shopify.com, so display-name/signature sources
  // usually have nothing — this field is the customer's own statement.
  contactFormName?: string | null;
  recentCustomerMessages?: Array<{
    text?: string | null;
    senderEmail?: string | null;
  }>;
};

export type ResolveCustomerNameResult = {
  first_name: string | null;
  source:
    | "signature"
    | "sender_display_name"
    | "verified_order_customer"
    | "contact_form"
    | "none";
  confidence: "high" | "medium" | "low";
  reason: string;
};

const CLOSING_RE =
  /^(?:thanks|thank you|best regards|kind regards|regards|cheers|venlig hilsen|med venlig hilsen|mvh|hilsen|tak|mange tak)$/i;

const NON_NAME_RE =
  /^(?:sent from my iphone|sent from my android|sent from outlook|best regards|kind regards|regards|thanks|thank you|tak|mange tak|support|customer service|kundeservice|service|team|the team|helpdesk|help desk|info|sales|hello|hi|dear|from|to|subject)$/i;

const ROLE_OR_TEAM_RE = /\b(?:support|customer\s*service|kundeservice|service|team|help\s*desk|sales|returns?)\b/i;

function normalizeText(value: string) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function cleanNameCandidate(value: string) {
  return normalizeText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstName(value: string) {
  return cleanNameCandidate(value).split(/\s+/)[0] || "";
}

function isCrediblePersonalName(value: string) {
  const name = cleanNameCandidate(value);
  if (!name || name.length < 2 || name.length > 60) return false;
  if (/@|https?:\/\/|\d|[_=()[\]{}]/i.test(name)) return false;
  if (NON_NAME_RE.test(name) || ROLE_OR_TEAM_RE.test(name)) return false;
  const tokens = name.split(/\s+/);
  if (tokens.length > 3) return false;
  return tokens.every((token) =>
    /^[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ'-]{1,29}$/.test(token)
  );
}

function canonicalEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function emailLocalParts(value?: string | null) {
  const local = canonicalEmail(value).split("@")[0] || "";
  return local
    .split(/[^a-z0-9]+/i)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 2);
}

function extractSignatureName(message?: string | null) {
  const text = normalizeText(String(message || ""));
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => cleanNameCandidate(line))
    .filter(Boolean)
    .slice(-8);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isCrediblePersonalName(line)) {
      const previous = lines[index - 1] || "";
      if (CLOSING_RE.test(previous)) return line;
    }

    const inline = line.match(
      /^(?:thanks|thank you|best regards|kind regards|regards|cheers|venlig hilsen|med venlig hilsen|mvh|hilsen|tak|mange tak)[,\s]+([A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ'-]{1,29}(?:\s+[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ'-]{1,29}){0,2})$/i,
    );
    if (inline?.[1] && isCrediblePersonalName(inline[1])) {
      return cleanNameCandidate(inline[1]);
    }
  }

  return "";
}

function credibleSenderDisplayName(value?: string | null) {
  const name = cleanNameCandidate(String(value || ""));
  if (!name || /@/.test(name)) return "";
  return isCrediblePersonalName(name) ? name : "";
}

function orderIdentityClearlyMatches(input: {
  senderEmail?: string | null;
  senderDisplayName?: string | null;
  orderCustomerName?: string | null;
  orderCustomerEmail?: string | null;
}) {
  const orderName = cleanNameCandidate(String(input.orderCustomerName || ""));
  if (!isCrediblePersonalName(orderName)) return false;

  const orderEmail = canonicalEmail(input.orderCustomerEmail);
  const senderEmail = canonicalEmail(input.senderEmail);
  if (orderEmail && senderEmail && orderEmail !== senderEmail) return false;

  // An exact order↔sender email match is sufficient on its own: the emailer IS
  // the order customer. Fixes concatenated locals ("simonboutrup") that don't
  // tokenize to the first name.
  if (orderEmail && senderEmail && orderEmail === senderEmail) return true;

  const orderFirst = firstName(orderName).toLowerCase();
  const orderTokens = orderName.toLowerCase().split(/\s+/).filter(Boolean);
  const displayName = credibleSenderDisplayName(input.senderDisplayName).toLowerCase();
  if (displayName) {
    const displayFirst = firstName(displayName).toLowerCase();
    if (displayFirst === orderFirst || displayName === orderName.toLowerCase()) return true;
    return false;
  }

  const localParts = emailLocalParts(senderEmail);
  return Boolean(orderFirst && localParts.includes(orderFirst)) ||
    orderTokens.length > 1 && orderTokens.every((token) => localParts.includes(token));
}

function currentSenderRecentMessages(input: ResolveCustomerNameInput) {
  const sender = canonicalEmail(input.senderEmail);
  const rows = input.recentCustomerMessages || [];
  return rows.filter((row) => {
    const rowSender = canonicalEmail(row.senderEmail);
    return !sender || !rowSender || rowSender === sender;
  });
}

export function resolveCustomerName(input: ResolveCustomerNameInput): ResolveCustomerNameResult {
  // Customer-entered contact-form name field wins: it is the customer's own
  // explicit statement, and relay messages rarely carry any other name signal.
  const contactFormName = credibleSenderDisplayName(input.contactFormName);
  if (contactFormName) {
    return {
      first_name: firstName(contactFormName),
      source: "contact_form",
      confidence: "high",
      reason: "customer-entered name field in shop contact form",
    };
  }

  const latestSignature = extractSignatureName(input.latestCustomerMessage);
  if (latestSignature) {
    return {
      first_name: firstName(latestSignature),
      source: "signature",
      confidence: "high",
      reason: "credible signature in latest visible customer message",
    };
  }

  const threadSignatureNames = currentSenderRecentMessages(input)
    .map((row) => extractSignatureName(row.text))
    .filter(Boolean);
  const uniqueThreadSignatures = [...new Set(threadSignatureNames.map((name) => firstName(name)))];
  if (uniqueThreadSignatures.length === 1) {
    return {
      first_name: uniqueThreadSignatures[0],
      source: "signature",
      confidence: "medium",
      reason: "single credible recent signature from the same sender",
    };
  }
  if (uniqueThreadSignatures.length > 1) {
    return {
      first_name: null,
      source: "none",
      confidence: "low",
      reason: "conflicting customer-authored signatures",
    };
  }

  const displayName = credibleSenderDisplayName(input.senderDisplayName);
  if (displayName) {
    return {
      first_name: firstName(displayName),
      source: "sender_display_name",
      confidence: "medium",
      reason: "credible sender display name",
    };
  }

  if (
    input.orderCustomerName &&
    orderIdentityClearlyMatches({
      senderEmail: input.senderEmail,
      senderDisplayName: input.senderDisplayName,
      orderCustomerName: input.orderCustomerName,
      orderCustomerEmail: input.orderCustomerEmail,
    })
  ) {
    return {
      first_name: firstName(input.orderCustomerName),
      source: "verified_order_customer",
      confidence: "medium",
      reason: "order customer identity matches current sender beyond email equality",
    };
  }

  return {
    first_name: null,
    source: "none",
    confidence: "low",
    reason: "no safe customer name candidate",
  };
}
