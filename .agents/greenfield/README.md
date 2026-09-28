# Greenfield Sona Support Agent

> **Target architecture** under udvikling. Factory, miljøer og design-system ligger i forældermappen `.agents/`. V2 (`generate-draft-v2`) forbliver live i prod indtil cutover — se [../legacy/v2-pipeline.md](../legacy/v2-pipeline.md). Alt default-arbejde og Supabase MCP går til **dev** — se [../environments.md](../environments.md).

Målet er én well-grounded Sona Support Agent der kan opføre sig som en stærk ecommerce customer-service medarbejder end-to-end: god knowledge, et lille sæt tools, deterministisk security, tracing og offline evaluation — og dermed højere svarkvalitet end V2-pipelinen.

Arbejdet starter med én primary Sona Support Agent og én model/tool-loop. Yderligere routing, orchestration, pipelines eller specialiserede agents skal **tjenes** via eval-resultater på dev.

## Non-negotiable principles

- No case-specific patches. Fix general knowledge, tool contracts, boundaries, or model instructions instead.
- Live order, shipment, and customer facts come from scoped tools, not stale embeddings.
- Merchant policy is authoritative; historical tickets are examples/evidence, never silent policy.
- Read-only capabilities may run when safely scoped. Sensitive actions are proposal-only until cutover explicitly allows otherwise.
- Tenant isolation and authorization are enforced in code, not trusted to the model.
- Every useful run is traceable and evaluated outside the critical response path.

## Current vertical slice

`POST /api/greenfield-support` backed by `apps/web/lib/greenfield-support`: resolves authenticated workspace and Shopify connection server-side, runs the agent, returns customer response, proposed actions, and trace. It does not send email or mutate a store (yet).

Mere detalje:

- [architecture.md](architecture.md) — agent-loop og lag
- [knowledge-architecture.md](knowledge-architecture.md)
- [tools-and-actions.md](tools-and-actions.md)
- [safety-and-tenancy.md](safety-and-tenancy.md)
- [evaluation.md](evaluation.md)
