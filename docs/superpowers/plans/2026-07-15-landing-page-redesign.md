# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erstat TailArk-landing-siden med en lys, typografisk landing page (spec: `docs/superpowers/specs/2026-07-15-landing-page-redesign-design.md`) med EN/DA locale-routing, DemoInbox bygget af rigtige inbox-komponenter, 4-tier pricing og Cal.com demo-booking.

**Architecture:** Marketing-siden flyttes til `app/(marketing)/[locale]/page.jsx` med next-intl (locales `en`/`da`, `localePrefix: "always"`), komponeret ind i den eksisterende Clerk-middleware. Alle sektioner er server components i `components/landing/` der henter copy via `getTranslations`; interaktive øer (signup-form, Cal-embed) er client components. DemoInbox genbruger `MessageBubble` og `ActionCard` fra `components/inbox/` med statiske demo-props i en ikke-interaktiv browser-ramme.

**Tech Stack:** Next.js 14.2.5 (App Router), next-intl ^3, Tailwind, Clerk-middleware (eksisterende), @calcom/embed-react, vitest.

## Global Constraints

- **Ingen emojis nogen steder** — alle ikoner er inline SVG (indigo stroke `#4f46e5`)
- **Ingen Shopify-fremhævelse** — Shopify er én integration blandt flere; copy siger "your store"/"any webshop"
- Brandfarve: indigo→violet gradient `#4f46e5` → `#9333ea`; lys side (INGEN `dark`-klasse); final CTA-sektion mørk `#0a0a0a`
- Ingen kundedata i demo-indhold — kun fiktive navne (Sofia Rossi, Lucas Meyer, Emma Larsen, Noah Berg)
- Al marketing-copy i `messages/en.json` + `messages/da.json` — ingen hardcodede strenge i landing-komponenter (undtagen demo-data i DemoInbox, som bevidst er engelsk på begge locales)
- Dashboardet (`app/(dashboard)`, `/inbox` osv.) må IKKE påvirkes — i18n gælder kun marketing-routen
- Kør alle kommandoer fra `apps/web/`
- Commit efter hver task (repoet har urelaterede ændringer i working tree — brug altid eksplicitte `git add <paths>`, aldrig `git add -A`)

---

### Task 1: next-intl-fundament og locale-routing

**Files:**
- Modify: `apps/web/package.json` (dependency)
- Create: `apps/web/i18n/routing.js`
- Create: `apps/web/i18n/request.js`
- Modify: `apps/web/next.config.mjs`
- Modify: `apps/web/middleware.js`
- Create: `apps/web/messages/en.json` (skelet — fyldes i Task 2)
- Create: `apps/web/messages/da.json` (skelet)
- Create: `apps/web/app/(marketing)/[locale]/layout.jsx`
- Create: `apps/web/app/(marketing)/[locale]/page.jsx` (placeholder — sektioner tilføjes i Task 5-9)
- Delete: `apps/web/app/page.jsx`

**Interfaces:**
- Produces: URL'erne `/en` og `/da` (og `/` → redirect til `/en`); `routing` (locales `["en","da"]`, defaultLocale `"en"`); messages-namespace `landing.*`. Senere tasks tilføjer sektioner til `app/(marketing)/[locale]/page.jsx` og nøgler til `messages/*.json`.

- [ ] **Step 1: Installér next-intl**

Run: `cd apps/web && npm install next-intl@^3`

- [ ] **Step 2: Opret routing- og request-config**

`apps/web/i18n/routing.js`:
```js
import { defineRouting } from "next-intl/routing";

// Marketing-sidens locales. Dashboardet er ikke omfattet — se middleware.js.
export const routing = defineRouting({
  locales: ["en", "da"],
  defaultLocale: "en",
  localePrefix: "always",
});
```

`apps/web/i18n/request.js`:
```js
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!routing.locales.includes(locale)) locale = routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 3: Wrap next.config.mjs med next-intl-plugin**

Ændr `apps/web/next.config.mjs` (behold hele det eksisterende `nextConfig`-objekt uændret):
```js
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ...eksisterende indhold uændret (reactStrictMode, experimental, images)
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 4: Komponér intl-middleware ind i Clerk-middleware**

Erstat `apps/web/middleware.js` med:
```js
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const publicRoutes = [
  "/",
  "/en(.*)",
  "/da(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/landing-signups(.*)",
  "/api/outlook/webhook(.*)",
  "/api/webhooks/(.*)",
  "/api/admin/register-webhooks",
];
const isPublicRoute = createRouteMatcher(publicRoutes);
// Kun marketing-stier skal gennem next-intl (redirect / → /en, locale-detektion).
const isMarketingRoute = createRouteMatcher(["/", "/en(.*)", "/da(.*)"]);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }
  if (isMarketingRoute(request)) {
    return intlMiddleware(request);
  }
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 5: Opret marketing-layout, placeholder-side og messages-skeletter**

`apps/web/messages/en.json` (skelet):
```json
{ "landing": { "placeholder": "Sona — new landing page" } }
```
`apps/web/messages/da.json` (skelet):
```json
{ "landing": { "placeholder": "Sona — ny landing page" } }
```

`apps/web/app/(marketing)/[locale]/layout.jsx`:
```jsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Marketing-gruppen: leverer messages til client-øer. Root-layoutet ejer <html>.
export default async function MarketingLayout({ children, params: { locale } }) {
  unstable_setRequestLocale(locale);
  const messages = await getMessages();
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
```

`apps/web/app/(marketing)/[locale]/page.jsx`:
```jsx
import { getTranslations, unstable_setRequestLocale } from "next-intl/server";

export default async function LandingPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing");
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <p className="p-8">{t("placeholder")}</p>
    </main>
  );
}
```

Slet `apps/web/app/page.jsx` (den gamle side; selve TailArk-komponenterne slettes først i Task 10):
```bash
git rm apps/web/app/page.jsx
```

- [ ] **Step 6: Verificér routing og auth**

Run: `cd apps/web && npm run build`
Expected: build OK (ingen "Unable to find i18n config"-fejl).

Run: `npx next dev` og tjek i browser:
- `http://localhost:3000/` → redirecter til `/en`, viser placeholder-teksten
- `http://localhost:3000/da` → viser dansk placeholder
- `http://localhost:3000/inbox` → stadig redirect til sign-in når ikke logget ind (Clerk intakt)

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/i18n apps/web/messages apps/web/next.config.mjs apps/web/middleware.js "apps/web/app/(marketing)"
git commit -m "feat(landing): next-intl locale routing (/en, /da) composed into Clerk middleware"
```

---

### Task 2: Komplet copy i messages-filer + paritetstest

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/da.json`
- Test: `apps/web/lib/landing/__tests__/messages.test.js`

**Interfaces:**
- Produces: namespace `landing` med under-namespaces `nav`, `hero`, `how`, `dives`, `languages`, `control`, `pricing`, `integrations`, `faq`, `finalCta`, `footer`. Alle senere tasks refererer nøglerne præcis som defineret her.

- [ ] **Step 1: Skriv fejlende paritetstest**

