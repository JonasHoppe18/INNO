// Cross-file consistency: every HTTP method a client uses against
// /api/persona must actually be exported by the route module. Next.js
// answers 405 for unexported methods, which broke persona saves when the
// settings panel PUT'ed to a GET/POST-only route.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const routeSrc = readFileSync(
  path.join(root, "apps/web/app/api/persona/route.js"),
  "utf8",
);
const exportedMethods = new Set(
  [...routeSrc.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)]
    .map((m) => m[1]),
);

const CLIENT_FILES = [
  "apps/web/components/settings/SettingsPanel.jsx",
  "apps/web/hooks/useAgentPersonaConfig.js",
];

function usedMethods(src) {
  const used = [];
  const re = /fetch\(\s*["'`]\/api\/persona["'`]\s*(,\s*\{)?/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    if (!match[1]) {
      used.push("GET"); // fetch without init defaults to GET
      continue;
    }
    const window = src.slice(match.index, match.index + 400);
    const methodMatch = window.match(/method:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/);
    used.push(methodMatch ? methodMatch[1] : "GET");
  }
  return used;
}

for (const file of CLIENT_FILES) {
  test(`${file} only calls /api/persona with methods the route exports`, () => {
    const src = readFileSync(path.join(root, file), "utf8");
    for (const method of usedMethods(src)) {
      assert.ok(
        exportedMethods.has(method),
        `${file} uses ${method} /api/persona but route.js only exports: ${[...exportedMethods].join(", ")}`,
      );
    }
  });
}

test("route exports at least GET and POST", () => {
  assert.ok(exportedMethods.has("GET"));
  assert.ok(exportedMethods.has("POST"));
});

test("SettingsPanel reads instructions through the route's { persona: ... } wrapper", () => {
  // GET /api/persona returns { persona: { instructions } }. Reading
  // personaPayload?.instructions (unwrapped) silently renders an empty
  // AI-instructions field even when the DB holds a saved prompt.
  const routeReturnsWrapped = /NextResponse\.json\(\s*\{\s*persona:/.test(routeSrc);
  assert.ok(routeReturnsWrapped, "route no longer wraps payload in { persona } — update this test");

  const panelSrc = readFileSync(
    path.join(root, "apps/web/components/settings/SettingsPanel.jsx"),
    "utf8",
  );
  assert.ok(
    /personaPayload\?\.persona\?\.instructions/.test(panelSrc),
    "SettingsPanel must read personaPayload?.persona?.instructions (route wraps the payload)",
  );
  assert.ok(
    !/personaPayload\?\.instructions/.test(panelSrc),
    "SettingsPanel still reads the unwrapped personaPayload?.instructions somewhere",
  );
});
