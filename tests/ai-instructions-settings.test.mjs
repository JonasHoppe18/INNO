import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = readFileSync(
  new URL("../apps/web/components/settings/SettingsPanel.jsx", import.meta.url),
  "utf8",
);

test("AI instructions render the complete saved prompt on the settings page", () => {
  assert.match(settings, /whitespace-pre-wrap break-words/);
  assert.match(settings, /\{value\}/);
  assert.match(settings, /The shared instruction Sona reads before drafting every reply/);
  assert.doesNotMatch(settings, /value\.slice\(0, 55\)/);
});
