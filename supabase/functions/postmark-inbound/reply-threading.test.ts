import { replyLookupIds } from "./reply-threading.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("a reply to a Postmark email also matches the stored Postmark id", () => {
  assertEquals(replyLookupIds("9c57dbb9-64ec-44fe-8453-78fac8285b19@mtasv.net"), [
    "9c57dbb9-64ec-44fe-8453-78fac8285b19@mtasv.net",
    "9c57dbb9-64ec-44fe-8453-78fac8285b19",
  ]);
  assertEquals(replyLookupIds("9C57DBB9-64EC-44FE-8453-78FAC8285B19@MTASV.NET")[1], "9C57DBB9-64EC-44FE-8453-78FAC8285B19");
});

Deno.test("other message ids are looked up as they are", () => {
  assertEquals(replyLookupIds("EF157F01-4A14-4842@hotmail.com"), ["EF157F01-4A14-4842@hotmail.com"]);
  assertEquals(replyLookupIds("abc@mtasv.net.evil.com"), ["abc@mtasv.net.evil.com"]);
  assertEquals(replyLookupIds(""), []);
});
