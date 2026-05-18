import { assertEquals } from "jsr:@std/assert@1";
import { shouldSkipInboxMessage } from "./inbox-filter.ts";

Deno.test("sale in body does not filter legitimate customer email", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "customer@example.com",
      subject: "Problem with my order",
      body: "I bought this during the Black Friday sale and it arrived broken.",
    }),
    false,
  );
});

Deno.test("sale in subject filters promotional email", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "promo@store.com",
      subject: "Big summer sale — 50% off everything",
      body: "Check out our deals",
    }),
    true,
  );
});

Deno.test("discount in body does not filter customer asking about discount code", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "customer@example.com",
      subject: "My order question",
      body: "I used a discount code but it didn't apply correctly.",
    }),
    false,
  );
});

Deno.test("newsletter in body still filters bulk email", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "news@brand.com",
      subject: "June update",
      body: "You are receiving this newsletter because you subscribed.",
    }),
    true,
  );
});

Deno.test("list-unsubscribe header still filters bulk email", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "bulk@brand.com",
      subject: "Weekly digest",
      body: "Your weekly summary",
      headers: [{ name: "List-Unsubscribe", value: "<mailto:unsub@brand.com>" }],
    }),
    true,
  );
});

Deno.test("klaviyo sender still filtered", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "noreply@klaviyo.com",
      subject: "Abandoned cart",
      body: "You left something behind",
    }),
    true,
  );
});

Deno.test("marketing in subject filters promotional email", () => {
  assertEquals(
    shouldSkipInboxMessage({
      from: "team@brand.com",
      subject: "Our marketing update for May",
      body: "Here's what we've been up to",
    }),
    true,
  );
});
