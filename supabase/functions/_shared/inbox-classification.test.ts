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

// ── 2026-07-15: infra/OTP notifications that slipped through and got drafts ──
// Real cases: hello@notify.railway.app (deployment crash + volume deletion),
// noreply@github.com (launch code), support@hetzner.com (verification code).
Deno.test("railway infra notification (signal in DOMAIN) is a notification", () => {
  const out = classifyInboxBucket({
    from: "Railway <hello@notify.railway.app>",
    subject: "Deployment crashed for discord-bot in zesty-radiance!",
    body: "Your deployment for discord-bot crashed. View the deploy logs to learn more. Need help? Visit our docs.",
  });
  assertEquals(out.bucket, "notification");
});

Deno.test("scheduled volume deletion notice is a notification", () => {
  const out = classifyInboxBucket({
    from: "Railway <hello@notify.railway.app>",
    subject: "Scheduled Volume Deletion",
    body: "The volume postgres-volume in your project zesty-radiance is queued for deletion. Restore it using the link below.",
  });
  assertEquals(out.bucket, "notification");
});

Deno.test("verification/launch code emails are notifications", () => {
  const github = classifyInboxBucket({
    from: "GitHub <noreply@github.com>",
    subject: "🚀 Your GitHub launch code",
    body: "Here's your GitHub launch code! Continue signing up for GitHub by entering the code below: 12345678",
  });
  assertEquals(github.bucket, "notification");

  const hetzner = classifyInboxBucket({
    from: "Hetzner Online <support@hetzner.com>",
    subject: "Your Hetzner verification code is 378606",
    body: "Please use the following code to verify your account: 378606",
  });
  assertEquals(hetzner.bucket, "notification");
});

Deno.test("a lone question mark in a machine mail does not make it a ticket", () => {
  const out = classifyInboxBucket({
    from: "noreply@service.example.com",
    subject: "Your account review is complete",
    body: "This is an automated message. Questions? Visit our help center.",
  });
  assertEquals(out.bucket, "notification");
});

Deno.test("Shopify contact-form relay with a real question stays a ticket", () => {
  const out = classifyInboxBucket({
    from: "mailer@shopify.com",
    subject: "New customer message on 15 July 2026",
    body: "You received a new message from your online store's contact form.\nName: Karen Jensen\nEmail: kj@example.com\nBody: Hej, min A-Spire virker ikke — kan I hjælpe? Hvor er min ordre?",
  });
  assertEquals(out.bucket, "ticket");
});

Deno.test("genuine customer question from personal email stays a ticket", () => {
  const out = classifyInboxBucket({
    from: "Liam Wright <liamwright5@hotmail.co.uk>",
    subject: "repair",
    body: "Hi, can you help me get my headset repaired? The arm is loose.",
  });
  assertEquals(out.bucket, "ticket");
});
