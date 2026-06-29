import { assertEquals } from "jsr:@std/assert@1";
import { type RetrievedChunk, selectPolicyFallback } from "./retriever.ts";

const OPTS = {
  max: 2,
  scoreRatio: 0.6,
  customerMessage: "I need help with a warranty claim",
  plannerQueries: ["warranty claim procedure"],
  issueTerms: ["warranty"],
};

function chunk(
  id: string,
  usable_as: RetrievedChunk["usable_as"],
  similarity: number,
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    id,
    content: `content ${id}`,
    kind: "document",
    source_label: `knowledge_document: ${id}`,
    source_title: id,
    similarity,
    usable_as,
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: [],
    products: [],
    ...overrides,
  } as RetrievedChunk;
}

function ids(result: ReturnType<typeof selectPolicyFallback>): string[] {
  return result.chunks.map((c) => c.id);
}

Deno.test("Warranty claims beats Return for swap when customer/planner says warranty claim", () => {
  const result = selectPolicyFallback([
    chunk("return", "policy", 0.9, {
      source_title: "Return for swap (warranty replacement)",
      content: "Return the product for swap after troubleshooting.",
    }),
    chunk("claims", "policy", 0.75, {
      source_title: "Warranty claims",
      content:
        "For warranty claims, ask for proof of purchase and issue evidence.",
    }),
  ], OPTS);

  assertEquals(ids(result), ["claims", "return"]);
  assertEquals(result.debug[0].chunk_id, "claims");
  assertEquals(result.debug[0].overlap_reason !== "none", true);
});

Deno.test("Generic return flow still allows Return for swap over Warranty claims", () => {
  const result = selectPolicyFallback([
    chunk("return", "policy", 0.8, {
      source_title: "Return for swap",
      content: "Return the product for swap after troubleshooting.",
    }),
    chunk("claims", "policy", 0.75, {
      source_title: "Warranty claims",
      content: "For warranty claims, ask for proof of purchase.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage: "I want to return my headset.",
    plannerQueries: ["return swap process"],
    issueTerms: ["return"],
  });

  assertEquals(ids(result)[0], "return");
});

Deno.test("Missing accessories and spare parts is selected for buy/new replacement dongle intent", () => {
  const result = selectPolicyFallback([
    chunk("pairing", "policy", 0.9, {
      source_title: "Dongle pairing",
      content: "Pair the headset with the dongle.",
    }),
    chunk("missing", "policy", 0.82, {
      source_title: "Missing accessories and spare parts",
      content:
        "Ask which accessory is missing and explain the spare-part replacement process.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage: "Kan jeg købe en ny dongle til mit headset?",
    plannerQueries: ["how to buy a replacement dongle"],
    issueTerms: ["accessory"],
  });

  assertEquals(ids(result), ["missing"]);
  assertEquals(
    result.debug[0].overlap_reason.includes("accessory_family"),
    true,
  );
});

Deno.test("Cable and adapter compatibility is not rescued for power/reset intent without reset/power overlap", () => {
  const result = selectPolicyFallback([
    chunk("cable", "policy", 0.9, {
      source_title: "Cable and adapter compatibility",
      content: "Any standard USB-C cable works for charging.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage:
      "My A-Spire Wireless will not power on. How do I reset it?",
    plannerQueries: ["A-Spire Wireless power reset"],
    issueTerms: ["battery"],
  });

  assertEquals(ids(result), []);
});

Deno.test("Factory reset is preferred over cable compatibility when both are in pool", () => {
  const result = selectPolicyFallback([
    chunk("cable", "policy", 0.9, {
      source_title: "Cable and adapter compatibility",
      content: "Any standard USB-C cable works for charging.",
    }),
    chunk("reset", "procedure", 0.7, {
      source_title: "Factory reset",
      content:
        "To factory reset the headset, hold the power button for 15 seconds.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage:
      "My A-Spire Wireless will not power on. How do I reset it?",
    plannerQueries: ["A-Spire Wireless factory reset power issue"],
    issueTerms: ["battery"],
  });

  assertEquals(ids(result), ["reset"]);
});

Deno.test("No fallback selection when policy chunks have no title/question/content intent overlap", () => {
  const result = selectPolicyFallback([
    chunk("policy", "policy", 0.9, {
      source_title: "Shipping address changes",
      content: "Ask the customer for the new delivery address.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage: "I need help with a warranty claim",
    plannerQueries: ["warranty claim procedure"],
    issueTerms: ["warranty"],
  });

  assertEquals(ids(result), []);
});

Deno.test("Accessory/missing-part intent does not rescue Dongle pairing", () => {
  const result = selectPolicyFallback([
    chunk("pairing", "policy", 0.9, {
      source_title: "Dongle pairing",
      content: "Pair the headset with the dongle.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage: "I lost my dongle. Can I buy a replacement spare part?",
    plannerQueries: ["missing dongle replacement spare part"],
    issueTerms: ["accessory"],
  });

  assertEquals(ids(result), []);
});

Deno.test("Accessory/missing-part intent does not rescue microphone dongle troubleshooting", () => {
  const result = selectPolicyFallback([
    chunk("mic", "policy", 0.85, {
      source_title: "Microphone works with the cable but not with the dongle",
      content: "Reset the dongle driver in Device Manager.",
    }),
  ], {
    max: 2,
    scoreRatio: 0.6,
    customerMessage: "I lost my dongle. Can I buy a replacement spare part?",
    plannerQueries: ["missing dongle replacement spare part"],
    issueTerms: ["accessory"],
  });

  assertEquals(ids(result), []);
});

Deno.test("Existing cap max 2 still applies after lexical ranking", () => {
  const result = selectPolicyFallback([
    chunk("p1", "policy", 0.9, {
      source_title: "Warranty claims",
      content: "Warranty claim process.",
    }),
    chunk("p2", "procedure", 0.85, {
      source_title: "Warranty repair procedure",
      content: "Warranty repair process.",
    }),
    chunk("p3", "policy", 0.84, {
      source_title: "Warranty documentation",
      content: "Warranty documentation process.",
    }),
  ], OPTS);

  assertEquals(ids(result).length, 2);
});

Deno.test("fact/saved_reply/background/tone_example chunks are still never rescued", () => {
  const result = selectPolicyFallback([
    chunk("f", "fact", 0.99, { source_title: "Warranty claims" }),
    chunk("s", "saved_reply", 0.98, { source_title: "Warranty claims" }),
    chunk("b", "background", 0.97, { source_title: "Warranty claims" }),
    chunk("t", "tone_example", 0.96, { source_title: "Warranty claims" }),
  ], OPTS);

  assertEquals(ids(result), []);
});

Deno.test("empty / below floor / non-positive scores yield nothing", () => {
  assertEquals(ids(selectPolicyFallback([], OPTS)), []);
  assertEquals(
    ids(selectPolicyFallback([chunk("p", "policy", 0, {
      source_title: "Warranty claims",
    })], OPTS)),
    [],
  );
  assertEquals(
    ids(selectPolicyFallback([
      chunk("strong", "fact", 0.9),
      chunk("weak", "policy", 0.5, { source_title: "Warranty claims" }),
    ], OPTS)),
    [],
  );
});
