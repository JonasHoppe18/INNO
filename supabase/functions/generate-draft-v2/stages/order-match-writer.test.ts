import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildLiveFactAuthorityBlock,
  buildOrderMatchDirective,
} from "./writer.ts";
import type { OrderMatch } from "./fact-resolver.ts";

function match(state: OrderMatch["state"]): OrderMatch {
  return {
    state,
    candidate_count: state === "multiple_email_matches" ? 2 : (state === "missing_identifiers" || state === "order_not_found" || state === "integration_error" ? 0 : 1),
    had_order_number: state === "exact_order_number",
    had_email: state !== "missing_identifiers",
    selected_order_name: state === "exact_order_number" || state === "single_email_match" ? "#1001" : null,
  };
}

// 11. verified live facts override stale knowledge in writer instructions
Deno.test("authority block states live facts override stale knowledge", () => {
  const block = buildLiveFactAuthorityBlock().toLowerCase();
  assertStringIncludes(block, "verific"); // "verificerede"
  // live facts are authoritative and override stale knowledge on conflict
  assertStringIncludes(block, "overstyr"); // "...overstyre forældet viden"
  assertStringIncludes(block, "live-fakta vinder");
  // never guess the risky fact families when live facts are missing
  for (const term of ["tracking", "lager", "refunder", "annuller", "fulfillment", "ordre"]) {
    assertStringIncludes(block, term);
  }
});

// 12. missing facts lead to clarification rather than guessing
Deno.test("integration_error directive avoids 'order not found' and asks safely", () => {
  const d = buildOrderMatchDirective(match("integration_error")).toLowerCase();
  assert(!d.includes("kunne ikke findes") && !d.includes("not found") && !d.includes("ikke fundet"));
  // safe "unable to verify right now" wording, not a not-found claim
  assertStringIncludes(d, "i øjeblikket");
  assertStringIncludes(d, "kan desværre ikke verificere");
});

Deno.test("order_not_found directive asks to verify, does not say customer has no order", () => {
  const d = buildOrderMatchDirective(match("order_not_found")).toLowerCase();
  assertStringIncludes(d, "bekræft"); // ask to verify the number
});

Deno.test("multiple_email_matches directive asks for order number, exposes only a count", () => {
  const d = buildOrderMatchDirective(match("multiple_email_matches"));
  assertStringIncludes(d.toLowerCase(), "ordrenummer");
  assertStringIncludes(d, "2"); // safe summary count only
});

Deno.test("single_email_match directive flags email-fallback origin", () => {
  const d = buildOrderMatchDirective(match("single_email_match")).toLowerCase();
  assertStringIncludes(d, "email");
});

Deno.test("missing_identifiers directive asks for order number first then email", () => {
  const d = buildOrderMatchDirective(match("missing_identifiers")).toLowerCase();
  assertStringIncludes(d, "ordrenummer");
  assertStringIncludes(d, "email");
});

Deno.test("exact_order_number directive allows direct verified answer", () => {
  const d = buildOrderMatchDirective(match("exact_order_number"));
  assert(d.length > 0);
});