`apps/web/lib/landing/__tests__/messages.test.js`:
```js
import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import da from "../../../messages/da.json";

function keyPaths(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keyPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

describe("landing messages", () => {
  it("en and da have identical key sets", () => {
    expect(keyPaths(da).sort()).toEqual(keyPaths(en).sort());
  });
  it("has all landing section namespaces", () => {
    for (const ns of ["nav", "hero", "how", "dives", "languages", "control", "pricing", "integrations", "faq", "finalCta", "footer"]) {
      expect(en.landing[ns], `missing landing.${ns}`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Kør testen — forvent FAIL**

Run: `cd apps/web && npx vitest run lib/landing/__tests__/messages.test.js`
Expected: FAIL ("missing landing.nav") — kun placeholder-nøglen findes.

- [ ] **Step 3: Skriv den fulde copy**

Erstat `apps/web/messages/en.json` med:
```json
{
  "landing": {
    "nav": {
      "product": "Product",
      "how": "How it works",
      "pricing": "Pricing",
      "login": "Log in",
      "bookDemo": "Book a demo"
    },
    "hero": {
      "badge": "AI support for e-commerce",
      "titleLine1": "Support that answers itself.",
      "titleLine2": "You approve every reply.",
      "subtitle": "Sona reads every customer email, looks up the order in your store, and drafts the right reply in your brand voice — ready for one-click approval.",
      "ctaDemo": "Book a demo",
      "ctaAccess": "Get early access",
      "emailPlaceholder": "Your email",
      "emailInvalid": "Please enter a valid email.",
      "emailError": "Something went wrong. Please try again.",
      "emailSuccess": "Thanks! We'll email you as soon as we open more spots.",
      "trust1": "Works with any webshop",
      "trust2": "Keep your existing inbox",
      "trust3": "Nothing sent without approval"
    },
    "how": {
      "kicker": "HOW IT WORKS",
      "title": "Live in three steps",
      "step1Title": "Connect your shop",
      "step1Body": "Link your webshop and support email. No migration — Sona works alongside what you already have.",
      "step2Title": "Teach Sona your shop",
      "step2Body": "Import your policies, FAQ and past tickets. Sona learns your products, rules and tone of voice.",
      "step3Title": "Approve, then automate",
      "step3Body": "Start by approving every draft. Put ticket types on autopilot as trust grows."
    },
    "dives": {
      "aKicker": "KNOWLEDGE",
      "aTitle": "Sona knows your shop",
      "aBody": "Import return policies, shipping rules, FAQs and past tickets. Every answer is grounded in your shop's own knowledge — and cites the source it's based on, so you can verify at a glance.",
      "aPoint1": "Answers cite the exact policy they rely on",
      "aPoint2": "Import from Zendesk, documents or your website",
      "aPoint3": "Sona asks instead of guessing when knowledge is missing",
      "bKicker": "ACTIONS",
      "bTitle": "From answer to action",
      "bBody": "Refunds, exchanges, address changes, cancellations — Sona prepares the action alongside the reply, and executes it in your store the moment you approve. Not promised in text. Done.",
      "bPoint1": "Refunds and exchanges executed in your store",
      "bPoint2": "Address changes caught before the parcel ships",
      "bPoint3": "Every action requires your explicit approval",
      "cKicker": "AUTOPILOT",
      "cTitle": "Autopilot, one ticket type at a time",
      "cBody": "Start with suggestions only. When Sona's drafts consistently go out unedited, put simple ticket types — like tracking questions — on autopilot, and keep approving the rest.",
      "cPoint1": "Automation per ticket type, never all-or-nothing",
      "cPoint2": "Quality measured on every draft you edit",
      "cPoint3": "Turn it off with one switch, any time"
    },
    "languages": {
      "kicker": "EVERY LANGUAGE",
      "title": "Every language, your voice",
      "body": "Your customers write in their language. Sona replies in it — same tone, same policies, no translation round-trips."
    },
    "control": {
      "kicker": "YOU'RE IN CONTROL",
      "title": "You decide how much Sona does",
      "body": "Start with suggestions only. Put simple ticket types on autopilot when you're ready — and see exactly why Sona answered the way it did, with sources for every claim.",
      "toggle1Title": "Suggest drafts",
      "toggle1Sub": "All incoming tickets",
      "toggle2Title": "Auto-send tracking replies",
      "toggle2Sub": "High confidence only",
      "toggle3Title": "Auto-close resolved threads",
      "toggle3Sub": "Off — you approve closures"
    },
    "pricing": {
      "kicker": "PRICING",
      "title": "Simple pricing that grows with you",
      "subtitle": "Every plan includes all features and unlimited users. No binding — month to month.",
      "perMonth": "/month",
      "ticketsLabel": "up to {count} tickets/month",
      "mostPopular": "Most popular",
      "cta": "Book a demo",
      "pilotNote": "Every plan starts with a guided pilot.",
      "enterprise": "More than 5,000 tickets a month? Talk to us.",
      "tierMini": "Mini",
      "tierStarter": "Starter",
      "tierGrowth": "Growth",
      "tierScale": "Scale",
      "feature1": "Unlimited users",
      "feature2": "All features included",
      "feature3": "No binding — cancel monthly"
    },
    "integrations": {
      "title": "Works with the tools you already use",
      "moreSoon": "more soon"
    },
    "faq": {
      "title": "Questions, answered",
      "q1": "Will my customers know it's AI?",
      "a1": "Replies go out from your own support address, in your tone of voice, and you approve them before they're sent. Whether you disclose AI involvement is your choice — Sona works either way.",
      "q2": "What happens when Sona doesn't know the answer?",
      "a2": "Sona flags the ticket for you instead of guessing. Unanswered questions become suggestions for your knowledge base, so coverage grows over time.",
      "q3": "Do I have to switch helpdesk?",
      "a3": "No. Sona works on top of your existing support email — you can keep your current setup and workflows.",
      "q4": "How long does setup take?",
      "a4": "Connecting your store and email takes minutes. Teaching Sona your policies is a guided step — most shops see their first quality drafts the same day.",
      "q5": "What about GDPR and my customers' data?",
      "a5": "Customer data is processed only to answer their tickets, stored in the EU, and never used to train models for other companies.",
      "q6": "What counts as a ticket?",
      "a6": "A customer conversation, however many emails it takes. Automated notifications and spam don't count."
    },
    "finalCta": {
      "title": "Ready to take support off your plate?",
      "subtitle": "Book a 20-minute demo — we'll show Sona answering tickets like yours.",
      "ctaDemo": "Book a demo",
      "ctaAccess": "Get early access"
    },
    "footer": {
      "privacy": "Privacy",
      "terms": "Terms",
      "contact": "hello@sona.ai"
    }
  }
}
```

Erstat `apps/web/messages/da.json` med:
```json
{
  "landing": {
    "nav": {
      "product": "Produkt",
      "how": "Sådan virker det",
      "pricing": "Priser",
      "login": "Log ind",
      "bookDemo": "Book en demo"
    },
    "hero": {
      "badge": "AI-support til e-commerce",
      "titleLine1": "Support der besvarer sig selv.",
      "titleLine2": "Du godkender hvert svar.",
      "subtitle": "Sona læser hver kundemail, slår ordren op i din butik og skriver det rigtige svar i din tone — klar til godkendelse med ét klik.",
      "ctaDemo": "Book en demo",
      "ctaAccess": "Få tidlig adgang",
      "emailPlaceholder": "Din email",
      "emailInvalid": "Indtast en gyldig email.",
      "emailError": "Noget gik galt. Prøv igen.",
      "emailSuccess": "Tak! Vi skriver til dig, så snart vi åbner flere pladser.",
      "trust1": "Virker med enhver webshop",
      "trust2": "Behold din nuværende indbakke",
      "trust3": "Intet sendes uden godkendelse"
    },
    "how": {
      "kicker": "SÅDAN VIRKER DET",
      "title": "Kørende på tre trin",
      "step1Title": "Forbind din butik",
      "step1Body": "Tilslut din webshop og support-email. Ingen migrering — Sona arbejder oven på det, du allerede har.",
      "step2Title": "Lær Sona din butik",
      "step2Body": "Importér politikker, FAQ og gamle tickets. Sona lærer dine produkter, regler og tone.",
      "step3Title": "Godkend, og automatisér så",
      "step3Body": "Start med at godkende hvert udkast. Sæt ticket-typer på autopilot i takt med at tilliden vokser."
    },
    "dives": {
      "aKicker": "VIDEN",
      "aTitle": "Sona kender din butik",
      "aBody": "Importér returpolitikker, fragtregler, FAQ og gamle tickets. Hvert svar er forankret i din butiks egen viden — og citerer kilden, det bygger på, så du kan verificere med ét blik.",
      "aPoint1": "Svar citerer præcis den politik, de bygger på",
      "aPoint2": "Importér fra Zendesk, dokumenter eller din hjemmeside",
      "aPoint3": "Sona spørger i stedet for at gætte, når viden mangler",
      "bKicker": "HANDLINGER",
      "bTitle": "Fra svar til handling",
      "bBody": "Refusioner, ombytninger, adresseændringer, annulleringer — Sona forbereder handlingen sammen med svaret og udfører den i din butik, i det øjeblik du godkender. Ikke lovet i teksten. Gjort.",
      "bPoint1": "Refusioner og ombytninger udført i din butik",
      "bPoint2": "Adresseændringer fanget før pakken afsendes",
      "bPoint3": "Hver handling kræver din eksplicitte godkendelse",
      "cKicker": "AUTOPILOT",
      "cTitle": "Autopilot — én ticket-type ad gangen",
      "cBody": "Start med forslag alene. Når Sonas udkast konsekvent sendes uredigerede, kan du sætte simple ticket-typer — som tracking-spørgsmål — på autopilot og fortsat godkende resten.",
      "cPoint1": "Automatisering pr. ticket-type, aldrig alt-eller-intet",
      "cPoint2": "Kvaliteten måles på hvert udkast, du redigerer",
      "cPoint3": "Slå det fra med én kontakt, når som helst"
    },
    "languages": {
      "kicker": "ALLE SPROG",
      "title": "Alle sprog, din stemme",
      "body": "Dine kunder skriver på deres sprog. Sona svarer på det — samme tone, samme politikker, ingen oversættelses-omveje."
    },
    "control": {
      "kicker": "DU HAR KONTROLLEN",
      "title": "Du bestemmer, hvor meget Sona gør",
      "body": "Start med forslag alene. Sæt simple ticket-typer på autopilot, når du er klar — og se præcis hvorfor Sona svarede, som den gjorde, med kilder for hver påstand.",
      "toggle1Title": "Foreslå udkast",
      "toggle1Sub": "Alle indkommende tickets",
      "toggle2Title": "Auto-send tracking-svar",
      "toggle2Sub": "Kun ved høj sikkerhed",
      "toggle3Title": "Luk løste tråde automatisk",
      "toggle3Sub": "Fra — du godkender lukninger"
    },
    "pricing": {
      "kicker": "PRISER",
      "title": "Enkle priser der vokser med dig",
      "subtitle": "Alle planer inkluderer alle features og ubegrænsede brugere. Ingen binding — måned til måned.",
      "perMonth": "/md",
      "ticketsLabel": "op til {count} tickets/md",
      "mostPopular": "Mest populær",
      "cta": "Book en demo",
      "pilotNote": "Alle planer starter med en guidet pilot.",
      "enterprise": "Mere end 5.000 tickets om måneden? Tal med os.",
      "tierMini": "Mini",
      "tierStarter": "Starter",
      "tierGrowth": "Growth",
      "tierScale": "Scale",
      "feature1": "Ubegrænsede brugere",
      "feature2": "Alle features inkluderet",
      "feature3": "Ingen binding — opsig månedligt"
    },
    "integrations": {
      "title": "Virker med de værktøjer, du allerede bruger",
      "moreSoon": "flere på vej"
    },
    "faq": {
      "title": "Spørgsmål, besvaret",
      "q1": "Kan mine kunder se, at det er AI?",
      "a1": "Svar sendes fra din egen support-adresse, i din tone, og du godkender dem, før de sendes. Om du oplyser AI-involvering, er dit valg — Sona virker begge veje.",
      "q2": "Hvad sker der, når Sona ikke kender svaret?",
      "a2": "Sona flager ticketen til dig i stedet for at gætte. Ubesvarede spørgsmål bliver forslag til din vidensbase, så dækningen vokser over tid.",
      "q3": "Skal jeg skifte helpdesk?",
      "a3": "Nej. Sona arbejder oven på din eksisterende support-email — du kan beholde dit nuværende setup og dine arbejdsgange.",
      "q4": "Hvor lang tid tager opsætningen?",
      "a4": "At forbinde butik og email tager minutter. At lære Sona dine politikker er et guidet trin — de fleste butikker ser deres første gode udkast samme dag.",
      "q5": "Hvad med GDPR og mine kunders data?",
      "a5": "Kundedata behandles kun for at besvare deres henvendelser, opbevares i EU og bruges aldrig til at træne modeller for andre virksomheder.",
      "q6": "Hvad tæller som en ticket?",
      "a6": "En kundesamtale, uanset hvor mange emails den tager. Automatiske notifikationer og spam tæller ikke."
    },
    "finalCta": {
      "title": "Klar til at få support af bordet?",
      "subtitle": "Book en 20-minutters demo — vi viser Sona besvare tickets som dine.",
      "ctaDemo": "Book en demo",
      "ctaAccess": "Få tidlig adgang"
    },
    "footer": {
      "privacy": "Privatliv",
      "terms": "Vilkår",
      "contact": "hello@sona.ai"
    }
  }
}
```

Fjern `placeholder`-nøglen fra begge filer, og opdatér `app/(marketing)/[locale]/page.jsx` til midlertidigt at bruge `t("hero.titleLine1")` i stedet for `t("placeholder")`.

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `cd apps/web && npx vitest run lib/landing/__tests__/messages.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages "apps/web/lib/landing/__tests__/messages.test.js" "apps/web/app/(marketing)"
git commit -m "feat(landing): complete EN/DA copy with key-parity test"
```

---

### Task 3: Pricing-datamodul

**Files:**
- Create: `apps/web/lib/landing/pricing.js`
- Test: `apps/web/lib/landing/__tests__/pricing.test.js`

**Interfaces:**
- Produces: `PRICING_TIERS` (array af `{ id, nameKey, tickets, dkk, eur, highlighted }`) og `formatTierPrice(tier, locale) => string` ("1.999 kr" for da, "€269" for en). Task 8 (Pricing-sektionen) forbruger begge.

- [ ] **Step 1: Skriv fejlende test**

`apps/web/lib/landing/__tests__/pricing.test.js`:
```js
import { describe, it, expect } from "vitest";
import { PRICING_TIERS, formatTierPrice } from "../pricing";

