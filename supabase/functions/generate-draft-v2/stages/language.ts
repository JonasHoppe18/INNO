export const SUPPORTED_REPLY_LANGUAGES = [
  "da",
  "en",
  "sv",
  "de",
  "fr",
  "nl",
  "no",
  "fi",
  "es",
  "it",
] as const;

export type ReplyLanguage = typeof SUPPORTED_REPLY_LANGUAGES[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_REPLY_LANGUAGES);

function scoreMatches(text: string, regex: RegExp, weight = 1): number {
  return (text.match(regex) ?? []).length * weight;
}

export function normalizeReplyLanguage(
  language?: string | null,
): ReplyLanguage | "" {
  const value = String(language || "").trim().toLowerCase().slice(0, 2);
  return SUPPORTED_SET.has(value) ? value as ReplyLanguage : "";
}

export function extractLatestCustomerTextForLanguage(text: string): string {
  let value = String(text || "").replace(/<[^>]+>/g, " ");

  const bodyMatch = value.match(/\bBody:\s*([\s\S]+)/i);
  if (bodyMatch?.[1]) {
    value = bodyMatch[1];
  }

  value = value
    .split(
      /\n\s*(?:On .+ wrote:|Den .+ skrev .+:|man\.|tir\.|ons\.|tor\.|fre\.|lør\.|søn\.)/i,
    )[0]
    .split(
      /\b(?:AceZone Support|Support \(Support\)|From:|Fra:|Sent from Outlook|Med venlig hilsen \/ Best regards)\b/i,
    )[0]
    .replace(
      /\b(?:Country Code|Name|Email|Company \/ Team|Your Country|If Applicable|What Is Your Request Regarding\?|What Do You Need Help With\?):\s*/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return value || String(text || "").slice(0, 1200);
}

export function detectReplyLanguageFromText(text: string): ReplyLanguage | "" {
  const sample = extractLatestCustomerTextForLanguage(text)
    .toLowerCase()
    .slice(0, 1200);
  if (!sample) return "";

  const scores: Record<ReplyLanguage, number> = {
    da: 0,
    en: 0,
    sv: 0,
    de: 0,
    fr: 0,
    nl: 0,
    no: 0,
    fi: 0,
    es: 0,
    it: 0,
  };

  scores.da += scoreMatches(sample, /[æøå]/g, 2);
  scores.da += scoreMatches(
    sample,
    /\b(jeg|du|det|den|der|ikke|har|kan|skal|tak|hej|begge|ordren|pakke|pakker|transit|venlig|hilsen|mvh|adresse|refundering|ombytning|retur)\b/g,
  );

  scores.en += scoreMatches(
    sample,
    /\b(i|you|the|and|not|have|can|please|thank|thanks|hi|hello|order|refund|return|replacement|shipping|tracking|regards|help|issue)\b/g,
  );

  scores.sv += scoreMatches(sample, /[äö]/g, 1.5);
  scores.sv += scoreMatches(
    sample,
    /\b(jag|inte|tack|hej|beställning|hälsningar|sverige|köpt|vill|pengarna|retur)\b/g,
  );

  scores.de += scoreMatches(
    sample,
    /\b(ich|ihr|euch|eure|nicht|habe|bitte|danke|vielen|hilfe|schickt|richtig|bestellung|rückgabe|erstattung|paket|guten|hallo|liebe|grüße)\b/g,
  );

  scores.fr += scoreMatches(
    sample,
    /\b(je|vous|pas|merci|bonjour|commande|remboursement|retour|colis|cordialement)\b/g,
  );

  scores.nl += scoreMatches(
    sample,
    /\b(ik|jij|niet|heb|dank|hallo|bestelling|retour|terugbetaling|pakket|vriendelijke)\b/g,
  );

  scores.no += scoreMatches(
    sample,
    /\b(jeg|ikke|takk|hei|bestilling|retur|pakke|vennlig|hilsen)\b/g,
    0.8,
  );

  scores.fi += scoreMatches(
    sample,
    /\b(minä|olen|hei|kiitos|tilaus|palautus|hyvitys|paketti|terveisin)\b/g,
  );

  scores.es += scoreMatches(
    sample,
    /\b(hola|gracias|pedido|devolución|reembolso|paquete|por favor|saludos)\b/g,
  );

  scores.it += scoreMatches(
    sample,
    /\b(ciao|grazie|ordine|reso|rimborso|pacco|per favore|saluti)\b/g,
  );

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<
    [ReplyLanguage, number]
  >;
  const [best, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (bestScore < 2) return "";
  if (bestScore < 4 && bestScore - secondScore < 1.5) return "";
  return best;
}

export function resolveReplyLanguage(
  latestCustomerText: string,
  fallback?: string | null,
): ReplyLanguage {
  return detectReplyLanguageFromText(latestCustomerText) ||
    normalizeReplyLanguage(fallback) ||
    "en";
}

export interface MixedLanguageCheckResult {
  ok: boolean;
  foreignSegments: string[];
  detectedForeignLanguages: ReplyLanguage[];
}

const DANISH_IN_ENGLISH_PATTERNS = [
  /\bUndskyld for ulejligheden(?:,|\s+og)?\s+tak for din tålmodighed\b/i,
  /\bTak for din tålmodighed\b/i,
  /\bJeg ser frem til at høre fra dig\b/i,
  /\bVi ser frem til at høre fra dig\b/i,
  /\bTak fordi du kontakter os\b/i,
  /\bSvar venligst her i tråden\b/i,
  /\bGod dag\b/i,
  /\bHav en (?:god|fantastisk|dejlig) dag\b/i,
];

const ENGLISH_IN_DANISH_PATTERNS = [
  /\bI look forward to hearing from you\b/i,
  /\bWe look forward to hearing from you\b/i,
  /\bThank you for (?:contacting|reaching out to) us\b/i,
  /\bThanks for (?:contacting|reaching out)\b/i,
  /\bSorry for the inconvenience\b/i,
  /\bThank you for your patience\b/i,
  /\bPlease reply (?:here|in this thread)\b/i,
  /\bHave a (?:good|great|lovely) day\b/i,
];

function maskIgnorableLanguageText(text: string): string {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(
      /\b(?:AWB|GLS|UPS|DHL|FedEx|PostNord)\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi,
      " ",
    )
    .replace(/\b#?\d{3,12}\b/g, " ")
    .replace(/\b[A-Z][A-Za-z0-9]*(?:[-‑][A-Z]?[A-Za-z0-9]+)+\b/g, " ")
    .replace(
      /\b(?:Shopify|Webshipper|Zendesk|USB-C|Bluetooth|Windows|Device Manager|Firmware Updater)\b/gi,
      " ",
    );
}

function collectForeignSegments(
  text: string,
  patterns: RegExp[],
): string[] {
  const segments: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) segments.push(match[0].trim());
  }
  return [...new Set(segments)];
}

export function mixedLanguageCheck(
  draftText: string,
  expectedLanguage?: string | null,
): MixedLanguageCheckResult {
  const expected = normalizeReplyLanguage(expectedLanguage);
  if (!expected) {
    return {
      ok: true,
      foreignSegments: [],
      detectedForeignLanguages: [],
    };
  }

  const sample = maskIgnorableLanguageText(draftText);
  const foreignSegments: string[] = [];
  const detectedForeignLanguages: ReplyLanguage[] = [];

  if (expected === "en") {
    const daSegments = collectForeignSegments(
      sample,
      DANISH_IN_ENGLISH_PATTERNS,
    );
    if (daSegments.length) {
      foreignSegments.push(...daSegments);
      detectedForeignLanguages.push("da");
    }
  }

  if (expected === "da") {
    const enSegments = collectForeignSegments(
      sample,
      ENGLISH_IN_DANISH_PATTERNS,
    );
    if (enSegments.length) {
      foreignSegments.push(...enSegments);
      detectedForeignLanguages.push("en");
    }
  }

  return {
    ok: foreignSegments.length === 0,
    foreignSegments,
    detectedForeignLanguages: [...new Set(detectedForeignLanguages)],
  };
}

export function cleanupMixedLanguageDraft(
  draftText: string,
  expectedLanguage?: string | null,
): string {
  const expected = normalizeReplyLanguage(expectedLanguage);
  let value = String(draftText || "");

  if (expected === "en") {
    value = value
      .replace(
        /\bUndskyld for ulejligheden(?:,|\s+og)?\s+tak for din tålmodighed\.?/gi,
        "Sorry for the inconvenience, and thank you for your patience.",
      )
      .replace(/\bTak for din tålmodighed\.?/gi, "Thank you for your patience.")
      .replace(
        /\bJeg ser frem til at høre fra dig\.?/gi,
        "I look forward to hearing from you.",
      )
      .replace(
        /\bVi ser frem til at høre fra dig\.?/gi,
        "We look forward to hearing from you.",
      )
      .replace(
        /\bTak fordi du kontakter os\.?/gi,
        "Thank you for contacting us.",
      )
      .replace(
        /\bSvar venligst her i tråden\.?/gi,
        "Please reply here in the thread.",
      )
      .replace(/\bGod dag\.?/gi, "Have a good day.")
      .replace(
        /\bHav en (?:god|fantastisk|dejlig) dag\.?/gi,
        "Have a good day.",
      );
  }

  if (expected === "da") {
    value = value
      .replace(
        /\bI look forward to hearing from you\.?/gi,
        "Jeg ser frem til at høre fra dig.",
      )
      .replace(
        /\bWe look forward to hearing from you\.?/gi,
        "Vi ser frem til at høre fra dig.",
      )
      .replace(
        /\bThank you for (?:contacting|reaching out to) us\.?/gi,
        "Tak fordi du kontakter os.",
      )
      .replace(
        /\bThanks for (?:contacting|reaching out)\.?/gi,
        "Tak fordi du kontakter os.",
      )
      .replace(
        /\bSorry for the inconvenience\.?/gi,
        "Undskyld for ulejligheden.",
      )
      .replace(
        /\bThank you for your patience\.?/gi,
        "Tak for din tålmodighed.",
      )
      .replace(
        /\bPlease reply (?:here|in this thread)\.?/gi,
        "Svar her i tråden.",
      )
      .replace(/\bHave a (?:good|great|lovely) day\.?/gi, "Hav en god dag.");
  }

  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
