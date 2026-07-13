// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { rewriteCapabilityRefusals } from "./capability-refusal-rewrite.ts";

const HEDGE_EN = "Let me look into that and get back to you.";
const HEDGE_DA = "Det undersøger jeg og vender tilbage til dig om.";

Deno.test("replaces the capability sentence with an English hedge, keeps neighbors", () => {
  const draft = "Hi there. Unfortunately we don't offer individual mic clips separately. Let me know if there's anything else.";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [{ type: "unsupported_capability_claim", excerpt: "we don't offer individual mic clips separately" }],
    language: "en",
  });
  assertEquals(out.rewritten, true);
  assert(out.draft.includes("Hi there."));
  assert(out.draft.includes("Let me know if there's anything else."));
  assert(out.draft.includes(HEDGE_EN));
  assert(!out.draft.toLowerCase().includes("we don't offer individual mic clips"));
});

Deno.test("Danish hedge for da language", () => {
  const draft = "Hej. Desværre har vi ikke mulighed for at kontakte Maxgaming direkte. Mvh";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [{ type: "unsupported_capability_claim", excerpt: "har vi ikke mulighed for at kontakte Maxgaming direkte" }],
    language: "da",
  });
  assertEquals(out.rewritten, true);
  assert(out.draft.includes(HEDGE_DA));
  assert(out.draft.includes("Hej."));
  assert(out.draft.includes("Mvh"));
  assert(!out.draft.includes("ikke mulighed for at kontakte Maxgaming"));
});

Deno.test("only capability violations are rewritten; other families ignored", () => {
  const draft = "The A-Rise is out of stock right now.";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [{ type: "unsupported_negative_availability_claim", excerpt: "out of stock" }],
    language: "en",
  });
  assertEquals(out.rewritten, false);
  assertEquals(out.draft, draft);
});

Deno.test("no capability violations is a no-op", () => {
  const draft = "Sure, I can help with that.";
  const out = rewriteCapabilityRefusals({ draft, violations: [], language: "en" });
  assertEquals(out.rewritten, false);
  assertEquals(out.draft, draft);
});

Deno.test("two capability violations in one sentence collapse to a single hedge", () => {
  const draft = "We don't offer that and we can't do it either. Thanks.";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [
      { type: "unsupported_capability_claim", excerpt: "We don't offer that" },
      { type: "unsupported_capability_claim", excerpt: "we can't do it either" },
    ],
    language: "en",
  });
  assertEquals(out.rewritten, true);
  assertEquals((out.draft.match(/Let me look into that/g) || []).length, 1);
  assert(out.draft.includes("Thanks."));
});
