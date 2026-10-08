# Source-bound response validation and coverage

ResponseSegment remains the only answer representation. Existing TurnIR supplies
quoted answer requests alongside policy/action intent. Coverage is validation
metadata, compiled from the current request, scoped CaseState, current order
focus and current-run evidence. It cannot authorize or execute an action.

## Supported projections

- `order_amount` binds the total and currency of the same verified order.
- `line_fulfillment` binds a current order line to a complete fulfillment mapping.
  Identity, variants, quantities and fulfillment IDs must agree. Fulfillment
  never establishes delivery. Missing mapping or dates produce bounded limits.
- `source_content` renders exact returned product properties, care constraints
  or policy conditions. Material/composition and dimension obligations remain
  distinct. Internal evidence-boundary instructions are not customer guidance.
- `source_comparison` compares verified order total with a source-authored
  shipping threshold in the same currency and destination. It cannot establish
  actual charged shipping, coupon treatment or a different subtotal.
- `procedure_guidance` binds actual blocks and preserves their source order.
  Procedural authority, provenance, applicability and evidence quality control
  acceptance. Verified procedures carried by `search_policy` are supported.
- `evidence_limitation` renders a bounded server-defined limitation only when
  current evidence establishes the missing detail. Photos ready are not files
  received, and an unspecified submission channel is never invented.

## Coverage and recovery

The ledger records requested, supported, satisfied, missing and unavailable
obligations. An empty cue list does not establish completeness. Identity facts
and generic order status do not satisfy line, composition, care or intake needs.

Recovery projects source fields through the ordinary segment validator. It does
not recover model prose. A full validated projection replaces a partial copy.
A valid citation never licenses substituting cotton for wool or inventing an
amount, cleaning method, delivery time or completed remedy. Unknown, expired or
cross-scope evidence remains blocked. Successful action-boundary decisions keep
their existing precedence over read-only completeness recovery.

DEV diagnostics preserve segment indices/types, semantic evidence kinds,
current result/source IDs, rejection codes, obligation IDs and recovery status.
The Playground sanitizer excludes raw customer/model/source text and PII from
these fields. Detailed replay captures remain private, ignored artifacts.

## Validation

Run deterministic Greenfield, Knowledge, Action and server tests with external
live-evaluation files excluded, plus web typecheck. Use unchanged targeted
Customer #2 cases with DEV GET-only providers and disabled mutation providers.
Preserve sealed benchmark cases, oracle, baseline and scores. A new full
benchmark or deployment requires a separate instruction.
