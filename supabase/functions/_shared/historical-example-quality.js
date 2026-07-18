// Pure, runtime-neutral quality gate for historical customer-service replies.
// Imported replies are useful tone anchors only when they contain a substantive
// support response. Acknowledgements and signature-only replies otherwise
// displace useful examples in the three-slot few-shot budget.

const GREETING_RE = /^(?:(?:hi|hello|hey|hej|hejsa|hallo|hola|bonjour|ciao)(?:\s+(?:there|again|igen|[\p{L}\p{M}'’-]{2,30}))?)[,!.]?\s*/iu;
const SIGNOFF_RE = /(?:^|\n)\s*(?:med\s+venlig\s+hilsen|venlig\s+hilsen|kind\s+regards|best\s+regards|best\s+wishes|warm\s+regards|de\s+bedste\s+hilsner|mange\s+hilsner|sincerely|cheers)\b[\s\S]*$/iu;
const ACK_ONLY_RE = /^(?:many\s+thanks|thank\s+you(?:\s+very\s+much)?|thanks(?:\s+a\s+lot)?|tak(?:\s+skal\s+du\s+have|\s+for\s+det|\s+mange\s+gange)?|mange\s+tak|perfekt|perfect|great|super|okay|ok|noted|received|you(?:'|’)re\s+welcome|no\s+problem|det\s+var\s+så\s+lidt|velbekomme)(?:\s+(?:again|igen))?[.!\s🙂😊👍]*$/iu;

export function historicalExampleSubstance(agentReply = "") {
  return String(agentReply || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(GREETING_RE, "")
    .replace(SIGNOFF_RE, "")
    .replace(/\s*\[(?:agent|support|name)\]\s*$/iu, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function assessHistoricalExampleQuality({ agentReply = "" } = {}) {
  const raw = String(agentReply || "").trim();
  if (!raw) {
    return { usable: false, reason: "blank_reply", substantiveText: "" };
  }

  const substantiveText = historicalExampleSubstance(raw);
  if (!substantiveText) {
    return { usable: false, reason: "signature_only", substantiveText };
  }
  if (ACK_ONLY_RE.test(substantiveText)) {
    return { usable: false, reason: "acknowledgement_only", substantiveText };
  }

  // Preserve concise but meaningful replies (for example "No, that model is
  // not compatible."). Only reject very short remnants that contain no useful
  // support act such as an answer, question, instruction, or concrete fact.
  const lettersAndNumbers = substantiveText.replace(/[^\p{L}\p{N}]/gu, "");
  const hasSupportAct = /[?]|\b(?:yes|no|can|cannot|please|try|send|provide|confirm|because|available|compatible|refund|return|order|tracking|ja|nej|kan|ikke|prøv|send|oplys|bekræft|fordi|tilgængelig|kompatibel|refusion|returnering|ordre)\b/iu
    .test(substantiveText);
  if (lettersAndNumbers.length < 12 && !hasSupportAct) {
    return { usable: false, reason: "too_short", substantiveText };
  }

  return { usable: true, reason: null, substantiveText };
}
