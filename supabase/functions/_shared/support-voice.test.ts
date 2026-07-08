import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildSupportVoiceRewriteInstruction,
  detectSupportVoiceViolations,
  sanitizeSupportVoiceDraft,
} from "./support-voice.ts";

Deno.test("detectSupportVoiceViolations flags internal process and handoff wording", () => {
  const draft =
    "Tak for at sende trackingnummeret for din returnering. Returneringen skal gennemgå en manuel gennemgang, før vi kan bekræfte behandling. Teamet kan bruge trackingnummeret til at undersøge returneringsstatus yderligere.";

  assertEquals(detectSupportVoiceViolations(draft).sort(), [
    "formal_opening",
    "investigate_further",
    "manual_process_wording",
    "team_handoff",
  ].sort());
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

Deno.test("sanitizeSupportVoiceDraft removes safe filler and system qualifiers only", () => {
  const out = sanitizeSupportVoiceDraft(
    "Jeg kan ikke se refunderingen i vores system endnu.\n\nHvis du har yderligere spørgsmål, er du velkommen til at skrive.",
  );

  assertEquals(out, "Jeg kan ikke se refunderingen endnu.");
});

Deno.test("buildSupportVoiceRewriteInstruction preserves factual safety contract", () => {
  const instruction = buildSupportVoiceRewriteInstruction({
    language: "da",
    violations: ["team_handoff", "manual_process_wording"],
  });

  assertStringIncludes(instruction, "Preserve the same facts");
  assertStringIncludes(instruction, "Do not add promises");
  assertStringIncludes(instruction, "team_handoff");
  assert(!/change facts/i.test(instruction));
});