describe("pricing tiers", () => {
  it("has the four approved tiers in ascending order", () => {
    expect(PRICING_TIERS.map((t) => [t.id, t.tickets, t.dkk, t.eur])).toEqual([
      ["mini", 150, 699, 99],
      ["starter", 500, 1999, 269],
      ["growth", 2000, 3999, 549],
      ["scale", 5000, 6999, 949],
    ]);
  });
  it("highlights exactly growth", () => {
    expect(PRICING_TIERS.filter((t) => t.highlighted).map((t) => t.id)).toEqual(["growth"]);
  });
  it("formats DKK for da and EUR for en", () => {
    const starter = PRICING_TIERS.find((t) => t.id === "starter");
    expect(formatTierPrice(starter, "da")).toBe("1.999 kr");
    expect(formatTierPrice(starter, "en")).toBe("€269");
  });
});
```

- [ ] **Step 2: Kør testen — forvent FAIL**

Run: `cd apps/web && npx vitest run lib/landing/__tests__/pricing.test.js`
Expected: FAIL ("Cannot find module '../pricing'").

- [ ] **Step 3: Implementér modulet**

`apps/web/lib/landing/pricing.js`:
```js
// Godkendte priser (spec §5). Valuta følger locale: DKK på /da, EUR på /en.
export const PRICING_TIERS = [
  { id: "mini", nameKey: "tierMini", tickets: 150, dkk: 699, eur: 99, highlighted: false },
  { id: "starter", nameKey: "tierStarter", tickets: 500, dkk: 1999, eur: 269, highlighted: false },
  { id: "growth", nameKey: "tierGrowth", tickets: 2000, dkk: 3999, eur: 549, highlighted: true },
  { id: "scale", nameKey: "tierScale", tickets: 5000, dkk: 6999, eur: 949, highlighted: false },
];

