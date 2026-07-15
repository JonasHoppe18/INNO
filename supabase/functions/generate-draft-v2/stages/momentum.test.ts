import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildMomentumDirective,
  customerDeliveredRequestedDetails,
} from "./momentum.ts";

// Wright T-51051: our draft asked for name/address/phone/email + photos; the
// customer replied with exactly those labeled fields. Asking "would you like
// to move forward?" at that point stalls a case the customer already pushed
// forward — the reply must state the next step instead.

const WRIGHT_REPLY =
  "Hi there thank you for the quick response here is my details below.\n\n" +
  "Full name: Liam Wright\n\nFull address: 17 Martin's Road, Ulceby, DN39 6UB\n\n" +
  "Phone number: 07878 490023\n\nEmail address: liamwright5@hotmail.co.uk\n\n" +
  "As you can see from the images how it is able to be pulled away.";

Deno.test("detects a reply that delivers the requested labeled details", () => {
  assertEquals(customerDeliveredRequestedDetails(WRIGHT_REPLY), true);
});

Deno.test("a single labeled field or plain question does not trigger", () => {
  assertEquals(customerDeliveredRequestedDetails("Full name: Liam Wright"), false);
  assertEquals(customerDeliveredRequestedDetails("Hvor er min pakke?"), false);
  assertEquals(customerDeliveredRequestedDetails(""), false);
  assertEquals(customerDeliveredRequestedDetails(null), false);
});

Deno.test("directive fires with next-step mandate and permission-ask ban", () => {
  const d = buildMomentumDirective({ latestCustomerMessage: WRIGHT_REPLY });
  assert(d.length > 0);
  const lower = d.toLowerCase();
  // never ask permission to continue
  assertStringIncludes(lower, "would like to move forward");
  // commit to the concrete next step + what the customer can expect
  assertStringIncludes(lower, "næste skridt");
  assertStringIncludes(lower, "forvente");
});

Deno.test("directive stays silent when details were not delivered", () => {
  assertEquals(buildMomentumDirective({ latestCustomerMessage: "Hej, hvad koster A-Blaze?" }), "");
});
