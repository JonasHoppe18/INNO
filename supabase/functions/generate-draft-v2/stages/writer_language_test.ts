import { normalizeOpeningGreeting, resolveWriterReplyLanguage } from "./writer.ts";

Deno.test("writer language fallback preserves Danish preview comparison replies", () => {
  const language = resolveWriterReplyLanguage({
    latestCustomerMessage: "Hvor mange dage har jeg til at returnere?",
    replyLanguageFallback: "da",
  });

  if (language !== "da") {
    throw new Error(`Expected Danish reply language, got ${language}`);
  }
});

Deno.test("writer language detection keeps English preview comparison replies English", () => {
  const language = resolveWriterReplyLanguage({
    latestCustomerMessage: "How many days do I have to return this item?",
    replyLanguageFallback: "da",
  });

  if (language !== "en") {
    throw new Error(`Expected English reply language, got ${language}`);
  }
});

Deno.test("both preview comparison arms can share the same resolved language fallback", () => {
  const withRunLanguage = resolveWriterReplyLanguage({
    latestCustomerMessage: "Hvor mange dage har jeg til at returnere?",
    replyLanguageFallback: "da",
  });
  const withoutRunLanguage = resolveWriterReplyLanguage({
    latestCustomerMessage: "Hvor mange dage har jeg til at returnere?",
    replyLanguageFallback: "da",
  });

  if (withRunLanguage !== withoutRunLanguage) {
    throw new Error(
      `Expected identical language context, got ${withRunLanguage} and ${withoutRunLanguage}`,
    );
  }
});

Deno.test("neutral salutation replaces unsafe named English greeting", () => {
  const draft = normalizeOpeningGreeting(
    "Hi Evan,\n\nThank you for sending the return tracking number.",
    "",
    "en",
    true,
  );

  if (!draft.startsWith("Hi there,\n\n")) {
    throw new Error(`Expected neutral greeting, got ${draft}`);
  }
});

Deno.test("resolved salutation preserves safe customer name", () => {
  const draft = normalizeOpeningGreeting(
    "Evan,\n\nThanks for your message.",
    "Britt",
    "en",
  );

  if (!draft.startsWith("Hi Britt,\n\n")) {
    throw new Error(`Expected resolved greeting, got ${draft}`);
  }
});
