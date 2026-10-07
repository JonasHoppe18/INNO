# Action eligibility

Action intent and technical capability do not establish eligibility. The shared proposal validator evaluates current order state and, for remedies, a scoped assessment before a proposal is returned. The dry-run executor repeats the same validation.

The registry refreshes the customer-owned order before each action attempt. A failed refresh clears the previous operational snapshot. The SDK removes earlier proposals that fail the final state check.

Order-wide cancellation and address changes require an open, unfulfilled order. Partial fulfillment blocks these whole-order operations because their tool schemas do not support remaining-line scope.

Refunds and replacements require a server-owned assessment with workspace, shop, order, action and affected-line scope, evidence references, satisfied requirements and an explicit approval decision. Refunds must stay within the approved monetary limit. A complaint return uses the same assessment boundary. Ordinary returns retain their existing prerequisites.

For complaint remedies on partial orders, the affected line must have verified fulfillment mapping for its full quantity. These tools have no quantity argument. A fulfilled line can remain eligible for an approved remedy even while another line is unfulfilled. A closed order does not by itself invalidate an explicitly approved refund.

Capability, eligibility and authorization remain separate checks. Approval does not substitute for evidence or operational eligibility. An eligible proposal still requires customer confirmation; it does not authorize an external execution.

When a verified-order action fails the gate, the Decision boundary supplies a bounded non-action or assessment outcome to the existing renderer. Completeness recovery cannot replace that outcome with an ineligible action path. Missing identity or unverified-order intake retains the existing flow.

`RemedyAuthorization` is a trusted server interface. The customer, client request, model and tool arguments cannot populate it. This change adds no approval UI, automatic assessment, merchant policy, mutation adapter or delivery channel. The current Playground route supplies no remedy approval and therefore routes unresolved assessments to support.

The deterministic controls cover fulfillment states, partial line mapping and quantity, scoped approvals, monetary limits, positive actions reaching the dry-run executor, stale state and failed refreshes. Existing lifecycle tests now represent explicitly approved refunds and reject unassessed replacements.
