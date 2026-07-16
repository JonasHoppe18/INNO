import { assert, assertEquals } from "jsr:@std/assert@1";
import { updateCaseState } from "./case-state-updater.ts";

const EMPTY_EXTRACTION = {
  primary_intent: "update",
  language: "da",
  order_numbers: [],
  customer_email: "",
  products_mentioned: [],
  customer_country: null,
  purchase_place: null,
  open_questions: [],
  pending_asks: [],
  decisions_made: [],
};

Deno.test("case state excludes unsent composer text from LLM history and regex facts", async () => {
  const originalFetch = globalThis.fetch;
  let userPrompt = "";
  globalThis.fetch = (_input, init) => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    userPrompt = String(request.messages?.[1]?.content ?? request.input ?? "");
    return Promise.resolve(new Response(
      JSON.stringify({
        choices: [{
          message: { content: JSON.stringify(EMPTY_EXTRACTION) },
        }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ));
  };

  try {
    const result = await updateCaseState({
      thread: { id: "eval", subject: "Levering" },
      shop: {},
      supabase: {} as never,
      messages: [
        {
          id: "customer-1",
          clean_body_text: "Min pakke er ikke kommet.",
          from_me: false,
          is_draft: false,
          from_email: "kunde@example.dk",
        },
        {
          id: "agent-sent",
          clean_body_text: "Kan du bekræfte leveringsadressen?",
          from_me: true,
          is_draft: false,
        },
        {
          id: "customer-2",
          clean_body_text: "Ja, adressen er korrekt.",
          from_me: false,
          is_draft: false,
          from_email: "kunde@example.dk",
        },
        {
          id: "composer-draft",
          clean_body_text:
            "UNSENT_PRIVATE_PROMISE: We refunded order #9999 and sent a replacement.",
          from_me: true,
          direction: "outbound",
          is_draft: true,
        },
      ],
    });

    assert(userPrompt.includes("Kan du bekræfte leveringsadressen?"));
    assert(userPrompt.includes("Ja, adressen er korrekt."));
    assertEquals(userPrompt.includes("UNSENT_PRIVATE_PROMISE"), false);
    assertEquals(result.entities.order_numbers.includes("#9999"), false);
    assertEquals(result.last_updated_msg_id, "customer-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
