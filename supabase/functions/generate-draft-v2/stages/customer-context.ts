// supabase/functions/generate-draft-v2/stages/customer-context.ts

export interface SalutationNameResult {
  name: string;
  source:
    | "customer_form_name"
    | "customer_signature"
    | "verified_order_name"
    | "none";
  conflictingOrderName?: string;
}

export type VariantFamily = "wired" | "wireless";

export interface VariantSignals {
  families: VariantFamily[];
  terms: string[];
}

export interface VariantSourceInput {
  source_label: string;
  content: string;
  kind?: string;
  usable_as?: string;
}

function stripHtml(text: string): string {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .trim();
}

function cleanNameCandidate(value: string): string {
  return stripHtml(value)
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleName(value: string): boolean {
  const name = cleanNameCandidate(value);
  if (!name || name.length < 2 || name.length > 60) return false;
  if (/@|https?:\/\/|\d{3,}/i.test(name)) return false;
  if (
    /^(email|company|your country|country|country code|body|what is|if applicable|order|ordre|n\/a|none)$/i
      .test(name)
  ) return false;
  return /[A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ]/.test(name);
}

function extractFormName(messageText: string): string {
  const text = stripHtml(messageText);
  const match = text.match(
    /(?:^|\n|\b)Name:\s*([\s\S]{1,100}?)(?=\n\s*(?:Email|Company\s*\/\s*Team|Your Country|Country|If Applicable|What Is|Body):|\s+(?:Email|Company\s*\/\s*Team|Your Country|If Applicable|What Is|Body):|$)/i,
  );
  const name = cleanNameCandidate(match?.[1] ?? "");
  return isPlausibleName(name) ? name : "";
}

function extractSignatureName(messageText: string): string {
  const text = stripHtml(messageText);
  const bodyMatch = text.match(/(?:^|\n|\b)Body:\s*([\s\S]+)$/i);
  const body = bodyMatch?.[1] ?? text;
  const lines = body
    .split("\n")
    .map((line) => cleanNameCandidate(line))
    .filter(Boolean)
    .slice(-8);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const inline = line.match(
      /(?:kind regards|best regards|regards|venlig hilsen|med venlig hilsen|mvh|hilsen|hälsningar|vänliga hälsningar)[,\s]+(.+)$/i,
    );
    if (inline && isPlausibleName(inline[1])) {
      return cleanNameCandidate(inline[1]);
    }

    if (
      /^(?:kind regards|best regards|regards|venlig hilsen|med venlig hilsen|mvh|hilsen|hälsningar|vänliga hälsningar)$/i
        .test(line)
    ) {
      const next = lines[i + 1];
      if (next && isPlausibleName(next)) return next;
    }
  }

  return "";
}

function firstName(name: string): string {
  return cleanNameCandidate(name).split(/\s+/)[0] ?? "";
}

export function resolveSalutationName(
  latestCustomerMessage: string,
  verifiedOrderName?: string,
): SalutationNameResult {
  const formName = extractFormName(latestCustomerMessage);
  const orderName = cleanNameCandidate(verifiedOrderName ?? "");
  if (formName) {
    return {
      name: firstName(formName),
      source: "customer_form_name",
      conflictingOrderName: orderName &&
          firstName(orderName).toLowerCase() !==
            firstName(formName).toLowerCase()
        ? orderName
        : undefined,
    };
  }

  const signatureName = extractSignatureName(latestCustomerMessage);
  if (signatureName) {
    return {
      name: firstName(signatureName),
      source: "customer_signature",
      conflictingOrderName: orderName &&
          firstName(orderName).toLowerCase() !==
            firstName(signatureName).toLowerCase()
        ? orderName
        : undefined,
    };
  }

  if (orderName && isPlausibleName(orderName)) {
    return { name: firstName(orderName), source: "verified_order_name" };
  }

  return { name: "", source: "none" };
}

export function detectVariantSignals(text: string): VariantSignals {
  const clean = stripHtml(text);
  const terms: string[] = [];
  const families = new Set<VariantFamily>();

  const add = (family: VariantFamily, pattern: RegExp) => {
    for (const match of clean.matchAll(pattern)) {
      families.add(family);
      terms.push(match[0]);
    }
  };

  add(
    "wired",
    /\b(wired|corded|cabled?|cable version|kablet|kabelversion|kabel-version)\b/gi,
  );
  add(
    "wireless",
    /\b(wireless|dongle|bluetooth|pairing mode|pair the dongle|trådløs|traadloes|tradlos)\b/gi,
  );

  return {
    families: [...families],
    terms: [...new Set(terms.map((term) => term.toLowerCase()))],
  };
}

function hasConflict(
  customerSignals: VariantSignals,
  sourceSignals: VariantSignals,
): boolean {
  if (customerSignals.families.length !== 1) return false;
  const expected = customerSignals.families[0];
  const conflicting: VariantFamily = expected === "wired"
    ? "wireless"
    : "wired";
  return sourceSignals.families.includes(conflicting) &&
    !sourceSignals.families.includes(expected);
}

export function isVariantConflictingSource(
  latestCustomerMessage: string,
  source: VariantSourceInput,
): boolean {
  const customerSignals = detectVariantSignals(latestCustomerMessage);
  const labelSignals = detectVariantSignals(source.source_label);
  if (hasConflict(customerSignals, labelSignals)) return true;
  return hasConflict(
    customerSignals,
    detectVariantSignals(`${source.source_label}\n${source.content}`),
  );
}

export function buildVariantGuidanceBlock(
  latestCustomerMessage: string,
  sources: VariantSourceInput[],
): string {
  const customerSignals = detectVariantSignals(latestCustomerMessage);
  if (customerSignals.families.length !== 1) return "";

  const expected = customerSignals.families[0];
  const conflictingFamily = expected === "wired" ? "wireless" : "wired";
  const conflictingSources = sources
    .map((source) => ({
      source,
      signals: detectVariantSignals(
        `${source.source_label}\n${source.content}`,
      ),
    }))
    .filter(({ source }) =>
      isVariantConflictingSource(
        latestCustomerMessage,
        source,
      )
    )
    .slice(0, 5);

  const conflictText = conflictingSources.length
    ? `- ${conflictingSources.length} conflicting variant-specific source(s) were excluded from procedure guidance. Do not mention those excluded source names or their variant in the customer reply.`
    : "- No obvious conflicting variant-specific sources detected.";

  return `# Produkt-/variant-grounding (generisk)
Kundens seneste besked indeholder variant-signaler: ${
    customerSignals.terms.join(", ")
  }.
Forventet variant-familie: ${expected}.

Regler:
- Produkt- og variantniveau fra knowledge er autoritativt, når det matcher kundens besked.
- Brug kun proceduretrin fra knowledge/saved replies, hvis de passer til kundens variant eller er tydeligt variant-neutrale.
- Saved replies har ikke sikkert produktniveau. Hvis en saved reply indeholder variant-specifikke trin, der konflikter med kundens variant, må den kun bruges som tone/struktur, ikke som procedure.
- Hvis der findes både matchende og konfliktende kilder, skal du bruge den matchende eller variant-neutrale knowledge. Du må ikke blande trin fra en anden variant ind i svaret.
- Nævn ikke ${conflictingFamily}-specifikke trin, komponenter eller labels i kundesvaret, medmindre en ikke-frasorteret knowledge-kilde eksplicit siger at de gælder for kundens ${expected}-variant.

Mulige konfliktende kilder:
${conflictText}`;
}