export function formatTierPrice(tier, locale) {
  if (locale === "da") {
    return `${tier.dkk.toLocaleString("da-DK")} kr`;
  }
  return `€${tier.eur.toLocaleString("en-IE")}`;
}
```

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `cd apps/web && npx vitest run lib/landing/__tests__/pricing.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/landing/pricing.js apps/web/lib/landing/__tests__/pricing.test.js
git commit -m "feat(landing): pricing tier data with locale currency formatting"
```

---

### Task 4: Landing-primitiver — ikoner, nav, footer, sprogskifter, signup-form

**Files:**
- Create: `apps/web/components/landing/icons.jsx`
- Create: `apps/web/components/landing/LandingNav.jsx`
- Create: `apps/web/components/landing/LandingFooter.jsx`
- Create: `apps/web/components/landing/LocaleSwitcher.jsx`
- Create: `apps/web/components/landing/SignupForm.jsx`

**Interfaces:**
- Consumes: messages-nøgler `landing.nav.*`, `landing.footer.*`, `landing.hero.email*` (Task 2)
- Produces: `<LandingNav locale />`, `<LandingFooter locale />`, `<LocaleSwitcher locale />` (client), `<SignupForm source />` (client; poster til `/api/landing-signups`), `CheckIcon`/`SonaMark` fra `icons.jsx`. Task 5-9 forbruger disse.

- [ ] **Step 1: Ikoner og logo-mærke**

`apps/web/components/landing/icons.jsx`:
```jsx
// Delte inline-SVG'er for landing-siden. Ingen emoji — kun stroke-ikoner.
export function SonaMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="#6366f1" strokeWidth="2.4" fill="none" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 11 11" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="5" fill="#eef2ff" />
      <path d="M3.4 5.6l1.4 1.4 2.8-3" stroke="#4f46e5" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 2: LocaleSwitcher (client)**

`apps/web/components/landing/LocaleSwitcher.jsx`:
```jsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Skifter kun locale-præfikset; landing-siden er eneste marketing-rute.
export default function LocaleSwitcher({ locale }) {
  const pathname = usePathname() || "/";
  const other = locale === "da" ? "en" : "da";
  const target = pathname.replace(/^\/(en|da)/, `/${other}`);
  return (
    <Link href={target} className="text-sm text-zinc-500 hover:text-zinc-900" aria-label="Switch language">
      {other.toUpperCase()}
    </Link>
  );
}
```

- [ ] **Step 3: Nav og footer (server)**

`apps/web/components/landing/LandingNav.jsx`:
```jsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SonaMark } from "./icons";
import LocaleSwitcher from "./LocaleSwitcher";

export default async function LandingNav({ locale }) {
  const t = await getTranslations("landing.nav");
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold tracking-tight text-zinc-950">
          <SonaMark /> sona
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
          <a href="#product" className="hover:text-zinc-900">{t("product")}</a>
          <a href="#how" className="hover:text-zinc-900">{t("how")}</a>
          <a href="#pricing" className="hover:text-zinc-900">{t("pricing")}</a>
        </nav>
        <div className="flex items-center gap-4">
          <LocaleSwitcher locale={locale} />
          <Link href="/sign-in" className="hidden text-sm text-zinc-600 hover:text-zinc-900 sm:block">{t("login")}</Link>
          <a href="#book-demo" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            {t("bookDemo")}
          </a>
        </div>
      </div>
    </header>
  );
}
```

`apps/web/components/landing/LandingFooter.jsx`:
```jsx
import { getTranslations } from "next-intl/server";
import { SonaMark } from "./icons";
import LocaleSwitcher from "./LocaleSwitcher";

export default async function LandingFooter({ locale }) {
  const t = await getTranslations("landing.footer");
  return (
    <div className="flex flex-col items-center justify-between gap-4 border-t border-zinc-800 py-6 text-sm text-zinc-500 sm:flex-row">
      <span className="flex items-center gap-2 font-bold text-white"><SonaMark /> sona</span>
      <div className="flex items-center gap-5">
        <a href="/privacy" className="hover:text-zinc-300">{t("privacy")}</a>
        <a href="/terms" className="hover:text-zinc-300">{t("terms")}</a>
        <a href={`mailto:${t("contact")}`} className="hover:text-zinc-300">{t("contact")}</a>
        <LocaleSwitcher locale={locale} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: SignupForm (client) — genbrug af eksisterende API**

`apps/web/components/landing/SignupForm.jsx` (logik portet fra den gamle `components/hero-section.jsx`, copy via i18n):
```jsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";

