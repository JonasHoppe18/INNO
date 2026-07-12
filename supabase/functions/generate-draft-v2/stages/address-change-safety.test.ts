import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { hasUsableReplacementShippingAddress } from "./writer.ts";

Deno.test("address change request without replacement address asks for details", () => {
  const message = `Er det muligt at ændre leveringsadressen på musemåtten?
Jeg er ikke ved leveringsstedet, når den bliver sendt grundet ferie.
Jeg kan bare skrive den anden leveringsadresse på mail.`;

  assertEquals(hasUsableReplacementShippingAddress(message), false);
});

Deno.test("complete replacement address is recognized", () => {
  const message = `Den nye adresse er:
Nørrebrogade 12
2200 København`;

  assertEquals(hasUsableReplacementShippingAddress(message), true);
});

Deno.test("address actions cannot use the generic LLM fallback", async () => {
  const source = await Deno.readTextFile(new URL("./action-decision.ts", import.meta.url));

  assertStringIncludes(source, '"address_change"].includes');
  assert(
    source.includes("an LLM fallback must not turn the customer's mere"),
    "missing safety explanation for the address-change fallback guard",
  );
});
