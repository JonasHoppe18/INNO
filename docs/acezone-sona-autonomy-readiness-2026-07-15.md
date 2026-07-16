# ACEZONE × Sona — autonomy readiness

**Date:** 2026-07-15
**Status:** Local hardening and audit complete; not deployed. ACEZONE auto-send remains disabled.

## Executive conclusion

Sona is not one prompt away from replacing an ACEZONE support employee. The main remaining gap is not friendliness. It is the system around the answer: trustworthy evaluation, explicit business policy, reproducible technical procedures, live facts, approved actions, and outcome feedback.

Tone is currently the strongest part of the stack. The latest committed golden run scored tone at 4.32/5, but only 6.62/10 overall and 16% send-ready. That run is not a release baseline because its cohort, labels and leakage controls were not yet stable.

A new leak-free diagnostic against the newest historical Zendesk tickets found six usable customer/agent pairs. Three had to be excluded from the headline because the historical answer depended on a missing live identifier, temporary repair staffing, or an action already performed in the past. Of the three comparable cases, none was send-ready; the median was 5/10. The concrete gaps were:

1. no authoritative decision for promotion/discount-after-purchase versus return and reorder;
2. incomplete use of the opened-product refund-deduction policy;
3. missing canonical A-Spire troubleshooting knowledge, causing the wrong procedure to be retrieved.

The three-case headline is diagnostic evidence, not a production KPI. It is too small and not stratified.

## Evidence snapshot

### Historical and production data

- Approximately 3,947 historical `ticket_examples` are present for ACEZONE.
- 3,713 originated from the old Zendesk import and currently lack reliable preceding conversation context.
- Historical import paired the first customer message with the first agent reply. Multi-turn tickets therefore often stored the wrong answer as the target.
- Only a small minority of historical examples carry intent, language or conversation-context labels.
- Historical `csat_score` is an edit-similarity proxy, not customer satisfaction.
- Cross-provider duplicates and source-ticket self-retrieval made prior evaluations optimistic.
- Production contains 2,552 generated drafts and 181 sent drafts in the audited snapshot.
- Of 178 older labeled outcomes: 66 were sent without edit, 12 had a minor edit and 100 had a major edit.
- The newer readiness dataset contains 40 classified sends, but 27 cannot be attributed to an exact runtime intent. No intent is ready for autonomous sending.

### Observed ACEZONE reply style

Across all 3,713 redacted Zendesk replies:

- median length is 75 words and five sentences; the middle 50% is 44–136 words;
- 70.6% contain a thanks, 18.4% an apology and 65.0% explicit next-step language;
- 33.0% contain an emoji/symbol, 38.3% an exclamation mark and 36.2% a question;
- 87.0% contain a recognizable sign-off near the end.

These numbers are descriptive, not a prompt specification. The importer collapsed every reply to one line, so paragraph style cannot be recovered from this table. PII redaction deliberately normalized customer names into neutral greetings, making the observed 68.2% `Hi there` rate synthetic. Responder identity is absent, 191 rows belong to exact duplicate groups, approximately 240 rows look B2B/internal, only 75 rows have an intent label and none has a language label.

The writer should therefore target the robust traits — concise, warm, one relevant acknowledgment, clear ownership and a concrete next step — rather than mimic every corpus frequency. Signatures remain automatic. Emoji should be optional and situation-appropriate, not forced. A reviewed subset of recent true employee replies is needed before creating a stricter ACEZONE voice scorecard.

### Current evaluation limitations

- The active DB gold set has 26 cases, but only 16 are `READY_FULL`; 10 are partial.
- It contains no action ground truth, no real order context and no thread history.
- Several expected intent labels cannot be emitted by the runtime planner and must not count as deterministic failures until the taxonomy is expanded.
- All existing retrieval labels were proposed rather than explicitly human-approved, so they are not valid gold truth yet.
- Historic live-order and completed-action replies cannot be compared directly with a model run against today's state.

## What was hardened locally

### Historical-data integrity

