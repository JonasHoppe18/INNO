# Evaluation

The core question is:

> Would a strong ecommerce customer-service employee consider this response
> and proposed handling correct and useful?

For each case, evaluate whether Sona:

1. understood the actual issue;
2. obtained the information needed;
3. used the correct tools/systems;
4. followed merchant policy;
5. proposed the correct operational next step;
6. avoided unnecessary questions;
7. avoided unsupported claims;
8. handled multiple intents;
9. produced a natural, sendable response; and
10. escalated when verified information was insufficient.

The initial set combines golden cases and representative historical support
cases. Deterministic checks cover tenant scope, forbidden tool arguments,
read/write classification, expected retrieval classes, live-lookup use,
proposal-only actions, explicit failure states, and unsupported completion
claims. An optional LLM judge may score customer-service quality, but it is
evidence—not the only authority.

Every change is compared with the previous greenfield run for regressions in
response quality, tool choice, policy grounding, safety, and latency. Traces
retain tool calls, results, provenance, proposed actions, failures, and model
usage needed for diagnosis.

Evaluation stays outside the critical response path initially. A failing case
should improve a general contract, source, boundary, or instruction; it must
not create a case-specific patch.
