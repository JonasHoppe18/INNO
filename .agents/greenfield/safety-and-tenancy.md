# Safety and tenancy

Greenfield uses simple deterministic boundaries around one agent and its
providers. It does not introduce a separate safety platform.

- **Tenant isolation:** the authenticated workspace and one scoped shop are
  resolved server-side. Knowledge search filters by workspace in application
  code and again in SQL.
- **Authorization:** the route requires an authenticated Clerk session and a
  single active Shopify shop in that workspace.
- **Trusted context:** the model cannot choose `workspace_id`, `shop_id`, a
  tenant ID, authorization scope, or credentials. It cannot choose which
  tenant a lookup runs against.
- **Tool validation:** schemas are strict, unknown fields and malformed JSON
  are rejected, and sensitive capability names are allow-listed.
- **Read/write boundary:** read-only providers execute; sensitive capabilities
  return proposals only. There is no greenfield write path.
- **Failure states:** missing context, not found, invalid arguments, provider
  errors, and bounded-loop exhaustion remain explicit and observable.
- **Data is data:** customer messages, history, retrieved documents, and tool
  results are untrusted data, not system instructions. Retrieved text cannot
  change the agent's rules or security boundary.
- **Sensitive data:** credentials never enter model input or traces. Customer
  data is only supplied from the authenticated, scoped case context and is
  minimized in returned capabilities and observability.
- **Environment boundary:** no production mutation, email send, refund,
  cancellation, return, replacement, or address update is possible from the
  greenfield route.

These checks are enforced by the server, tool registry, provider interfaces,
and database scope—not by asking the model to behave safely.
