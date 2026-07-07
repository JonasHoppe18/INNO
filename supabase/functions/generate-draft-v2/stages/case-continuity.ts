// Multi-turn case continuity → writer directives.
//
// The case-state updater already captures cross-turn facts ("purchased_from_
// third_party: Maxgaming.se", "shipping_arranged_asap"), but the writer only
// received them as passive info blocks and answered the literal latest
// question. A human colleague (1) routes warranty/exchange to the reseller
// when the product was bought third-party, and (2) continues an active
// arrangement before anything else. This module turns those case-state
// signals into explicit directives. Pure: no I/O, no LLM, no shop-specific
// logic — grounded routing is delegated to retrieved knowledge.
import type { CaseState } from "./case-state-updater.ts";

const THIRD_PARTY_DECISION_RE =
  /purchased?_from_third_party\s*:?\s*(.*)$|third[_\s-]?party[_\s-]?purchase\s*:?\s*(.*)$/i;

// Active, in-progress arrangements the reply must continue — matches the
// decision vocabulary the case-state prompt instructs (AGENT-FORPLIGTELSER).
const ACTIVE_FLOW_RE =
  /shipping_arranged|awaiting_tracking|manual_order|back_order|replacement_sent|label_(?:requested|created)|shipment_(?:arranged|pending)/i;

function thirdPartyName(caseState: CaseState): string | null {
  const entityPlace = String(
    (caseState.entities as { purchase_place?: string | null })
      .purchase_place || "",
  ).trim();
  if (entityPlace.toLowerCase().startsWith("third_party")) {
    const name = entityPlace.split(":").slice(1).join(":").trim();
    return name || "en tredjepartsforhandler";
  }
  if (entityPlace) return null; // own_store / anything explicit non-third-party

  for (const { decision } of caseState.decisions_made || []) {
    const match = THIRD_PARTY_DECISION_RE.exec(String(decision || ""));
    if (match) {
      const name = (match[1] || match[2] || "").trim();
      return name || "en tredjepartsforhandler";
    }
  }
  return null;
}

export function buildCaseContinuityDirective(caseState: CaseState): string {
  const blocks: string[] = [];

  const reseller = thirdPartyName(caseState);
  if (reseller) {
    blocks.push(
      `# KØBT HOS TREDJEPART (${reseller}) — struktureret sagsfaktum
- Kunden har tidligere i samtalen oplyst at produktet er købt hos ${reseller} — spørg IKKE igen hvor produktet er købt.
- Hvis den hentede viden dokumenterer at garanti/ombytning for tredjeparts-køb håndteres af forhandleren: henvis venligt men beslutsomt til ${reseller}, og bed IKKE om fejlfinding, video eller fotos til garanti-afgørelsen.
- Hvis ingen tredjeparts-politik findes i den hentede viden: håndtér efter shoppens generelle politik uden at love garanti-dækning.`,
    );
  }

  const activeFlows = (caseState.decisions_made || [])
    .map((d) => String(d.decision || ""))
    .filter((decision) => ACTIVE_FLOW_RE.test(decision));
  if (activeFlows.length > 0) {
    blocks.push(
      `# AKTIVT FLOW — fortsæt det, start ikke forfra
- Der er allerede arrangeret/lovet: ${activeFlows.join("; ")}.
- Dit svar SKAL først bekræfte/statusse det igangværende arrangement (eller det vi afventer), FØR du besvarer nye spørgsmål.
- Foreslå IKKE en ny/alternativ proces for noget der allerede er i gang, og bed ikke om oplysninger der allerede er bekræftet.`,
    );
  }

  return blocks.join("\n\n");
}
