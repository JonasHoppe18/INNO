require("sucrase/register/ts-legacy-module-interop");
require("./helpers/register-web-alias.cjs");

const assert = require("node:assert/strict");
const test = require("node:test");

const { POST } = require("../apps/web/app/api/integrations/import-history/jobs/route.ts");

function makeRequest(body = {}) {
  return new Request("http://localhost/api/integrations/import-history/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("HIST-0: jobs route returns a disabled response instead of queueing an import", async () => {
  const response = await POST(makeRequest({ provider: "zendesk" }));
  assert.equal(response.status, 501);
  const payload = await response.json();
  assert.match(
    payload.error,
    /temporarily disabled pending redaction\/review onboarding flow/,
  );
});

test("HIST-0: jobs route never touches the network (no auth call, no knowledge_import_jobs insert) for any provider", async () => {
  for (const provider of ["zendesk", "gorgias", "freshdesk", "bogus"]) {
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
      fetchCalls.push(args);
      throw new Error("fetch should never be called while HIST-0 gate is active");
    };
    try {
      const response = await POST(makeRequest({ provider }));
      assert.equal(response.status, 501);
      assert.equal(fetchCalls.length, 0, `expected no network calls for provider=${provider}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
