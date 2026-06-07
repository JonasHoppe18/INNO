# AceZone — Return/Refund knowledge review

**Status:** Proposal for AceZone review. Two factual corrections have since been applied live (see Update below); no retrieval-shaping / consolidation changes were made.
**Date:** 2026-06-06 (original) · **Updated:** 2026-06-07
**Scope:** Return/refund retrieval flow only. A-Rise repair flow is explicitly out of scope and untouched.

---

## Update 2026-06-07 — applied live factual corrections

Two **factual-only** corrections were applied to live `agent_knowledge` after this review. They are purely content/factual fixes — no canonical injection, no archiving, no scoring/matcher/metadata retrieval-shaping. Open questions §4.1 and §4.2 are now resolved as follows:

| chunk | type | before | after | embedding |
|-------|------|--------|-------|-----------|
| **3192** | shopify policy | "we will thus **deduct EUR 50** from the total…" | "we will thus apply an **individual deduction based on the product's reduced value, assessed case by case** (no fixed amount is promised in advance)…" — matches the live Shopify *Warranty and Returns policy* page, which contains no EUR 50 | **re-embedded** (3192 is in the retrieval pool) |
| **3651** | saved_reply | return address **AceZone ApS, Nordre Fasanvej 113, 2nd floor, 2000 Frederiksberg** | return address **AceZone International ApS, Øster Allé 56, 5th floor, 2100 København Ø, Denmark** | unchanged (saved_reply is excluded from retrieval) |

Notes:
- A read-only audit (2026-06-07) showed the live pipeline already answers the return cases (g-033) send-ready from the authoritative Shopify policy chunks **3184/3185/3188/3190/3192** — the correct Øster Allé return address is delivered by chunk **3188**, not by the 3651 saved_reply. The eval gold for g-033/g-047 was remapped to these authoritative chunks accordingly.
- §4.1 (deduction): resolved — **case-by-case assessment**, not a flat EUR 50. The live Shopify source page already reflects this; 3192 was stale and is now aligned. A future re-sync of that page is safe and will not reintroduce EUR 50.
- §4.2 (return address / legal entity): resolved — the current return address is **AceZone International ApS, Øster Allé 56**. The A-Rise *repair* entry (3657) was left untouched.
- Still **not** done (deliberately): no canonical return entry created, 3913 not archived, 3919 not updated, 3054/3899/3657 untouched. The §3 consolidation proposal remains a proposal pending AceZone confirmation of §4.3 / §4.4.

---

## 1. The problem in plain language

When a customer asks "how do I return my headset / can I get a refund", the AI assistant
should retrieve AceZone's return policy and answer with the return window, the deduction
rule, and the return address + steps. Today it does this unreliably.

The root cause is **duplicated return knowledge**, not the AI scoring logic (we already
tested and rolled back two scoring/penalty experiments). AceZone currently has several
overlapping return entries that compete with each other:

- Two near-identical short "return procedure" entries that say almost the same thing.
- One longer, more complete "saved reply" that actually contains the return address and
  step-by-step instructions — but it rarely gets surfaced.
- Two policy pages (warranty/returns + statutory cancellation) that add detail.

Because the two short procedures are near-duplicates, the system collapses them to one and
neither ranks high enough to be reliably picked. Meanwhile the most complete entry (the
saved reply with the address) is not being surfaced at all.

**Net effect:** return questions sometimes get a generic or incomplete answer instead of
the full, correct return procedure.

---

## 2. Existing overlap

| id | type | products tag | window | deduction | return address | numbered steps | 3rd-party rule |
|----|------|--------------|--------|-----------|----------------|----------------|----------------|
| **3919** | procedure | `a-spire` | 30-day | diminished-value (assessed) | ❌ | ❌ | ✅ |
| **3913** | procedure | `headset` | 30-day | diminished-value (assessed) | ❌ | ❌ | ✅ |
| **3651** | saved_reply | (none) | 30-day | diminished-value (assessed) | ✅ Nordre Fasanvej 113 | ✅ (3 steps) | ❌ |
| **3192** | policy | (none) | — | **EUR 50 flat** | ❌ | ❌ | ❌ |
| **3054** | policy | (none) | 14-day statutory withdrawal | — | ❌ | ❌ | ❌ |

Relationship summary:
- **3913 ↔ 3919: near-duplicate** (Jaccard 0.670). 3919 is the more complete of the two
  (it adds the inspection step + the "refund within 14 days of receiving" timing). 3913
  only adds a "terms are on our website" preamble.
- **3651** is **supplementary and the most complete** single answer (only one with the
  address + numbered steps), but is missing the third-party-retailer rule.
- **3192 / 3054** are **supplementary policy detail** (deduction amount; statutory
  cancellation right).
- No two of these are *contradictory in intent*, but there are **factual conflicts** that
  only AceZone can resolve (see §4).

The A-Rise repair entries (product-specific repair flow, different address) are a separate,
correct specialisation and are **not part of this overlap** — leave them untouched.

---

## 3. Proposed canonical return guide

