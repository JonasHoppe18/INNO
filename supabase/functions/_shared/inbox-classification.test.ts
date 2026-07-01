import { assertEquals } from "jsr:@std/assert@1";
import { CARRIER_NOTIFICATION_DOMAINS, classifyInboxBucket } from "./inbox-classification.ts";

Deno.test("classifyInboxBucket hard-blocks known carrier domains", () => {
  const cases = [
    "noreply@gls-group.eu",
    "tracking@postnord.com",
    "notify@dhl.com",
    "auto@ups.com",
    "mail@fedex.com",
  ];
  for (const from of cases) {
    const result = classifyInboxBucket({ from, subject: "Package update", body: "Some update." });
    assertEquals(result.bucket, "notification", `expected ${from} to classify as notification`);
    assertEquals(result.reason, "carrier_notification_domain");
  }
});

Deno.test("classifyInboxBucket regression: real GLS delivery notification (draft 10243)", () => {
  const result = classifyInboxBucket({
    from: "noreply@gls-group.eu",
    subject: "Vi leverer snart din pakke fra ACEZONE ApS acezone",
    body:
      "Hej ACEZONE INTERNATIONAL ApS\n\nVi glæder os til at levere din pakke 055463247172 " +
      "(https://gls-group.eu/track/YO0IZ8BX) fra ACEZONE ApS acezone, som vil blive sendt så snart vi modtager den.\n\n" +
      "Din lokale GLS-chauffør leverer pakken til: ACEZONE INTERNATIONAL ApS Marie Grubbes Vej 39, Tjele",
  });
  assertEquals(result.bucket, "notification");
  assertEquals(result.reason, "carrier_notification_domain");
  assertEquals(result.noise_type, "carrier_notification");
});

Deno.test("classifyInboxBucket does not block a real customer mentioning a carrier by name in the body", () => {
  const result = classifyInboxBucket({
    from: "anna.jensen@gmail.com",
    subject: "Hvor er min pakke?",
    body: "Hej, GLS siger min pakke er leveret, men jeg har ikke modtaget noget. Kan I hjælpe?",
  });
  assertEquals(result.bucket, "ticket");
});

Deno.test("classifyInboxBucket does not block a customer asking about PostNord tracking", () => {
  const result = classifyInboxBucket({
    from: "customer@hotmail.com",
    subject: "Tracking spørgsmål",
    body: "Jeg har ikke modtaget min pakke fra PostNord endnu, kan I tjekke hvor den er?",
  });
  assertEquals(result.bucket, "ticket");
});

Deno.test("classifyInboxBucket generic no-reply/system sender without a known domain still scores as notification via heuristics", () => {
  const result = classifyInboxBucket({
    from: "noreply@some-random-shipping-service.example",
    subject: "Your order has shipped",
    body: "This is an automated shipping confirmation. Your package has shipped and is on the way.",
  });
  assertEquals(result.bucket, "notification");
});

Deno.test("classifyInboxBucket still classifies an ordinary support question as ticket", () => {
  const result = classifyInboxBucket({
    from: "customer@gmail.com",
    subject: "Spørgsmål om mit headset",
    body: "Hej, kan I hjælpe mig med at bytte mit headset til en anden farve?",
  });
  assertEquals(result.bucket, "ticket");
});

Deno.test("CARRIER_NOTIFICATION_DOMAINS contains the domain observed in the real GLS regression case", () => {
  assertEquals(CARRIER_NOTIFICATION_DOMAINS.has("gls-group.eu"), true);
});
