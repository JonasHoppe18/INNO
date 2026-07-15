# Landing Page Redesign — Design Spec

**Dato:** 2026-07-15
**Status:** Til review
**Ejer:** Jonas

## 1. Formål og mål

Redesign af `apps/web/app/page.jsx` (sona.ai forsiden) fra generisk TailArk-dark-template til en poleret, produkt-forrest landing page der skal tiltrække nye webshop-kunder globalt.

- **Primær konvertering:** "Book a demo" (Cal.com-embed)
- **Sekundær konvertering:** "Get early access" (eksisterende `/api/landing-signups` email-form)
- **Senere:** self-serve signup (strukturen skal ikke blokere for det)
- **Målgruppe:** Webshop-ejere/support-ansvarlige i hele verden — IKKE kun Shopify. Copy må ikke være Shopify-specifik; Shopify nævnes kun som én integration blandt flere.
- **Social proof-status:** Ingen kundetal endnu (første kunde i test-mode). Siden sælger på produktdemo + human-in-the-loop-tillid. Der reserveres struktur til testimonial/metrics når AceZone-tal findes (~1 md. drift).

## 2. Designretning (besluttet via Mobbin-research + mockup-iterationer)

**Valgt retning: "D1 — ren typografisk, lys."**

- Hvid baggrund, centreret fuld-bredde hero, stor skarp typografi (font-weight 700-800, tight letter-spacing)
- Én brandfarve: **indigo → violet gradient** (`#4f46e5` → `#9333ea`). Farven lever i ét gradient-ord i overskriften, CTA-knapper og små accenter — ikke som fladefarve
- **Ingen emojis nogen steder.** Alle ikoner er SVG-linjeikoner (lucide-stil, indigo stroke)
- Blød indigo "glød" (radial gradient) bag produkt-mockup'et — farven som lys, ikke flade
- Final CTA-sektionen er mørk (#0a0a0a) som kontrast-afslutning
- Referencer: Mercury/Mixpanel (centreret hero + produkt-UI der flyder ind nedefra), Lightfield (elegance), QuickBooks ("Automation where it counts. Human when it matters" — budskabsparallel)

**Kernebudskab:** "Support that answers itself. You approve every reply." — AI'en gør arbejdet, mennesket har kontrollen. Human-in-the-loop er det bærende tillidskort.

## 3. Hero-visual: DemoInbox (rigtige komponenter, demo-data)

Hero'ens produktvisual er IKKE et screenshot eller en håndbygget efterligning. Det er en **`DemoInbox`-komposition der renderer de faktiske inbox-komponenter** (samme kode som `/inbox`) med hardcodede demo-props:

- **Komponenter:** ikon-rail (app-sidebar collapsed), TicketList-udsnit, ticket-tabs, toolbar (T-nummer, "Needs attention", tags, "View actions"), MessageBubble-tråd, ActionCard, composer
- **Demo-scenarie:** Sofia Rossi, "Item arrived damaged" (T-40318) — krakeleret vase med foto-vedhæftninger → Sona verificerer ordre + politik → draft med empati og konkret løsning → ActionCard "Approve refund (€89.00)". Sekundære tickets i listen: "Where is my order?" (draft ready), "Wrong size — can I exchange?" (draft ready), "Change delivery address" (sent)
- **Teknik:** wrapped i browser-chrome-ramme (app.sona.ai URL-bar), `pointer-events: none`, `aria-hidden`, skaleret ned via transform. Al data er fiktiv — ingen kundedata må optræde
- **Fordel:** matcher produktet pr. definition (samme kode og design tokens), opdaterer sig med produktet, knivskarp i alle opløsninger
- **Risiko/afbødning:** inbox-komponenterne kan have data-hooks der fetcher. DemoInbox skal bruge rene presentational varianter/props — hvis en komponent er for sammenfiltret med data-laget, laves en tynd demo-wrapper der genbruger dens markup/klasser frem for at forke styling

## 4. Sidestruktur (top → bund)

1. **Nav** — logo, Product / How it works / Pricing (anchor-links), sprogskifter (EN/DA), Log in, "Book a demo"-knap
2. **Hero** — badge "AI support for e-commerce", H1 med gradient-linje, subcopy, CTA-par (Book a demo → Cal.com-sektion/modal; Get early access → email-form), trust-ribbon med tre SVG-check-punkter: "Works with any webshop" / "Keep your existing inbox" / "Nothing sent without approval"
3. **DemoInbox** — flyder ind under hero med glød (se §3)
4. *(Reserveret: metrics-strip + testimonial — skjult/udkommenteret indtil AceZone-tal findes)*
5. **How it works** — 3 nummererede kort: Connect your shop → Teach Sona your shop (politikker, FAQ, gamle tickets) → Approve, then automate
6. **Feature deep-dive A: "Sona knows your shop"** — knowledge-systemet; hvert svar citerer sin kilde. Visual: knowledge/kilde-panel-udsnit (DemoInbox-princip)
7. **Feature deep-dive B: "From answer to action"** — refunds, ombytninger, adresseændringer, annulleringer udført i butikken efter godkendelse. Visual: ActionCard-udsnit
8. **Feature deep-dive C: "Autopilot, one ticket type at a time"** — automation-grader pr. ticket-type + kvalitetsmåling. Visual: automation-toggles + mini-graf (uredigerede drafts %)
9. **"Every language, your voice"** — samme draft på 3 sprog side om side (fx dansk/tysk/italiensk)
10. **"You're in control"** — human-in-the-loop-sektion: suggest → auto-send pr. type → auto-close, med toggle-panel-visual; "see exactly why Sona answered the way it did"
11. **Pricing** — 3 tiers (se §5)
12. **Integrationer** — tekst-logoer: Shopify, WooCommerce, Magento, Zendesk, Gmail, Outlook (+ "more soon"). Ligeværdige — ingen Shopify-fremhævelse
13. **FAQ** — 5-6 accordion-punkter der adresserer reelle indvendinger: "Will my customers know it's AI?", "What happens when Sona doesn't know the answer?", "Do I have to switch helpdesk?", "How long does setup take?", "What about GDPR/data?", "What counts as a ticket?"
14. **Final CTA (mørk)** — "Ready to take support off your plate?" + Book a demo / Get early access + footer (Privacy, Terms, kontakt, sprogskifter)

Deep-dives (6-8) skifter venstre/højre-layout. Alle sektioner har anchor-id'er til nav-links.

## 5. Pricing

4 tiers, månedspris, valuta følger sprog (DKK på /da, EUR på /en). Growth fremhæves som "Most popular". Alle tiers: ubegrænsede brugere (differentiering — helpdesks tager pr. sæde), alle features, ingen binding (løbende måned). Overage: kontakt/opgradér.

Prisniveau er bevidst under konkurrenterne (Gorgias+AI ~2.500-2.800 kr og Intercom Fin ~3.500 kr ved 500 tickets) men ikke discount — hæves evt. når AceZone-tal kan bevise værdien.

| Tier | Tickets/md | DKK | EUR |
|------|-----------|-----|-----|
| Mini | op til 150 | 699 kr | €99 |
| Starter | op til 500 | 1.999 kr | €269 |
| Growth (Most popular) | op til 2.000 | 3.999 kr | €549 |
| Scale | op til 5.000 | 6.999 kr | €949 |

- Enterprise/5.000+: "Talk to us"-linje under grid'et
- CTA pr. tier: "Book a demo" (indtil self-serve findes)
- EUR-tal er vejledende afrundinger — Jonas bekræfter endeligt niveau inden launch
- Note under pricing: "Every plan starts with a guided pilot" (matcher manuel onboarding)

## 6. Sprog / i18n

- **next-intl** med locale-routing: `/en` (default) og `/da`
- Landing-siden flyttes til `app/[locale]/page.jsx`-struktur; dashboardet (auth'et del) forbliver uberørt engelsk — i18n-scope er KUN marketing-siden
- Sprogskifter i nav + footer; `hreflang`/metadata pr. locale for SEO
- Al copy i messages-filer (`messages/en.json`, `messages/da.json`) — ingen hardcodede strenge i komponenter
- Demo-data i DemoInbox forbliver engelsk på begge locales (det er produktet, ikke marketing-copy) — undtagen "Every language"-sektionen der netop viser sprog

## 7. Demo-booking

- **Cal.com-embed** (inline-sektion eller modal ved klik på "Book a demo" — implementeringsvalg), 20-min "Sona demo"-event
- Jonas opretter Cal.com-event; link/embed-ID konfigureres via env var (`NEXT_PUBLIC_CAL_LINK`)
- Fallback hvis embed fejler: almindeligt link til Cal.com-siden
- "Get early access" genbruger eksisterende `/api/landing-signups` med kilde-tag pr. sektion (hero/footer)

## 8. Teknisk implementering

- **Placering:** `apps/web/app/[locale]/page.jsx` + nye sektionskomponenter i `components/landing/` (hero, demo-inbox, how-it-works, feature-dives, languages, control, pricing, integrations, faq, final-cta, nav, footer)
- **Oprydning:** de gamle TailArk-komponenter (`hero-section.jsx`, `integrations-4.jsx`, `faqs-2.jsx`, `content-three.jsx`, `trust-logos.jsx`, `features-grid.jsx`, `pricing.jsx`, `final-cta.jsx`, `footer-four.jsx`, `processing-demo.jsx`) slettes når den nye side er live
- **Styling:** Tailwind, lys tema (den nye side bruger IKKE `dark`-klassen). Design tokens: indigo-600/violet-600 gradient, zinc-grays
- **Animation:** diskret — fade-in-on-scroll på sektioner (IntersectionObserver/`AnimatedGroup`), evt. senere "draften skriver sig selv" i DemoInbox (fase 2, ikke MVP)
- **Performance:** DemoInbox er statisk (ingen fetches), billeder/ikoner inline SVG, mål: god LCP på hero-tekst
- **Responsivt:** DemoInbox skalerer ned/beskæres på mobil (vis ticket-detail-kolonnen, skjul ikon-rail/liste ved < md)

## 9. Testing og verifikation

- Unit: pricing-valutavisning pr. locale; i18n-nøgler komplette for begge sprog (test der fejler ved manglende nøgler)
- Visuel verifikation: siden gennemses på desktop/tablet/mobil i begge locales før deploy
- `/api/landing-signups`-flowet regressions-testes (hero + footer-form)
- Lighthouse-tjek (performance + SEO + a11y) som del af verifikation
- Deploy følger droplet-flowet (git pull + npm build + pm2 restart sona-web)

## 10. Udenfor scope

- Self-serve signup-flow
- Testimonials/metrics (struktur reserveret, indhold afventer AceZone-data)
- Blog/ressource-sider, separat pricing-side
- Dashboard-i18n
- Animeret draft-typing i DemoInbox (fase 2)

## 11. Åbne punkter

- Jonas: opret Cal.com-konto/event og bekræft endelige EUR-priser
- Domæne/brand: siden antager "sona.ai"-branding som i dag ("hello@sona.ai" er placeholder — bekræft kontakt-email)