export default function SignupForm({ source = "landing-hero" }) {
  const t = useTranslations("landing.hero");
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(trimmed)) {
      setError(t("emailInvalid"));
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/landing-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source }),
      });
      if (!res.ok) throw new Error();
      setStatus("success");
    } catch {
      setError(t("emailError"));
      setStatus("error");
    }
  };

  if (status === "success") {
    return <p className="text-sm font-medium text-emerald-600">{t("emailSuccess")}</p>;
  }
  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        aria-label={t("emailPlaceholder")}
        className="h-11 flex-1 rounded-lg border border-zinc-200 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="h-11 rounded-lg border border-zinc-200 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
      >
        {t("ctaAccess")}
      </button>
      {error ? <p className="text-sm text-rose-600 sm:col-span-2">{error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 5: Verificér build**

Run: `cd apps/web && npm run build`
Expected: build OK (komponenterne er endnu ikke wired ind — det sker i Task 5).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/landing
git commit -m "feat(landing): nav, footer, locale switcher, signup form primitives"
```

---

### Task 5: Hero-sektion

**Files:**
- Create: `apps/web/components/landing/Hero.jsx`
- Modify: `apps/web/app/(marketing)/[locale]/page.jsx`

**Interfaces:**
- Consumes: `landing.hero.*`, `<SignupForm />`, `<CheckIcon />` (Task 2+4)
- Produces: `<Hero locale />` med `id="product"`-anker og `#book-demo`-CTA-link. DemoInbox (Task 6) placeres af Hero via children-slot: `<Hero locale>{demoInbox}</Hero>`.

- [ ] **Step 1: Implementér Hero**

`apps/web/components/landing/Hero.jsx`:
```jsx
import { getTranslations } from "next-intl/server";
import SignupForm from "./SignupForm";
import { CheckIcon } from "./icons";

export default async function Hero({ locale, children }) {
  const t = await getTranslations("landing.hero");
  return (
    <section id="product" className="relative overflow-hidden px-5 pt-20 text-center">
      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
        {t("badge")}
      </div>
      <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-zinc-950 sm:text-6xl">
        {t("titleLine1")}
        <br />
        <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          {t("titleLine2")}
        </span>
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-600 sm:text-lg">{t("subtitle")}</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="#book-demo"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500"
        >
          {t("ctaDemo")}
        </a>
        <SignupForm source="landing-hero" />
      </div>
      <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
        {["trust1", "trust2", "trust3"].map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <CheckIcon /> {t(key)}
          </li>
        ))}
      </ul>
      {/* DemoInbox flyder ind her (Task 6) med glød bagved */}
      <div className="relative mt-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(ellipse_at_50%_100%,rgba(99,102,241,0.18),rgba(147,51,234,0.08)_55%,transparent_80%)]"
        />
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire ind i siden**

Erstat `apps/web/app/(marketing)/[locale]/page.jsx` med:
```jsx
import { unstable_setRequestLocale } from "next-intl/server";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";

export default async function LandingPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <LandingNav locale={locale} />
      <Hero locale={locale} />
    </main>
  );
}
```

- [ ] **Step 3: Visuel verifikation**

Run: `npx next dev` → åbn `/en` og `/da`.
Expected: nav + hero renderer på begge sprog; gradient-linje 2 i H1; signup-form poster OK (tjek Network-fanen → 200 fra `/api/landing-signups`); ingen console-fejl.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/landing/Hero.jsx "apps/web/app/(marketing)/[locale]/page.jsx"
git commit -m "feat(landing): hero section with gradient headline and dual CTA"
```

---

### Task 6: DemoInbox — rigtige inbox-komponenter med demo-data

**Files:**
- Create: `apps/web/components/landing/demo-inbox/demo-data.js`
- Create: `apps/web/components/landing/demo-inbox/DemoInbox.jsx`
- Modify: `apps/web/app/(marketing)/[locale]/page.jsx`

**Interfaces:**
- Consumes: `MessageBubble` fra `@/components/inbox/MessageBubble` (props: `{ message, direction, attachments, outboundSenderName }`), `ActionCard` fra `@/components/inbox/ActionCard` (props: `{ status, actionName, actionType, detail, payload, orderSummary, onApprove, onDecline }`)
- Produces: `<DemoInbox />` (client component, `pointer-events-none`, `aria-hidden`) — placeres som children af `<Hero>`.

**Vigtigt for implementøren:** Demo-data er bevidst engelsk på begge locales (det er produktet, ikke marketing-copy). Ingen rigtige kundedata. Læs `getSenderLabel`/`getEffectiveSenderEmail` i `components/inbox/MessageBubble.jsx` og justér felt-navnene i demo-beskederne, hvis bubbles viser "Unknown sender".

- [ ] **Step 1: Demo-data**

`apps/web/components/landing/demo-inbox/demo-data.js`:
```js
// Fiktivt demo-scenarie (spec §3): Sofia Rossi, beskadiget vase, refund-approval.
export const DEMO_INBOUND_MESSAGE = {
  id: "demo-inbound-1",
  from_me: false,
  from_name: "Sofia Rossi",
  from_email: "sofia.rossi@example.com",
  sender_name: "Sofia Rossi",
  sender_email: "sofia.rossi@example.com",
  body_text:
    "Hi,\nMy order arrived today, but the ceramic vase was cracked on one side. I've attached photos. Can I get a refund?\n\nOrder #40318.",
  received_at: "2026-07-15T09:12:00Z",
};

export const DEMO_DRAFT_MESSAGE = {
  id: "demo-draft-1",
  from_me: true,
  is_draft: true,
  from_name: "Sona",
  sender_name: "Sona",
  body_text:
    "Hi Sofia,\n\nI'm so sorry the vase arrived damaged — that's not the experience we want you to have. I've issued a full refund of €89.00; you'll see it within 3–5 business days. No need to send the vase back.\n\nBest,\nYour Store",
  created_at: "2026-07-15T09:13:00Z",
};

export const DEMO_ACTION = {
  status: "proposed",
  actionType: "process_refund",
  actionName: "Refund",
  detail: "Ceramic vase · damage documented in photos",
  payload: { amount: "€89.00", order_number: "40318" },
  orderSummary: null,
};

export const DEMO_TICKET_LIST = [
  { id: "t4", name: "Sofia Rossi", subject: "Item arrived damaged", ref: "T-40318", time: "12 min", badge: "New", selected: true },
  { id: "t3", name: "Lucas Meyer", subject: "Where is my order?", ref: "T-40317 · Draft ready", time: "1 h" },
  { id: "t2", name: "Emma Larsen", subject: "Wrong size — can I exchange?", ref: "T-40316 · Draft ready", time: "3 h" },
  { id: "t1", name: "Noah Berg", subject: "Change delivery address", ref: "T-40315 · Sent", time: "5 h" },
];
```

- [ ] **Step 2: DemoInbox-kompositionen**

