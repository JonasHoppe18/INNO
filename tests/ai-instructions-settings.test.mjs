import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = readFileSync(
  new URL("../apps/web/components/settings/SettingsPanel.jsx", import.meta.url),
  "utf8",
);
const personaRoute = readFileSync(
  new URL("../apps/web/app/api/persona/route.js", import.meta.url),
  "utf8",
);
const draftPipeline = readFileSync(
  new URL("../supabase/functions/generate-draft-v2/pipeline.ts", import.meta.url),
  "utf8",
);
const draftWriter = readFileSync(
  new URL(
    "../supabase/functions/generate-draft-v2/stages/writer.ts",
    import.meta.url,
  ),
  "utf8",
);

test("AI instructions render the complete saved prompt on the settings page", () => {
  assert.match(settings, /whitespace-pre-wrap break-words/);
  assert.match(settings, /\{value\}/);
  assert.match(
    settings,
    /The exact workspace instruction inserted into every draft prompt/,
  );
  assert.doesNotMatch(settings, /value\.slice\(0, 55\)/);
});

test("AI instructions load and save through the persona response contract", () => {
  assert.match(settings, /personaPayload\?\.persona\?\.instructions/);
  assert.doesNotMatch(settings, /personaPayload\?\.instructions/);
  assert.match(settings, /payload\?\.persona\?\.instructions/);
  assert.match(personaRoute, /export async function PUT/);
  assert.match(personaRoute, /return savePersona\(req\)/);
});

test("settings use the same persona instruction field as the draft writer", () => {
  assert.match(
    personaRoute,
    /\.select\("persona_instructions, persona_scenario"\)/,
  );
  assert.match(
    personaRoute,
    /instructions: workspaceSettings\?\.persona_instructions \?\? ""/,
  );
  assert.match(
    draftPipeline,
    /\.select\("persona_instructions,persona_scenario"\)/,
  );
  assert.match(
    draftPipeline,
    /persona_instructions: personaResult\.data\?\.persona_instructions \?\? null/,
  );
  assert.match(draftWriter, /\.persona_instructions \?\?/);
  assert.match(draftWriter, /\$\{persona \? `\\n\$\{persona\}\\n` : ""\}/);
});
