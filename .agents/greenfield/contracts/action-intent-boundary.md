# Action intent boundary

Greenfield interprets each current customer message into a schema-validated TurnIR before resolving the order or entering the support model's tool loop. No existing TurnIR implementation was present in Greenfield. The legacy V2 planner combines intent with resolution planning, case state and merchant context; it is not a quote-bound current-turn interpretation service. This change keeps that production pipeline separate. The interpreter has no tools and returns language-neutral action names, an exact source quote, an explicit order reference, and whether a new delivery address was supplied. It does not decide eligibility, authorization, identity or operational state.

The capability registry binds the intent to the current verified customer order and evaluates the shared action eligibility contract. An interpretation cannot select a different verified order. Blocked intents create evidence records and bounded limitations before any proposal tool call. An eligible address change with no supplied address creates one bounded question asking only for the address. These responses pass the existing response contract and renderer; the support writer is not invoked for them.

Eligible actions retain the normal proposal path. Proposal tools still refresh current order state and repeat scope, identity, schema, eligibility and authorization validation. A semantic address intent controls the address-request guard in the SDK path; the old English predicate remains only for callers without a TurnIR. A model cannot supply a missing customer address to obtain a proposal.

The interpreter is mandatory in the normal SDK path. Tests inject a server-owned interpreter to isolate semantic interpretation from the deterministic boundary. Live read-only evaluation verifies the real interpreter separately. Neither the client nor the support writer supplies a TurnIR or grants approval.

DEV trace projection retains action, eligibility and outcome without exposing customer quotes, addresses or authorization payloads. Final bounded composition is marked `action_boundary`; the support model is marked `not_run` when skipped.

This boundary creates no external execution authority. Customer confirmation, existing action execution checks, workspace/shop scope and remedy assessment requirements still apply. Knowledge, commerce adapters, merchant data, product resolution and writer instructions are unchanged.

A technical interpretation failure is recorded as `turn_ir_unavailable`, distinct from a successful TurnIR with no actions. The turn continues through the existing read-only answer path. A server-owned failure flag blocks every proposal-only tool before argument parsing or provider access, so a model-created action cannot become a proposal or execution. No provider error details are exposed in the trace.
