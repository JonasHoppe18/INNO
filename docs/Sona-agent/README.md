# Greenfield Sona Support Agent

This is a small, isolated experiment to see whether one well-grounded Sona
Support Agent can behave like a strong ecommerce customer-service employee.
It exists to learn from real support cases with a simpler, inspectable core:
good knowledge, a small set of tools, deterministic security, tracing, and
offline evaluation.

Greenfield is independent from the V2 and V3 architectures. Production,
staging, and V3 remain untouched. The experiment starts with one primary Sona
Support Agent and one model/tool loop. Additional routing, orchestration,
pipelines, or specialized agents must be earned by evaluation results.

Non-negotiable principles:

- No case-specific patches. Fix general knowledge, tool contracts, boundaries,
  or model instructions instead.
- Live order, shipment, and customer facts come from scoped tools, not stale
  embeddings.
- Merchant policy is authoritative; historical tickets are examples/evidence,
  never silent policy.
- Read-only capabilities may run when safely scoped. Sensitive actions are
  proposal-only in greenfield.
- Tenant isolation and authorization are enforced in code, not trusted to the
  model.
- Every useful run is traceable and evaluated outside the critical response
  path.

The current vertical slice is the `POST /api/greenfield-support` route backed
by `apps/web/lib/greenfield-support`: it resolves the authenticated workspace
and Shopify connection server-side, runs the agent, and returns a customer
response, proposed actions, and trace. It does not send email or mutate a
store.
