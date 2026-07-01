require("sucrase/register/ts-legacy-module-interop");
require("./helpers/register-web-alias.cjs");

const assert = require("node:assert/strict");
const test = require("node:test");

const { POST } = require("../apps/web/app/api/integrations/import-history/route.ts");

function makeRequest(body = {}) {
  return new Request("http://localhost/api/integrations/import-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("HIST-0: synchronous import-history route returns a disabled response instead of importing", async () => {
  const response = await POST(makeRequest({ provider: "zendesk", credentials: { domain: "x", token: "y" } }));
  assert.equal(response.status, 501);
  const payload = await response.json();
  assert.match(
    payload.error,
    /temporarily disabled pending redaction\/review onboarding flow/,
  );
});

test("HIST-0: synchronous import-history route never fetches a provider API or writes to agent_knowledge", async () => {
  for (const provider of ["zendesk", "gorgias", "bogus"]) {
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
      fetchCalls.push(args);
      throw new Error("fetch should never be called while HIST-0 gate is active");
    };
    try {
      const response = await POST(
        makeRequest({
          provider,
          credentials: { domain: "x", token: "y", email: "a@b.com" },
          shop_id: "00000000-0000-0000-0000-000000000000",
          limit: 5,
        }),
      );
      assert.equal(response.status, 501);
      assert.equal(fetchCalls.length, 0, `expected no network calls for provider=${provider}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
