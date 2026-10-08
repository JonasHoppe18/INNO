# Correctness R1 — implementation and verification

## Root causes repaired

- Coarse product/care coverage could treat dimensions as capacity, a description as certification, or dishwasher uncertainty as the complete care answer. Named TurnIR facets now compile requests before reads.
- The response boundary rejected genuine negative GUIDANCE and documented absence under an Evidence boundary heading. Validation now uses semantic source kind/domain, authority, provenance, product applicability and exact returned section fields; internal instructions remain blocked.
- Model prose and generic product limitations could add unsupported statements or erase the specific limitation. Precise product answers require source-derived segments or a validated typed facet uncertainty.
- Missing facets depended on model tool selection. Bounded existing-tool reads now run independently, with a verified catalog identity, both supported catalog envelopes and a verified-handle retry. The alias retry handles full-title scoring that otherwise suppresses a material-only unit.
- An approved care segment on a clarification turn could lose its applicable alternatives. Existing source-bound completeness now retains the selected product's verified care constraints and alternatives; no new conversation state is introduced.

## Files and architecture changed

`answer-facets.ts` shares semantic facet names, source matching and bounded read queries. `turn-ir.ts` extends the existing semantic contract and same-message product/variant interpretation. `response-contract.ts` adds typed product constraints/uncertainties, exact-source projection, scoped coverage and final-render checks. `agents-sdk.ts` registers obligations before reads, uses the existing registry with a six-read budget per requested subject and renders through coverage checking. The Playground sanitizer exposes coded facet/status/render diagnostics without raw prose or subjects. Five test files cover the new paths and retain prior contracts.

No new planner, second answer pass, competing decision engine, action authority, Writer prompt, provider, Knowledge, fixture or oracle changes. R2 action-boundary/application work and R3 durable continuity remain outside this PR.

## Targeted results per case

Frozen local SDK replay with real DEV read-only providers: 12 unchanged cases, 15 turns. This is a diagnostic replay, not benchmark scoring or deployed smoke.

| Case | Result | Required information retained |
|---|---|---|
| 038 | PASS | Electrical/customer repair is not established; damaged electrical parts require the documented support step. No repair instructions invented. |
| 039 | PASS | No approved load/weight rating; documented contact before installation. Dimensions do not certify capacity. |
| 040 | PASS | Dishwasher safety unknown; soft damp cloth and avoidance of abrasive cleaners retained. |
| 041 | PASS | Certification and heat-placement distance unverified; verify with store/manufacturer before relying on placement near heat. |
| 027 | PASS | Veneer/engineered core and dimensional tuple retained; depth axis explicitly unverified. No 18 cm depth claim. |
| 004 | PASS, both turns | Exact partial line disposition and quantities; fulfillment does not establish delivery. |
| 020 | PASS | Item/packaging photos and assessment; no invented submission channel or remedy. |
| 021 | PASS | Damage intake and assessment retained; no replacement execution or invented channel. |
| 024 | PASS, both turns | Partial line mapping followed by damage intake/assessment. |
| 033 | PASS | Standing-water/chemical restriction, damp cloth and immediate drying. |
| 042 | PASS | Verified 100% wool and Germany shipping price of 79 DKK. |
| 043 | PASS, both turns | Necessary initial identity clarification; after identity, no machine wash/tumble dry plus cold spot cleaning, airing and professional dry cleaning. |

## Supported/unknown obligation coverage

34/34 obligations that can be answered or safely bounded are satisfied. Initial 043 correctly leaves three care facets unresolved until product identity is supplied; it asks for identity rather than claiming completion. Total ledger entries across the replay: 37. Unknown load, electrical repair, certification, placement, dimension axis and photo channel remain explicit uncertainties, never positive claims. Supported care alternatives remain separate from an unknown requested cleaning method.

## Post-render coverage results

18/18 satisfied precise facet obligations are present in rendered customer text. All preservation controls were also checked directly against final text. No omissions in the checked obligations; generic lookup fallbacks 0; false asks 0 (initial 043 clarification is necessary); false proceeds 0; wrong tenant/product 0; unsupported claims found 0; real action executions 0.

## Negative safety controls

37 new deterministic tests cover forced omissions, model with no tool calls, alternate catalog/model envelopes, source reordering, mixed uncertainty/alternative blocks, current product/tenant scope, stale IDs, expired sources, authority, internal instructions, axis uncertainty and source-derived recovery. Arbitrary limitation prose about certification, repair, cleaning and completed remedies is rejected. Existing cotton/wool, unsafe care, procedural order, fulfillment and action negatives remain green. Every recovered source segment goes through the same validator.

## Regression totals

- Scoped Greenfield + Knowledge + Action + server/normal route regression: 1,085 PASS; 6 existing gated tests skipped, 58 files passed.
- Typecheck: PASS.
- A broader app-wide exploratory run found two existing landing-pricing assertion failures. Both pricing implementation and tests match the base commit byte-for-byte and are untouched by R1.
- New scoped regressions: 0.
- Original suite hash verified: sha256:d170368c532d5deb3480acec2586e3fab41adaee0e3ba96dce16fedf033b74c3. Baseline and previous rerun artifacts preserved; 82 files verified unchanged during the frozen replay.

## Unresolved limitations

