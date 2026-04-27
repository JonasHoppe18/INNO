import { assertEquals } from "jsr:@std/assert@1";
import { categorizeEmail } from "./email-category.ts";

// Note: categorizeEmail uses keyword matching first (sync), then OpenAI (async).
// These tests exercise keyword matching only — no network calls needed.

Deno.test("Wrong item: keyword match 'received wrong item'", async () => {
  const result = await categorizeEmail({
    subject: "I received the wrong item",
    body: "My order arrived but the item inside is completely different from what I ordered.",
  });
  assertEquals(result, "Wrong item");
});

Deno.test("Wrong item: Danish 'forkert vare'", async () => {
  const result = await categorizeEmail({
    subject: "Forkert vare",
    body: "Jeg har modtaget forkert vare i min pakke.",
  });
  assertEquals(result, "Wrong item");
});

Deno.test("Missing item: keyword match 'missing item'", async () => {
  const result = await categorizeEmail({
    subject: "Item missing from my order",
    body: "My package arrived but one item is missing.",
  });
  assertEquals(result, "Missing item");
});

Deno.test("Missing item: Danish 'manglende vare'", async () => {
  const result = await categorizeEmail({
    subject: "Manglende vare",
    body: "Der mangler en vare i pakken jeg modtog i dag.",
  });
  assertEquals(result, "Missing item");
});

Deno.test("Complaint: keyword match 'very disappointed'", async () => {
  const result = await categorizeEmail({
    subject: "Very disappointed",
    body: "I am very disappointed with the service I received.",
  });
  assertEquals(result, "Complaint");
});

Deno.test("Fraud / dispute: keyword match 'unauthorized charge'", async () => {
  const result = await categorizeEmail({
    subject: "Unauthorized charge",
    body: "There was an unauthorized charge on my card from your store.",
  });
  assertEquals(result, "Fraud / dispute");
});

Deno.test("Warranty: keyword match 'warranty claim'", async () => {
  const result = await categorizeEmail({
    subject: "Warranty claim",
    body: "I would like to make a warranty claim for my defective product.",
  });
  assertEquals(result, "Warranty");
});

Deno.test("Warranty: Danish 'garanti'", async () => {
  const result = await categorizeEmail({
    subject: "Garanti",
    body: "Mit produkt er gået i stykker og er stadig inden for garantiperioden.",
  });
  assertEquals(result, "Warranty");
});

Deno.test("Gift card: keyword match", async () => {
  const result = await categorizeEmail({
    subject: "Gift card not working",
    body: "I am trying to redeem my gift card but the code is not working.",
  });
  assertEquals(result, "Gift card");
});

Deno.test("Gift card: Danish 'gavekort'", async () => {
  const result = await categorizeEmail({
    subject: "Gavekort virker ikke",
    body: "Jeg kan ikke indløse mit gavekort.",
  });
  assertEquals(result, "Gift card");
});