`apps/web/components/landing/demo-inbox/DemoInbox.jsx`:
```jsx
"use client";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import { ActionCard } from "@/components/inbox/ActionCard";
import {
  DEMO_INBOUND_MESSAGE,
  DEMO_DRAFT_MESSAGE,
  DEMO_ACTION,
  DEMO_TICKET_LIST,
} from "./demo-data";

function BrowserChrome({ children }) {
  return (
    <div className="overflow-hidden rounded-t-2xl border border-b-0 border-zinc-200 bg-zinc-50 shadow-[0_-8px_60px_-20px_rgba(79,70,229,0.25),0_24px_80px_-24px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
        ))}
        <span className="mx-auto w-64 rounded-md bg-zinc-100 py-1 text-center text-[11px] text-zinc-400">
          app.sona.ai/inbox
        </span>
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

function TicketListColumn() {
  return (
    <div className="hidden w-56 shrink-0 flex-col border-r border-zinc-100 bg-white p-2 text-left lg:flex">
      {DEMO_TICKET_LIST.map((tkt) => (
        <div
          key={tkt.id}
          className={`rounded-md px-2.5 py-2 ${tkt.selected ? "bg-violet-50" : "border-b border-zinc-50"}`}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold text-zinc-900">{tkt.name}</span>
            <span className="text-[10px] text-zinc-400">{tkt.time}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate text-[11px] text-zinc-600">{tkt.subject}</span>
            {tkt.badge ? <span className="text-[10px] font-semibold text-emerald-600">{tkt.badge}</span> : null}
          </div>
          <div className="text-[10px] text-zinc-400">{tkt.ref}</div>
        </div>
      ))}
    </div>
  );
}

// Renderer det rigtige produkt-UI (MessageBubble/ActionCard) med fiktiv data.
// Ikke-interaktiv pr. design: pointer-events-none + aria-hidden.
export default function DemoInbox() {
  return (
    <div aria-hidden="true" className="pointer-events-none relative mx-auto max-w-4xl select-none">
      <BrowserChrome>
        <div className="flex bg-zinc-50/60">
          <TicketListColumn />
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 text-left">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-md border border-zinc-200 px-2 py-0.5 font-semibold text-zinc-600">T-40318</span>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">Needs attention</span>
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Damaged item</span>
            </div>
            <MessageBubble message={DEMO_INBOUND_MESSAGE} direction="inbound" attachments={[]} />
            <ActionCard {...DEMO_ACTION} onApprove={() => {}} onDecline={() => {}} />
            <MessageBubble message={DEMO_DRAFT_MESSAGE} direction="outbound" outboundSenderName="Your Store" attachments={[]} />
          </div>
        </div>
      </BrowserChrome>
    </div>
  );
}
```

- [ ] **Step 3: Wire ind i siden**

I `apps/web/app/(marketing)/[locale]/page.jsx`: importér og placér som Hero-children:
```jsx
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
// ...
<Hero locale={locale}>
  <DemoInbox />
</Hero>
```

- [ ] **Step 4: Visuel verifikation + prop-justering**

Run: `npx next dev` → `/en`.
Expected: browser-ramme med glød; kunde-boble venstre ("Sofia Rossi"), ActionCard med "Approve refund"-knap, violet draft-boble højre. Hvis en boble viser "Unknown sender" eller ActionCard fejler: læs prop-udledningen i hhv. `MessageBubble.jsx` (`getSenderLabel`) og `ActionCard.jsx`, og justér felt-navne i `demo-data.js` — IKKE i produkt-komponenterne. Ingen console-fejl og ingen netværkskald fra DemoInbox (tjek Network-fanen).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/landing/demo-inbox "apps/web/app/(marketing)/[locale]/page.jsx"
git commit -m "feat(landing): DemoInbox hero visual composed from real inbox components"
```

---

### Task 7: How it works, feature deep-dives, sprog- og kontrol-sektioner

**Files:**
- Create: `apps/web/components/landing/HowItWorks.jsx`
- Create: `apps/web/components/landing/FeatureDives.jsx`
- Create: `apps/web/components/landing/LanguagesSection.jsx`
- Create: `apps/web/components/landing/ControlSection.jsx`
- Modify: `apps/web/app/(marketing)/[locale]/page.jsx`

**Interfaces:**
- Consumes: `landing.how.*`, `landing.dives.*`, `landing.languages.*`, `landing.control.*`, `CheckIcon`
- Produces: fire server components uden props ud over `locale`; `HowItWorks` har `id="how"`.

- [ ] **Step 1: HowItWorks**

`apps/web/components/landing/HowItWorks.jsx`:
```jsx
import { getTranslations } from "next-intl/server";

