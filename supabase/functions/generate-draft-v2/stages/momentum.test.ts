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

// ── Deterministic cleanup: the writer kept the permission-stall sentence even
// with the directive in the prompt (history anchoring). Removal/replace-only
// post-processor, same pattern as cleanupDeliveredNotReceivedDraft. ──
import { cleanupMomentumStall } from "./momentum.ts";

const STALL_DRAFT =
  "Hi Liam,\n\nThank you for providing the details and images. Since the headset was purchased second-hand, any repair would be at your expense.\n\n" +
  "We can proceed with assessing the repair options. Please let us know if you would like to move forward with this, and we can provide an estimate for the repair costs and shipping.\n\n" +
  "I look forward to your response.";

Deno.test("stall sentence is replaced with a committed next step", () => {
  const out = cleanupMomentumStall(STALL_DRAFT, {
    latestCustomerMessage: WRIGHT_REPLY,
    language: "en",
  });
  assert(!/would like to move forward/i.test(out));
  assert(!/let us know if you/i.test(out));
  assert(/review/i.test(out));
  assert(/estimate/i.test(out));
});

Deno.test("draft without a stall sentence is untouched", () => {
  const clean = "Hi Liam,\n\nWe'll review the photos and get back to you with an estimate.";
  assertEquals(
    cleanupMomentumStall(clean, { latestCustomerMessage: WRIGHT_REPLY, language: "en" }),
    clean,
  );
});

Deno.test("cleanup does not fire when details were not delivered", () => {
  assertEquals(
    cleanupMomentumStall(STALL_DRAFT, { latestCustomerMessage: "Hvad koster A-Blaze?", language: "en" }),
    STALL_DRAFT,
  );
});

Deno.test("Danish stall variant gets a Danish committed next step", () => {
  const daDraft =
    "Hej Karen,\n\nTak for oplysningerne.\n\nSig gerne til, hvis du ønsker at gå videre, så sender vi et prisoverslag.";
  const out = cleanupMomentumStall(daDraft, {
    latestCustomerMessage: "Fulde navn: Karen Jensen\nAdresse: Testvej 1\nTelefon: 12345678",
    language: "da",
  });
  assert(!/ønsker at gå videre/i.test(out));
  assert(/prisoverslag/i.test(out));
});
