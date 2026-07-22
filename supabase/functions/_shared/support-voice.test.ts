import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildSupportVoiceRewriteInstruction,
  detectSupportVoiceViolations,
  sanitizeSupportVoiceDraft,
} from "./support-voice.ts";

Deno.test("detectSupportVoiceViolations flags internal process and handoff wording", () => {
  const draft =
    "Tak for at sende trackingnummeret for din returnering. Returneringen skal gennemgå en manuel gennemgang, før vi kan bekræfte behandling. Teamet kan bruge trackingnummeret til at undersøge returneringsstatus yderligere.";

  assertEquals(
    detectSupportVoiceViolations(draft).sort(),
    [
      "formal_opening",
      "investigate_further",
      "manual_process_wording",
      "team_handoff",
    ].sort(),
  );
});

Deno.test("detectSupportVoiceViolations flags English team promises", () => {
  assertEquals(
    detectSupportVoiceViolations(
      "Our team will review this and get back to you.",
    ),
    ["team_handoff"],
  );
});

Deno.test("detectSupportVoiceViolations flags case-management wording from return drafts", () => {
  const draft =
    "Hej Jonas\n\nVi har noteret dit returneringsnummer 370438109757988982. Refusionen er endnu ikke udstedt, og returneringen skal stadig registreres hos os, før vi kan bekræfte næste skridt. Du behøver ikke gøre mere lige nu.";

  assertEquals(detectSupportVoiceViolations(draft), [
    "case_management_wording",
  ]);
});

Deno.test("detectSupportVoiceViolations passes a concise employee-style reply", () => {
  const draft =
    "Hej Jonas\n\nTak, jeg har trackingnummeret nu.\n\nJeg kan ikke se, at refunderingen er lavet endnu. Returen er ikke bekræftet modtaget endnu, så jeg kan ikke sige mere om refunderingen lige nu.\n\nDu skal ikke sende mere lige nu.";

  assertEquals(detectSupportVoiceViolations(draft), []);
});

Deno.test("detectSupportVoiceViolations flags customer-facing evidence language", () => {
  assertEquals(
    detectSupportVoiceViolations(
      "Vi har ikke nogen dokumenteret version af stofpuder til A-Spire Wireless.",
    ),
    ["evidence_language"],
  );
  assertEquals(
    detectSupportVoiceViolations(
      "That option is not documented in our knowledge base.",
    ),
    ["evidence_language"],
  );
});

Deno.test("ordinary requests for customer documentation are not evidence-language violations", () => {
  assertEquals(
    detectSupportVoiceViolations(
      "Send gerne et billede som dokumentation for skaden.",
    ),
    [],
  );
});

Deno.test("sanitizeSupportVoiceDraft removes safe filler and system qualifiers only", () => {
  const out = sanitizeSupportVoiceDraft(
    "Jeg kan ikke se refunderingen i vores system endnu.\n\nHvis du har yderligere spørgsmål, er du velkommen til at skrive.",
  );

  assertEquals(out, "Jeg kan ikke se refunderingen endnu.");
});

Deno.test("support voice removes compound Danish invitation filler", () => {
  const filler =
    "Hvis du har brug for yderligere hjælp eller har andre spørgsmål, er du velkommen til at skrive igen.";
  assertEquals(detectSupportVoiceViolations(filler), ["generic_filler"]);
  assertEquals(
    sanitizeSupportVoiceDraft(`Svaret er nej. ${filler}`),
    "Svaret er nej.",
  );
});

Deno.test("buildSupportVoiceRewriteInstruction preserves factual safety contract", () => {
  const instruction = buildSupportVoiceRewriteInstruction({
    language: "da",
    violations: ["team_handoff", "manual_process_wording"],
  });

  assertStringIncludes(instruction, "Preserve the same facts");
  assertStringIncludes(instruction, "Do not add promises");
  assertStringIncludes(instruction, "team_handoff");
  assertStringIncludes(
    instruction,
    "Never turn missing evidence into an absolute no",
  );
  assertStringIncludes(instruction, "one direct answer sentence");
  assert(!/change facts/i.test(instruction));
});

Deno.test("detectSupportVoiceViolations flags template empathy followed by 'men'/'but'", () => {
  assertEquals(
    detectSupportVoiceViolations(
      "Jeg forstår, at det kan være frustrerende, men vi arbejder på at få den sendt hurtigst muligt.",
    ),
    ["empathy_deflection"],
  );
  assertEquals(
    detectSupportVoiceViolations(
      "I understand this can be frustrating, but we are working on it.",
    ),
    ["empathy_deflection"],
  );
});

Deno.test("empathy without deflection is not flagged", () => {
  assertEquals(
    detectSupportVoiceViolations(
      "Jeg forstår godt din frustration, og jeg beklager ventetiden. Din ordre er ikke afsendt endnu.",
    ),
    [],
  );
});