export default async function HowItWorks() {
  const t = await getTranslations("landing.how");
  const steps = [1, 2, 3];
  return (
    <section id="how" className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
        <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {steps.map((n) => (
            <div key={n} className="rounded-xl border border-zinc-200 bg-white p-6">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-sm font-bold text-indigo-600">{n}</div>
              <h3 className="mt-4 text-sm font-bold text-zinc-900">{t(`step${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`step${n}Body`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: FeatureDives (A/B/C, skiftevis layout)**

`apps/web/components/landing/FeatureDives.jsx`:
```jsx
import { getTranslations } from "next-intl/server";
import { CheckIcon } from "./icons";

// Visuals er stiliserede produkt-udsnit (statisk markup — bevidst simple;
// DemoInbox i hero bærer den fulde produkt-gengivelse).
function KnowledgeVisual() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm">
      <p className="text-[10px] font-bold tracking-wider text-zinc-400">SONA'S SOURCES</p>
      {["Return policy · §4", "Shipping times · EU", "Past ticket · T-38102"].map((s) => (
        <p key={s} className="mt-2 rounded-md bg-indigo-50/60 px-3 py-2 text-xs font-medium text-indigo-700">{s}</p>
      ))}
    </div>
  );
}

function ActionsVisual() {
  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-4 text-left shadow-sm">
      <p className="text-xs font-bold text-zinc-900">Refund suggested</p>
      <p className="mt-0.5 text-xs text-zinc-500">Ceramic vase · €89.00 · damage documented</p>
      <div className="mt-3 flex gap-2">
        <span className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Approve refund (€89.00)</span>
        <span className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600">Decline</span>
      </div>
    </div>
  );
}

function AutopilotVisual() {
  const rows = [
    ["Tracking questions", true],
    ["Order status", true],
    ["Refund requests", false],
  ];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm">
      {rows.map(([label, on]) => (
        <div key={label} className="flex items-center justify-between border-b border-zinc-50 py-2 last:border-0">
          <span className="text-xs font-medium text-zinc-800">{label}</span>
          <span className={`relative inline-block h-4 w-8 rounded-full ${on ? "bg-indigo-600" : "bg-zinc-200"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${on ? "right-0.5" : "left-0.5"}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function FeatureDives() {
  const t = await getTranslations("landing.dives");
  const dives = [
    { key: "a", visual: <KnowledgeVisual /> },
    { key: "b", visual: <ActionsVisual /> },
    { key: "c", visual: <AutopilotVisual /> },
  ];
  return (
    <section className="px-5 py-20">
      <div className="mx-auto flex max-w-5xl flex-col gap-16">
        {dives.map(({ key, visual }, i) => (
          <div key={key} className={`flex flex-col items-center gap-8 md:flex-row ${i % 2 ? "md:flex-row-reverse" : ""}`}>
            <div className="flex-1">
              <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t(`${key}Kicker`)}</p>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">{t(`${key}Title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t(`${key}Body`)}</p>
              <ul className="mt-4 space-y-2">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex items-center gap-2 text-sm text-zinc-700">
                    <CheckIcon /> {t(`${key}Point${n}`)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-full max-w-sm flex-1">{visual}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: LanguagesSection og ControlSection**

`apps/web/components/landing/LanguagesSection.jsx`:
```jsx
import { getTranslations } from "next-intl/server";

// Samme svar på tre sprog — demo-indhold, bevidst ikke i messages-filerne.
const SAMPLES = [
  { lang: "Dansk", text: "Hej Sofia, din nye vase er afsendt i dag — beklager besværet!" },
  { lang: "Deutsch", text: "Hallo Sofia, deine neue Vase wurde heute versandt — entschuldige die Umstände!" },
  { lang: "Italiano", text: "Ciao Sofia, il tuo nuovo vaso è stato spedito oggi — scusa il disagio!" },
];

export default async function LanguagesSection() {
  const t = await getTranslations("landing.languages");
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-5xl text-center">
        <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm text-zinc-600">{t("body")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {SAMPLES.map(({ lang, text }) => (
            <div key={lang} className="rounded-xl border border-zinc-200 bg-white p-4 text-left">
              <p className="text-[10px] font-bold tracking-wider text-zinc-400">{lang.toUpperCase()}</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

`apps/web/components/landing/ControlSection.jsx`:
```jsx
import { getTranslations } from "next-intl/server";

export default async function ControlSection() {
  const t = await getTranslations("landing.control");
  const toggles = [
    { n: 1, on: true },
    { n: 2, on: true },
    { n: 3, on: false },
  ];
  return (
    <section className="px-5 py-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 md:flex-row">
        <div className="flex-1">
          <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t("body")}</p>
        </div>
        <div className="w-full max-w-sm flex-1 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          {toggles.map(({ n, on }) => (
            <div key={n} className="flex items-center justify-between border-b border-zinc-50 py-3 last:border-0">
              <div>
                <p className="text-sm font-semibold text-zinc-900">{t(`toggle${n}Title`)}</p>
                <p className="text-xs text-zinc-400">{t(`toggle${n}Sub`)}</p>
              </div>
              <span className={`relative inline-block h-5 w-9 rounded-full ${on ? "bg-indigo-600" : "bg-zinc-200"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${on ? "right-0.5" : "left-0.5"}`} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire sektionerne ind i siden (efter Hero/DemoInbox)**

```jsx
<HowItWorks />
<FeatureDives />
<LanguagesSection />
<ControlSection />
```

- [ ] **Step 5: Visuel verifikation**

Run: `npx next dev` → `/en` + `/da`. Expected: alle fire sektioner renderer på begge sprog, deep-dive B/C spejlvendt layout, ingen manglende-nøgle-fejl i console.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/landing "apps/web/app/(marketing)/[locale]/page.jsx"
git commit -m "feat(landing): how-it-works, feature deep-dives, languages and control sections"
```

---

### Task 8: Pricing, integrationer og FAQ

**Files:**
- Create: `apps/web/components/landing/PricingSection.jsx`
- Create: `apps/web/components/landing/IntegrationsSection.jsx`
- Create: `apps/web/components/landing/FaqSection.jsx`
- Modify: `apps/web/app/(marketing)/[locale]/page.jsx`

**Interfaces:**
- Consumes: `PRICING_TIERS`/`formatTierPrice` (Task 3), `landing.pricing.*`, `landing.integrations.*`, `landing.faq.*`, `CheckIcon`
- Produces: `<PricingSection locale />` (`id="pricing"`), `<IntegrationsSection />`, `<FaqSection />`.

- [ ] **Step 1: PricingSection**

`apps/web/components/landing/PricingSection.jsx`:
```jsx
import { getTranslations } from "next-intl/server";
import { PRICING_TIERS, formatTierPrice } from "@/lib/landing/pricing";
import { CheckIcon } from "./icons";

export default async function PricingSection({ locale }) {
  const t = await getTranslations("landing.pricing");
  const countFmt = new Intl.NumberFormat(locale === "da" ? "da-DK" : "en-IE");
  return (
    <section id="pricing" className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-6xl text-center">
        <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm text-zinc-600">{t("subtitle")}</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`relative rounded-2xl border bg-white p-6 text-left ${
                tier.highlighted ? "border-indigo-300 shadow-lg shadow-indigo-600/10 ring-1 ring-indigo-200" : "border-zinc-200"
              }`}
            >
              {tier.highlighted ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[11px] font-semibold text-white">
                  {t("mostPopular")}
                </span>
              ) : null}
              <h3 className="text-sm font-bold text-zinc-900">{t(tier.nameKey)}</h3>
              <p className="mt-3 text-3xl font-bold tracking-tight text-zinc-950">
                {formatTierPrice(tier, locale)}
                <span className="text-sm font-normal text-zinc-400">{t("perMonth")}</span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">{t("ticketsLabel", { count: countFmt.format(tier.tickets) })}</p>
              <ul className="mt-4 space-y-2">
                {["feature1", "feature2", "feature3"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-zinc-600">
                    <CheckIcon /> {t(f)}
                  </li>
                ))}
              </ul>
              <a
                href="#book-demo"
                className={`mt-6 block rounded-lg py-2.5 text-center text-sm font-semibold ${
                  tier.highlighted ? "bg-indigo-600 text-white hover:bg-indigo-500" : "border border-zinc-200 text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                {t("cta")}
              </a>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-zinc-500">{t("pilotNote")} · {t("enterprise")}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: IntegrationsSection**

`apps/web/components/landing/IntegrationsSection.jsx`:
```jsx
import { getTranslations } from "next-intl/server";

const INTEGRATIONS = ["Shopify", "WooCommerce", "Magento", "Zendesk", "Gmail", "Outlook"];

export default async function IntegrationsSection() {
  const t = await getTranslations("landing.integrations");
  return (
    <section className="px-5 py-16 text-center">
      <p className="text-sm text-zinc-500">{t("title")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {INTEGRATIONS.map((name) => (
          <span key={name} className="text-base font-bold tracking-tight text-zinc-700">{name}</span>
        ))}
        <span className="text-sm text-zinc-400">+ {t("moreSoon")}</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: FaqSection (native details/summary — ingen JS)**

`apps/web/components/landing/FaqSection.jsx`:
```jsx
import { getTranslations } from "next-intl/server";

export default async function FaqSection() {
  const t = await getTranslations("landing.faq");
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <div className="mt-8 space-y-2.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <details key={n} className="group rounded-xl border border-zinc-200 bg-white px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
                {t(`q${n}`)}
                <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-zinc-400 transition-transform group-open:rotate-45" aria-hidden="true">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t(`a${n}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire ind i siden, visuel verifikation**

Tilføj `<PricingSection locale={locale} />`, `<IntegrationsSection />`, `<FaqSection />` efter `<ControlSection />`.

Run: `npx next dev` → `/en` viser €99/€269/€549/€949; `/da` viser 699 kr/1.999 kr/3.999 kr/6.999 kr; Growth har "Most popular"-badge; FAQ folder ud/ind.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/landing "apps/web/app/(marketing)/[locale]/page.jsx"
git commit -m "feat(landing): pricing (4 tiers, locale currency), integrations, FAQ"
```

---

### Task 9: Final CTA + Cal.com demo-booking

**Files:**
- Create: `apps/web/components/landing/CalEmbed.jsx`
- Create: `apps/web/components/landing/FinalCta.jsx`
- Modify: `apps/web/app/(marketing)/[locale]/page.jsx`
- Modify: `apps/web/.env.local` (manuelt af Jonas — dokumentér i README-agtig kommentar)

**Interfaces:**
- Consumes: `landing.finalCta.*`, `<SignupForm />`, `<LandingFooter />`, env `NEXT_PUBLIC_CAL_LINK` (fx `"sona/demo"`)
- Produces: `<FinalCta locale />` med `id="book-demo"` (target for alle "Book a demo"-CTA'er) indeholdende Cal-embed + mørk afslutning + footer.

- [ ] **Step 1: Installér Cal-embed**

Run: `cd apps/web && npm install @calcom/embed-react`

- [ ] **Step 2: CalEmbed (client) med fallback**

`apps/web/components/landing/CalEmbed.jsx`:
```jsx
"use client";

import Cal from "@calcom/embed-react";

const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK || "";

// Inline Cal.com-booking. Uden env-link vises fallback-anker i stedet
// (deploy må aldrig vise en tom boks).
export default function CalEmbed({ fallbackLabel }) {
  if (!CAL_LINK) {
    return (
      <a
        href="mailto:hello@sona.ai?subject=Demo"
        className="inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-100"
      >
        {fallbackLabel}
      </a>
    );
  }
  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white">
      <Cal calLink={CAL_LINK} config={{ theme: "light" }} style={{ width: "100%", height: "560px" }} />
    </div>
  );
}
```

- [ ] **Step 3: FinalCta (mørk sektion + footer)**

`apps/web/components/landing/FinalCta.jsx`:
```jsx
import { getTranslations } from "next-intl/server";
import CalEmbed from "./CalEmbed";
import SignupForm from "./SignupForm";
import LandingFooter from "./LandingFooter";

export default async function FinalCta({ locale }) {
  const t = await getTranslations("landing.finalCta");
  return (
    <section id="book-demo" className="relative overflow-hidden bg-zinc-950 px-5 pt-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[32rem] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,0.35),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("title")}</h2>
        <p className="mt-3 text-sm text-zinc-400">{t("subtitle")}</p>
        <div className="mt-8">
          <CalEmbed fallbackLabel={t("ctaDemo")} />
        </div>
        <div className="mt-8 flex justify-center">
          <SignupForm source="landing-footer" />
        </div>
        <div className="mt-14">
          <LandingFooter locale={locale} />
        </div>
      </div>
    </section>
  );
}
```

Bemærk: `SignupForm` er stylet til lys baggrund — verificér læsbarheden på mørk og justér om nødvendigt med en `variant="dark"`-prop der skifter input-baggrund til `bg-zinc-900 text-white border-zinc-700`.

- [ ] **Step 4: Wire ind + env-dokumentation**

Tilføj `<FinalCta locale={locale} />` som sidste sektion. Jonas tilføjer `NEXT_PUBLIC_CAL_LINK=<team>/<event>` i `.env.local` og på droplet'en (spec §11 — Cal.com-event oprettes af Jonas).

- [ ] **Step 5: Visuel verifikation**

Run: `npx next dev` → `/en#book-demo`.
Expected: uden env-var → fallback-knap; med env-var sat → Cal-kalenderen loader. Alle "Book a demo"-knapper (nav, hero, pricing) scroller til sektionen.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/landing apps/web/package.json apps/web/package-lock.json "apps/web/app/(marketing)/[locale]/page.jsx"
git commit -m "feat(landing): dark final CTA with Cal.com embed and footer"
```

---

### Task 10: SEO/metadata, oprydning af TailArk-komponenter, slutverifikation

**Files:**
- Modify: `apps/web/app/(marketing)/[locale]/page.jsx` (generateMetadata)
- Delete: `apps/web/components/hero-section.jsx`, `integrations-4.jsx`, `faqs-2.jsx`, `content-three.jsx`, `trust-logos.jsx`, `features-grid.jsx`, `pricing.jsx`, `final-cta.jsx`, `footer-four.jsx`, `processing-demo.jsx`

**Interfaces:**
- Consumes: alt fra Task 1-9
- Produces: produktionsklar side med hreflang-metadata; død TailArk-kode fjernet.

- [ ] **Step 1: Metadata med hreflang**

Tilføj i `apps/web/app/(marketing)/[locale]/page.jsx`:
```jsx
export async function generateMetadata({ params: { locale } }) {
  const isDa = locale === "da";
  return {
    title: isDa
      ? "Sona — AI-support til webshops. Du godkender hvert svar."
      : "Sona — AI support for webshops. You approve every reply.",
    description: isDa
      ? "Sona læser hver kundemail, slår ordren op i din butik og skriver det rigtige svar — klar til godkendelse med ét klik."
      : "Sona reads every customer email, looks up the order in your store, and drafts the right reply — ready for one-click approval.",
    alternates: {
      canonical: `/${locale}`,
      languages: { en: "/en", da: "/da" },
    },
  };
}
```

- [ ] **Step 2: Slet TailArk-komponenterne**

```bash
cd apps/web && git rm components/hero-section.jsx components/integrations-4.jsx components/faqs-2.jsx components/content-three.jsx components/trust-logos.jsx components/features-grid.jsx components/pricing.jsx components/final-cta.jsx components/footer-four.jsx components/processing-demo.jsx
```

Run: `grep -rn "hero-section\|integrations-4\|faqs-2\|content-three\|trust-logos\|features-grid\|footer-four\|final-cta\|processing-demo" apps/web/app apps/web/components --include="*.jsx" --include="*.js"`
Expected: ingen hits (hvis fx `components/header.jsx` kun bruges af den slettede hero, slettes den også; hvis noget stadig importeres af IKKE-landing-kode, behold dét og notér i commit-beskeden).

- [ ] **Step 3: Fuld testkørsel og build**

Run: `cd apps/web && npx vitest run && npm run build`
Expected: alle vitest-suiter PASS; build OK uden manglende imports.

- [ ] **Step 4: Slutverifikation i browser**

Run: `npx next dev`. Tjekliste:
- `/` → `/en`; `/da` OK; sprogskifter virker begge veje
- Alle sektioner i rækkefølge: nav → hero+DemoInbox → how → dives → languages → control → pricing → integrations → FAQ → final CTA+footer
- Mobil (375px): DemoInbox skjuler ticket-listen (kun detail-kolonnen), ingen horisontal scroll
- `/inbox` er stadig auth-beskyttet; `/api/landing-signups` svarer 200
- Ingen emojis i den renderede side (visuel skimning)
- Lighthouse (Chrome DevTools) på `/en`: Performance/SEO/A11y ≥ 90 vejledende — notér score

- [ ] **Step 5: Commit**

```bash
git add -u apps/web/components "apps/web/app/(marketing)"
git commit -m "feat(landing): hreflang metadata + remove legacy TailArk landing components"
```

---

## Post-plan (udenfor tasks — Jonas)

- Opret Cal.com-event og sæt `NEXT_PUBLIC_CAL_LINK` lokalt + på droplet
- Bekræft kontakt-email (`hello@sona.ai` er placeholder i copy)
- Deploy: droplet-flowet (git pull, `npm run build`, `pm2 restart sona-web`)
- `/privacy` og `/terms` er linket i footeren men eksisterer ikke endnu — skal laves inden offentlig lancering
