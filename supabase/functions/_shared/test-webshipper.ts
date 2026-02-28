import { updateWebshipperAddress } from "./webshipper.ts";

const originalFetch = globalThis.fetch;

let interceptedPatchPayload: unknown = null;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();

  // Step 1 mock: find order by visible_ref
  if (method === "GET" && url.includes("/orders")) {
    return new Response(
      JSON.stringify({
        data: [{ id: "9999", type: "orders" }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/vnd.api+json" },
      },
    );
  }

  // Step 2 mock: patch order
  if (method === "PATCH" && url.includes("/orders/9999")) {
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    interceptedPatchPayload = JSON.parse(rawBody);
    return new Response(
      JSON.stringify({
        data: { id: "9999", type: "orders" },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/vnd.api+json" },
      },
    );
  }

  return new Response(
    JSON.stringify({
      errors: [{ title: "Unexpected mock request", detail: `${method} ${url}` }],
    }),
    {
      status: 500,
      headers: { "Content-Type": "application/vnd.api+json" },
    },
  );
};

try {
  const result = await updateWebshipperAddress(
    "demo-shop",
    "fake-token",
    "#1001",
    {
      name: "Test Person",
      address1: "Test Vej 1",
      address2: "2. sal",
      zip: "2100",
      city: "Kobenhavn",
      country_code: "DK",
      email: "test@example.com",
      phone: "+4511223344",
    },
  );

  if (!result.success) {
    throw new Error(`Expected success, got failure: ${result.reason}`);
  }

  if (!interceptedPatchPayload) {
    throw new Error("PATCH payload was not intercepted.");
  }

  console.log("✅ Test Passed! Payload sent to Webshipper:");
  console.log(JSON.stringify(interceptedPatchPayload, null, 2));
} catch (error) {
  console.error("❌ Test Failed:", error);
  Deno.exit(1);
} finally {
  globalThis.fetch = originalFetch;
}
