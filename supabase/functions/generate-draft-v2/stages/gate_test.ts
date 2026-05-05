import { isForwardedInternalStatusNote, runGate } from "./gate.ts";

Deno.test("isForwardedInternalStatusNote catches short internal repair note above forwarded mail", () => {
  const body = `1 stk H1 repair fra Htec Marine. Modtaget 5/5-26.

---------- Forwarded message ---------
From: Carsten Kronborg <carsten@example.com>
Date: Tue, 5 May 2026 at 11:47
Subject: Re: Hello
To: Carlos Passow <carlos@example.com>

Hello Carlos,
The headset arrived 5 minutes ago. We will repair within a week.`;

  if (!isForwardedInternalStatusNote(body)) {
    throw new Error("Expected internal forwarded status note to be detected");
  }
});

Deno.test("isForwardedInternalStatusNote allows customer request above forwarded mail", () => {
  const body = `Hi, can you help with the issue below?

---------- Forwarded message ---------
From: Store <support@example.com>
Date: Tue, 5 May 2026 at 11:47
Subject: Re: Return
To: Customer <customer@example.com>

Please send the item back.`;

  if (isForwardedInternalStatusNote(body)) {
    throw new Error("Expected customer request above forwarded mail to pass");
  }
});

Deno.test("runGate blocks latest message from agent", async () => {
  const result = await runGate({
    thread: {},
    shop: {},
    latestMessage: {
      clean_body_text: "We will repair within a week.",
      from_me: true,
    },
  });

  if (result.should_process || result.reason !== "latest_message_from_agent") {
    throw new Error(`Expected agent message to be blocked, got ${result.reason}`);
  }
});

Deno.test("runGate blocks forwarded internal status note", async () => {
  const result = await runGate({
    thread: {},
    shop: {},
    latestMessage: {
      clean_body_text:
        "1 stk H1 repair fra Htec Marine. Modtaget 5/5-26.\n\n---------- Forwarded message ---------\nFrom: Carsten <carsten@example.com>\nDate: Tue, 5 May 2026\nSubject: Re: Hello\nTo: Carlos <carlos@example.com>\n\nHello Carlos,\nThe headset arrived 5 minutes ago.",
      from_me: false,
    },
  });

  if (
    result.should_process ||
    result.reason !== "forwarded_internal_status_note"
  ) {
    throw new Error(
      `Expected forwarded status note to be blocked, got ${result.reason}`,
    );
  }
});