- Zendesk examples now anchor on the final eligible public agent reply, the customer turn immediately before it, and only earlier conversation context.
- Conversation context is redacted before storage.
- New imports preserve authored paragraphs and no longer discard short human confirmations merely because they are short.
- A controlled re-import now refreshes rows in place by stable Zendesk ticket ID and reports new versus refreshed rows separately. Pair-specific labels are preserved only when the exact customer/agent comment anchor is unchanged; legacy or changed anchors are reset for review.
- Legacy Zendesk rows are excluded from few-shot retrieval until they have passed the corrected anchor, PII-redaction and embedding pipeline and carry `final_agent_anchor_v1`; filtered or failed legacy rows therefore cannot keep influencing replies.
- Zendesk authors are resolved from authoritative user roles, so collaborators/CC end users cannot be mistaken for agents. System-flagged automation is removed. An unresolved public author now excludes the entire ticket rather than silently bridging two turns.
- Eligible threads are paginated in chronological order before anchoring. Work is capped at three pages/300 comments per ticket; larger threads receive an explicit durable skip reason instead of being partially anchored or repeatedly timing out.
- LLM redaction is followed by deterministic residual-PII checks for emails, phone numbers, labeled identifiers, names and address-like lines. Any remaining match quarantines the pair instead of storing or embedding it.
- The corrected importer uses its own job provider and cannot be claimed by the disabled legacy history worker.
- A PII-free per-job ticket ledger makes counters and cursor retries idempotent; tickets with a durable outcome are skipped before repeat API/redaction/embedding work, and a successful row upsert cannot be double-counted after a timeout or lease reset.
- Service-role import operations now require an explicit workspace/user scope. Multi-shop workspaces must identify the target shop (or continue an already scoped job), so a corpus cannot fall into an arbitrary shop.
- Ticket export fails closed on malformed pagination, and Zendesk fetches accept only HTTPS `*.zendesk.com` hosts or an exact server-side custom-host allowlist; redirects are refused.
- Imported eval cases retain their external ticket ID so the source ticket can be excluded from retrieval.
- Exact and near-exact cross-provider copies of the evaluated question are excluded in eval mode.
- Historical replies are style examples only. They cannot ground current facts, policy, availability, pricing, dates, order state or promised outcomes.
- Synthetic greetings, sign-offs and `[Agent]` placeholders are removed before an historical style body enters the writer prompt.
- Unsent composer drafts are removed from case-state and writer history.

### Evaluation integrity

- Golden datasets, selected cohorts and judge definitions are versioned and hashed.
- Baseline deltas are shown only for an identical dataset, cohort and judge.
- Filtered, incomplete, failed, leaked or gate-failing runs cannot be accepted as a baseline.
- Explicitly excluded and unreviewed cases are not scored as truth.
- Non-comparable completed actions and unreproducible live facts are reported separately from the headline.
- Retrieval traces now expose selected example IDs and exclusion reasons so leakage fails visibly.

### Runtime safety and answer quality

- Verifier errors and blocks now fail closed.
- Low verifier confidence cannot auto-route.
- Auto routing requires both high confidence and an explicit per-intent allowlist.
- Strong-model retries cannot bypass language, evidence, action, compatibility or support-voice guards.
- Historical examples no longer count as factual grounding.
- Delivered-but-not-received cleanup stays in the resolved customer language.
- False repair-flow detection from arbitrary contact fields is removed.
- Unsent draft text can no longer contaminate intent or facts.
- Danish replacement-address extraction and Scandinavian email-thread parsing were repaired.

### Autonomy gate

An intent is locally eligible only when the preceding 90 days contain:

- at least 100 human-classified sends for that exact intent;
- at least 98% sent without edit;
- a 95% Wilson lower bound of at least 95%;
- zero major edits.

Model self-confidence and unscoped agent logs do not count as evidence. ACEZONE currently meets this gate for zero intents.

## The remaining product gaps

### 1. One runtime taxonomy

The inbox classifier and draft planner currently use different taxonomies. The draft planner flattens important cases into broad `complaint`, `update` and `other` buckets. At minimum it needs distinct handling for:

- technical support versus physical damage/warranty;
- wrong item, missing item and delivered-but-not-received;
- refund status versus a request to issue a refund;
- return-policy question versus initiating a return;
- invoice/payment;
- checkout issue;
- partnership/B2B;
- multiple simultaneous intents.

`other` and broad `update` must never be enabled as intent-wide auto-send categories.

### 2. ACEZONE's authoritative decision book

Historic replies reveal what an employee once decided, but do not establish current policy. ACEZONE must approve a compact decision table for at least:

1. normal-use cracks and other borderline warranty damage;
2. lost dongles/receivers: availability, price and fulfilment flow;
3. delivered-but-missing parcels and incorrect delivery photos;
4. discounts, streamer codes, price matching and post-purchase goodwill;
5. invoice/receipt resend ownership and source of truth;
6. third-party purchases, return eligibility and warranty routing;
7. opened-product deductions and what detail may be promised before inspection;
8. repair intake, expected turnaround and temporary staff availability;
9. the monetary/operational authority Sona may exercise without approval.