This is a **draft for AceZone to confirm**, assembled from 3651 (most complete) + the
third-party rule from 3913/3919 + the deduction/statutory detail from 3192/3054. Conflicts
are marked `⚠️ NEEDS ACEZONE DECISION` and are **not** guessed.

> **Returning a product (general)**
>
> We accept returns within our **30-day return period**, even if the product has been
> opened and briefly tested.
>
> Because an opened/worn headset can no longer be sold as new, EU consumer protection law
> allows us to deduct an amount from your refund to reflect any diminished value (handling
> beyond what is needed to assess the product, plus cleaning/sanitation or replacement of
> skin/sweat-exposed parts such as earpads).
> `⚠️ NEEDS ACEZONE DECISION:` is the deduction a **flat EUR 50** (per policy 3192) or a
> **case-by-case assessment after inspection** (per 3651/3919)? These two entries currently
> say different things.
>
> Once we receive the returned item, we inspect its condition, calculate any applicable
> deduction, and tell you the details before issuing the refund. **The refund is issued
> within 14 days of us receiving the item, at the latest.**
>
> **Important:** We do **not** accept returns of products purchased from third-party
> retailers. Please make sure your order number is provided and present in our system.
>
> **How to return:**
> 1. Include all original packaging and components.
> 2. Book and print a return label (any courier that ships to our office), tape it to the
>    package, and send it to:
>    `⚠️ NEEDS ACEZONE DECISION (return address / legal entity):`
>    - Return policy entry (3651): **AceZone ApS**, Nordre Fasanvej 113, 2nd floor, 2000
>      Frederiksberg, Denmark — Att: AceZone, +45 31501800, support@acezone.io
>    - The A-Rise *repair* entry (3657) uses a **different** address (AceZone International
>      ApS, Øster Allé 56, 2100 København Ø). Confirm whether **returns and repairs go to
>      different addresses**, and which legal entity name is current.
> 3. Hand the package in at your local return access point.
>
> Once we receive and assess the product, we contact you about the refund amount and
> refund via your original payment method.

**Distinct numbers — keep separate, do not conflate:**
1. **30-day return window** (AceZone's own, more generous return policy).
2. **14-day statutory right of withdrawal** (legal minimum, entry 3054).
3. **Refund issued within 14 days of receiving the item** (processing time, entry 3651/3919).

These are three different "windows" and must not be merged into one number.

---

## 4. Open questions for AceZone

1. **Deduction:** flat **EUR 50** (3192) or **case-by-case assessment** (3651/3919)? Which
   is current?
2. **Return address & legal entity:** is the return address **AceZone ApS, Nordre Fasanvej
   113, Frederiksberg** (3651)? Is "AceZone ApS" or "AceZone International ApS" the current
   legal name? Do returns and A-Rise repairs use **different** addresses on purpose?
3. **Third-party rule placement:** confirm the "no returns from third-party retailers" rule
   should be part of the general return guide (3913/3919 carry it; 3651 does not).
4. **Statutory 14-day withdrawal vs 30-day return:** confirm the 30-day return is offered in
   *addition* to the legal 14-day right of withdrawal (so both should be mentioned).

---

## 5. Proposed knowledge actions (NOT yet applied)

| chunk | action | rationale |
|-------|--------|-----------|
| **3919** | **Keep — basis for canonical** | Most complete of the two procedures; correct return/refund issue tags. |
| **3913** | **Archive as duplicate (after merge)** | Near-duplicate of 3919 (Jaccard 0.670); adds nothing except a website-terms preamble; its `headset` tag is noise. |
| **3651** | **Requires AceZone decision** | Most complete answer + only one with address/steps. Either fold its address/steps into the canonical entry, or keep it as the canonical saved reply and trim the procedures. |
| **3192** | **Keep** | Supplementary policy (deduction amount + warranty); resolves open question §4.1. |
| **3054** | **Keep** | Supplementary statutory cancellation right; distinct from 30-day return. |
| **3899** | **Keep — untouched** | Product-specific A-Rise repair flow. Out of scope. |
| **3657** | **Keep — untouched** | Product-specific A-Rise repair saved reply (separate address). Out of scope. |

Recommended consolidation target: **one canonical return entry** (based on 3919 + 3651's
address/steps), 3913 archived, policies 3192/3054 retained as supplementary detail.

---

## 6. What stays untouched

- A-Rise repair flow (3899, 3657) — product-specific, correct, and required by an existing
  eval case. Do not touch.
- All AI runtime/scoring/matcher logic — production is stable on v210; scoring/penalty
  experiments were already tested and rolled back.
- No metadata or live knowledge edits until AceZone confirms §4.

---

## 7. Is it safe to send to AceZone?

**Yes** — this document contains only (a) factual descriptions of AceZone's own existing
entries, (b) a proposed canonical merge with every conflict explicitly flagged rather than
guessed, and (c) clearly-scoped open questions. It proposes no change AceZone hasn't
approved and reveals no internal system detail beyond what's needed to explain the overlap.
