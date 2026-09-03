# Knowledge architecture

Knowledge is kept behind one small store contract. A record carries its
tenant, class, authority, source identity, provenance, timestamps, optional
structured facts, and content. The first implementation supports deterministic
lexical retrieval; storage and ranking may evolve behind the contract.

## SOURCE AUTHORITY

Authority depends on the question:

For a policy/operations decision where all three are relevant:

`authoritative merchant policy` > `verified live operational result` > `historical support example`

For current order, shipment, or customer state, the live result is the fact;
for business rules, policy remains the authority. Historical examples are
always last and never silently become policy.

The live result does not override policy, and a historical ticket never becomes
policy merely because it was retrieved. A stale operational snapshot is not a
substitute for a live lookup.

| Class | Purpose | Authority | Freshness | Provenance, isolation, retrieval |
| --- | --- | --- | --- | --- |
| Merchant policy | Returns, refunds, shipping, warranty, eligibility | Authoritative | Re-publish when changed | Source ID/label/URI and published time; workspace-scoped search |
| Product knowledge | Product facts, compatibility, manuals, troubleshooting | Merchant reference | Update with catalogue/manual changes | Product/source identity and timestamps; workspace-scoped lexical search |
| Procedures | What information support must collect and what to do next | Operationally authoritative | Review when workflow changes | Named procedure source and version; workspace-scoped search |
| Brand guidance | Tone, terminology, language, response style | Guidance | Review when brand guidance changes | Named guide and publication time; workspace-scoped search |
| Historical cases | Examples of solved conversations and human replies | Evidence/example only | Historical; never “freshened” into policy | Case/source identity, anonymized where possible; workspace-scoped example search |
| Live operational information | Current order, fulfillment, shipment/tracking, customer state | Verified at lookup time | Fetch at response time | Provider, lookup target, observed time; read through tenant-safe tools |

Historical tickets are useful evidence, but the agent must not infer a rule
from them without authoritative policy or a verified operational result. Live
order/tracking/customer state normally comes from tools rather than embeddings.
