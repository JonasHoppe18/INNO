// supabase/functions/generate-draft-v2/stages/grounding-coverage.ts
//
// Pre-writer, PURE assessment: is the customer's core ask grounded by
// anything the pipeline actually resolved this turn? When it is not, the
// writer historically INVENTED polite refusals ("vi har ikke mulighed for
// at kontakte Maxgaming", "we don't have individual mic clips") instead of
// behaving like an employee who owns the case. This stage detects the
// ungrounded state so the pipeline can inject an owns-the-case directive.
//
// Fail-safe by design: missing/undefined inputs => grounded (existing
// behavior unchanged). Never throws, no I/O, shop-agnostic.

const NEVER_TRIGGER_INTENTS = new Set(["thanks", "update"]);

export type GroundingCoverage = {
  ungrounded: boolean;
  reason: string | null;
};

export function assessGroundingCoverage(input: {
  intent?: string | null;
  chunkCount?: number | null;
  matcherAbstained?: boolean | null;
  verifiedFactsCount?: number | null;
  structuredFactsCount?: number | null;
  strongTicketExampleCount?: number | null;
}): GroundingCoverage {
  const intent = String(input?.intent ?? "").trim().toLowerCase();
  if (!intent || NEVER_TRIGGER_INTENTS.has(intent)) {
    return { ungrounded: false, reason: null };
  }
  // Fail-safe: signals must be PRESENT numbers/booleans to count as evidence
  // of absence. Undefined counts mean "unknown" -> grounded.
  const chunkCount = typeof input?.chunkCount === "number" ? input.chunkCount : null;
  const verifiedFactsCount =
    typeof input?.verifiedFactsCount === "number" ? input.verifiedFactsCount : null;
  const structuredFactsCount =
    typeof input?.structuredFactsCount === "number" ? input.structuredFactsCount : null;
  const matcherAbstained = input?.matcherAbstained === true;

  if (chunkCount === null || verifiedFactsCount === null || structuredFactsCount === null) {
    return { ungrounded: false, reason: null };
  }

  const hasFacts = verifiedFactsCount > 0 || structuredFactsCount > 0;
  if (hasFacts) return { ungrounded: false, reason: null };

  const strongExamples =
    typeof input?.strongTicketExampleCount === "number" ? input.strongTicketExampleCount : 0;
  if (strongExamples > 0) return { ungrounded: false, reason: null };

  if (chunkCount === 0) {
    return { ungrounded: true, reason: "no_chunks_no_facts" };
  }
  if (matcherAbstained) {
    // The precision matcher looked at the candidates and concluded none of
    // them actually answers the ask — fallback chunks may still be present
    // but are topic-adjacent, not grounding.
    return { ungrounded: true, reason: "matcher_abstained_no_facts" };
  }
  return { ungrounded: false, reason: null };
}

export function buildOwnsTheCaseBlock(input: {
  customerAsk?: string | null;
  intent?: string | null;
}): string {
  const ask = String(input?.customerAsk ?? "").trim();
  const askLine = ask ? `Kundens konkrete spørgsmål: "${ask.slice(0, 200)}"` : "";
  return [
    "VIDENS-HUL — intet i shoppens viden eller live-data grounder svaret på kundens kerne-spørgsmål.",
    askLine,
    "Opfør dig som en medarbejder der EJER sagen:",
    "1. Hvis missing_required_fields angiver manglende kunde-oplysninger, så følg den mekanik uændret (stil KUN det spørgsmål).",
    "2. Ellers: anerkend kundens spørgsmål konkret, svar på den del der FAKTISK er groundet (delvist svar er fint), og skriv at du undersøger resten og vender tilbage hurtigst muligt.",
    "3. Opfind ALDRIG en afvisning, begrænsning, kapabilitet eller tredjepart. Sig IKKE 'det kan vi ikke', 'det tilbyder vi ikke' eller 'kontakt X i stedet', medmindre en kilde i konteksten eksplicit siger det.",
    "4. Deler kunden blot feedback uden at bede om noget, har feedback-anerkendelses-instruktionen forrang over denne.",
    "FORBUDTE formuleringer (medmindre en kilde eksplicit siger det): 'det kan vi ikke', 'vi har ikke mulighed for', 'det tilbyder vi ikke', 'we don't have', 'we don't offer', 'we can't', 'not available for purchase'.",
    "Svaret SKAL indeholde en sætning hvor du skriver at du undersøger spørgsmålet og vender tilbage til kunden.",
  ].filter(Boolean).join("\n");
}