Each decision needs an owner, effective date, review date, supported countries/products and a machine-readable outcome. Free-form historic answers are not sufficient.

The evidence, contradictions and exact owner choices are prepared in [the ACEZONE policy decision workshop](./acezone-policy-decision-workshop-2026-07-15.md).

### 3. Canonical technical procedures

The recent bad-audio case retrieved a microphone-specific article and produced an unsupported driver procedure. ACEZONE needs product- and symptom-scoped canonical guides with exact values and explicit applicability, starting with:

- A-Spire Wireless bad audio through cable and dongle;
- dongle re-pairing;
- factory reset;
- firmware update;
- microphone failure versus general audio-quality failure;
- physical damage and evidence intake.

Every guide needs a version/effective date and a regression fixture. A historical agent reply can be proposed as source material, but an ACEZONE owner must approve it before it becomes factual knowledge.

### 4. The operational middle

Sona can read orders and tracking well, but several central actions remain disabled or manual:

- return, refund and exchange proposals are disabled in the generator;
- invoice handling is classified as `other`, and its current deterministic action branch is unreachable;
- ACEZONE's spare-parts `office` flow depends on a disabled note action;
- address changes and cancellations become pending actions requiring approval;
- `auto_send_intents` changes a routing hint only; there is no autonomous email transport.

Before real auto-send, Sona needs an idempotent orchestrator that executes approved actions first, generates the final post-action answer, sends once, retries safely, audits every step, respects a global kill switch and leaves ambiguous/tool-error cases for a human.

### 5. Outcome telemetry

Future sent events now carry the exact generated intent, but old data cannot be repaired reliably. The next shadow period must capture:

- generated intent and secondary intents;
- exact facts and knowledge versions used;
- proposed/executed action IDs;
- verifier/gate outcome;
- sent without edit, minor edit, major edit or rejected;
- edit reason and failure taxonomy;
- reopen, repeat contact and refund/return outcome where applicable.

Raw message bodies should not be copied into telemetry.

### 6. Attachments and multilingual coverage

Only a small image subset is currently visually interpreted. HEIC, PDF and video are largely metadata, and deterministic safety checks are strongest in Danish and English. Unsupported evidence, languages and attachment types must remain fail-closed until their own test sets pass.

## Required benchmark before autonomy

Build a frozen, leakage-free ACEZONE set with temporal separation from the few-shot pool:

- 400–500 representative customer cases, stratified by real intent frequency;
- at least 100 high-risk action/live-fact cases;
- real multi-turn context, attachments and deterministic Shopify/tracking fixtures;
- separate buckets for content-only, live-fact, action-required and non-comparable history;
- primary and secondary intent, resolution stage, required facts, allowed claims, prohibited claims and expected action;
- two-person human review for every gold label;
- a stable judge rubric plus deterministic safety gates;
- no evaluated ticket or semantic duplicate in the retrieval pool.

Track at least:

- send-ready rate and no-edit rate by exact intent;
- critical factual/action error rate;
- language and tone;
- intent and resolution-stage accuracy;
- retrieval recall/precision on human-approved labels;
- action correctness and idempotency;
- calibration of verifier confidence;
- tool-error abstention and escalation precision.

“10/10” should mean send-ready as-is with zero unsupported factual or action claims. It should not mean a high average that hides catastrophic failures.

## Rollout sequence

1. **Deploy the local safety/eval fixes and migration.** Keep auto-send empty.
2. **Controlled Zendesk re-import/backfill.** Refresh the 3,713 legacy rows in place by stable ticket ID; review the durable inserted/refreshed/skipped/dropped ledger and a stratified spot-check sample before considering the corpus rebuilt.
3. **ACEZONE policy workshop.** Resolve the nine decision areas above and publish canonical versioned knowledge.
4. **Shadow mode.** Run every real ticket through Sona, capture exact human outcomes and review every major edit.
5. **Human-approved actions.** Pilot address changes and cancellations with exact-order matching and explicit approval.
6. **Narrow reply canaries.** Consider only clean acknowledgements, exact-order carrier-verified tracking and product questions backed by current structured facts.
7. **Per-intent autonomy.** Unlock one intent at a time only when the statistical gate and deterministic safety suite pass.

Return, refund, exchange, warranty, missing/wrong item, delivered-but-not-received, fraud/legal, multi-intent, unsupported attachments and every mutation stay review-only until their own evidence is sufficient.

## Production-change boundary

This audit made no production writes, did not deploy functions or migrations, did not re-import Zendesk, and did not enable auto-send. Those actions require an explicit release decision because they change ACEZONE's live data and customer-service behavior.
