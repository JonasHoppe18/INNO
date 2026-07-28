# Fixture-ordrer — action-testrunden 2026-07-28

Butik: `test-app-store-ai-mailer.myshopify.com`. Alle testordrer er tagget `sona-test`.

| # | Ordre | Shopify-ID | Kundemail | Finansiel | Fulfillment | Varer | Bruges til |
|---|---|---|---|---|---|---|---|
| O1 | `#1053` | `17591638753629` | jonashoppe8@hotmail.com | PAID | UNFULFILLED | 1× Hybrid Dyne, 1199 DKK | address_change happy path |
| O2 | `#1054` | `17591640949085` | jonashoppe8@hotmail.com | PAID | FULFILLED | 1× Chaos Headset 4, 1599 DKK | tracking, return, **cancel skal nægtes** |
| O3 | `#1055` | `17591640981853` | jonashoppe8@hotmail.com | PAID | PARTIALLY_FULFILLED | Headset 4 ×1 (sendt), Mic 6 ×2, Cable 10 ×1 — 2646 DKK | edit_line_items, hold, delvis return |
| O4 | `#1056` | `17591641014621` | jonashoppe8@hotmail.com | **PENDING** | UNFULFILLED | 1× Chaos Mouse 11, 299 DKK | cancel på ubetalt ordre |
| O5 | `#1057` | `17591641080157` | jonashoppe8@hotmail.com | PAID | UNFULFILLED | 1× Chaos Power Adapter 8, 399 DKK | cancel happy path → derefter allerede-annulleret |
| O6 | `#1051` | `17017649037661` | `Jonashoppe8@hotmail.com` | PAID | FULFILLED | 1× Hybrid Dyne, 1199 DKK | **return uden for 30 dage** (fra 5. marts) |
| O7 | `#1058` | `17591641145693` | anden.kunde@example.com | PAID | UNFULFILLED | 1× Chaos Mic 12, 399 DKK | **identitets-guard** |

Leveringsadresse på O1–O5: Nørregade 12, 1165 København K, DK.
O6: Vesterbrogade 96, 1620 København V. O7: Vestergade 5, 8000 Aarhus C (Mette Andersen).
O2 tracking: PostNord `00370729273489012345`. O6 tracking: GLS `043147918722`.

## Afvigelser fra det oprindelige design

**O5 forud-annulleres ikke.** Shopify-MCP'ens sikkerhedspolitik blokerer `orderCancel` som
finansiel operation. I stedet lader vi Sona annullere O5 i Fase B (cancel happy path) og
genbruger derefter den annullerede ordre som fixture til "annullér en allerede annulleret
ordre" i Fase C. Bedre end det oprindelige design: annulleringen udføres af det system vi tester.

**O6 er en eksisterende marts-ordre, ikke en backdateret ny.** `orderCreate` med `processedAt`
kræver `write_orders` og et offline token, som MCP-tokenet ikke har. Draft-order-vejen kan ikke
backdate. De 52 gamle ordrer var ubrugelige som friske fixtures, men er ideelle netop her.

**O6's kundemail er `Jonashoppe8@hotmail.com` med stort J.** Utilsigtet, men bevar det — det
tester om order-matching er case-insensitiv på e-mail.