The current merchant evidence does not establish an approved load rating, customer electrical repair procedure, fire certificate, heat-placement distance or dimension-axis mapping. The repair reports those boundaries; it does not manufacture merchant truth. Reads are capped at six per distinct requested subject, including its catalog lookup, and facet retrieval requires that subject’s verified current product identity. The existing R2 action/composition and R3 durable task-continuity defects are not claimed fixed. Writing repetition remains outside scope.

## Risks before DEV deployment

The focused replay uses the local branch with current DEV providers, not deployed Clerk-authenticated Playground. Review and explicit merge/deployment approval are still required, followed by fresh DEV smoke for the target and preservation cases. Precise product prose that lacks source binding is now intentionally rejected and replaced through existing recovery; the targeted tests cover the resulting behavior.

## Readiness for R2

YES — R1 is ready for review and DEV smoke; the existing ledger/segments form the foundation for R2. No R2 implementation, merge, deployment or full 45-case rerun was performed.

## PROD writes

0. Shopify mutations 0. Outbound sends 0.


## PR #104 review closure

All three review findings are repaired within the existing R1 architecture:

- Each named subject gets its own catalog lookup before facet reads. Server-recorded read IDs bind only that subject's requests. Source applicability, recovery, safety dependencies and post-render coverage use the corresponding verified product ID. One subject cannot spend another's six-read budget. Multiple-product source projections and limitations identify their subject. Unresolved or ambiguous identities receive a scoped identity limitation; another product's knowledge cannot establish their properties.
- Axis matching accepts labeled noun/value and value/adjective phrasing for width, depth and height in English and Danish, including decimal values and ordinary Danish definite/neuter forms. Explicit axes require a measurement unit. Labeled measurements also satisfy the dimensional-values obligation. Unlabeled tuples still do not establish an axis. A separate axis's uncertainty does not suppress an explicitly labeled measurement.
- Typed facet limitations and qualified safety handoffs use the existing locale handling. Danish and English controls cover unavailable information, unresolved identity and electrical/load/certification handoffs. Source meaning, authority and action eligibility remain unchanged.

48 new review controls pass, bringing the facet/SDK cohort to 85 tests. The complete scoped Greenfield, Knowledge, Action, server and route regression passes 1,133 tests; 6 existing gated tests are skipped. Typecheck and diff whitespace checks pass.

### Fresh targeted replay

The unchanged R1 cohort was replayed through the local candidate SDK with current, guarded DEV read-only providers. Final source hashes match the frozen diagnostic runtime. No full benchmark, deployment or configuration change was performed.

| Case | Final frozen replay |
|---|---|
| 038 | PASS: documented electrical repair boundary and support disposition retained. |
| 039 | PASS: load rating unverified; contact before installation retained. |
| 040 | PASS: dishwasher uncertainty, damp cloth alternative and abrasive restriction retained. |
| 041 | PASS: certification/placement uncertainty and qualified next step retained. |
| 027 | PASS: material and tuple retained; no inferred 18 cm depth. |
| 004 | PASS: both turns retain exact partial fulfillment and delivery limitation. |
| 020 | PASS: photo/packaging/assessment intake and missing-channel limitation retained. |
| 021 | PASS: damage intake retained; no executed replacement or invented channel. |
| 024 | First turn PASS; second turn FAIL in the final live replay. See stability finding below. |
| 033 | PASS: chemical/standing-water restrictions and approved care retained. |
| 042 | PASS: verified wool composition and 79 DKK shipping retained. |
| 043 | PASS: necessary initial identity clarification followed by supported care restrictions and alternatives. |

Final live result: 11/12 cases, 14/15 turns pass the preservation checks. All 18 satisfied precise facets reach the rendered answer. The ledger contains 36 obligations: 33 satisfied and 3 legitimately unresolved during initial 043 identity clarification. This count does not include 024's lost damage obligations, because its failing interpretation never registers them. It must not be presented as full answer completeness.

### Residual stability finding

The earlier live review attempt passed all 12 cases / 15 turns. In the final frozen attempt, 024's damage follow-up produced empty semantic policy intents. The model emitted an inappropriate resolution acknowledgement; the photo/intake question was rejected with `task_ambiguity_required`, and completeness did not register/recover photo, packaging or assessment obligations.

The identical captured model output, TurnIR, CaseState and evidence from every final replay turn were passed through both the original pre-review response boundary at `44c99fef567d0b79e01b8d660286317b35818b0f` and this revised boundary. All 15 outputs match exactly, including the failing 024 follow-up. This is an existing interpreter/continuity instability rather than a new boundary regression. No R2/R3 repair was attempted. The live preservation cohort is not fully green, and this limitation must remain visible before deployment.

No new unsupported material claims, false action proceeds, product/tenant leakage or generic fallback were found in the inspected final outputs. The 024 incorrect acknowledgement and omissions are explicitly recorded as a failure. No Shopify mutations, outbound sends or PROD access/writes occurred. Knowledge, fixtures and the sealed oracle are untouched; 82 protected baseline/rerun files have unchanged hashes. Private outputs, traces, failed checks and boundary comparison are retained under `.artifacts/correctness-r1-review/`.

The three review defects are ready for re-review. This PR remains unmerged and undeployed. Multi-product requests can require additional sequential reads, bounded at six per subject; unavailable merchant facts remain unavailable. A deployed DEV smoke is still required after an explicitly authorized merge/deployment.
