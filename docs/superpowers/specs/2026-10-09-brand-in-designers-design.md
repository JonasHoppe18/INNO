# Brand i mail-designerne (B) — design

Dato: 2026-10-09 · Branch: `feat/brand-in-designers-1009` · Status: til review
Forudsætning: workspace-brand (A, PR #114) og confirmation-skabeloner (PR #113), begge merget.

## Formål

Brandet fra Settings → Brand skal komme ud i mailene, og billeder skal kunne lægges i designet uden en offentlig URL.

**Succeskriterier:**
- En butik med logo og accentfarve vælger "Branded" i confirmation-designeren og får en mail med sit eget logo og sin egen farve uden at redigere en eneste blok.
- I begge designere (confirmation og satisfaction) kan man vælge et billede fra computeren til en billedblok.

## Ikke i scope

- At eksisterende, gemte designs ændres, når brandet ændres. Brandet bruges, når en skabelon vælges. Bagefter ejer butikken designet.
- Formatering i beskedblokken, footer med butiksnavn og eksempelværdier på lærredet. Det er leverance C.
- Import af brandet fra butikkens platform.
- Oprydning af gamle billedfiler.

## 1. Billed-upload i designerne

Templatical-editoren kalder `onRequestMedia(context)` og forventer `{ url, alt? } | null`.

- `EmailTemplateBuilder` sender `onRequestMedia` til `init`. Funktionen åbner en skjult `<input type="file" accept="image/png,image/jpeg">`, uploader den valgte fil og returnerer `{ url }`. Hvis brugeren annullerer, returneres `null`.
- **Ny route `POST /api/settings/email-images`** (multipart `file`):
  - genbruger `uploadEmailSignatureImage` med `userId: "email-images"`
  - gemmer filen i det offentlige bucket under `<workspaceId>/email-images/<uuid>.<ext>`
  - samme regler som logoet: PNG/JPEG, maks. 5 MB, tjek af filens magic bytes
  - returnerer `{ url }`
- Fejl vises som toast, og billedblokken forbliver uændret.
- Det gælder både confirmation- og satisfaction-designeren, fordi de deler `EmailTemplateBuilder`.

## 2. Skabelonerne bruger brandet

- `EmailTemplateBuilder` henter `/api/settings/brand` ved åbning. Det er ét kald på en fuldskærmsside, som ikke er en del af settings-bootstrap.
- `createStarter(templateId, { linkMode, brand })` får brandet med. `brand = { logoUrl, accentColor }` med tomme strenge, når intet er sat.
- **Confirmation-skabeloner** (`createConfirmationStarterTemplate(id, { brand })`):
  - **Branded:** logo-feltet får brandets logo. Overskriften og en tynd accentlinje øverst får accentfarven. En footer nederst i lille grå tekst: "You're receiving this email because you contacted our support team."
  - **Dark:** logo og en accentlinje øverst. Overskriften forbliver hvid, så kontrasten holdes på den mørke baggrund.
  - **Simple og Minimal:** ændres ikke af brandet. Minimal skal ligne en personlig mail.
  - Uden brand bruger skabelonerne nuværende standardfarver og et tomt logo-felt, som i dag.
- **Satisfaction-skabeloner** (`createCsatEmailStarterTemplate(id, { linkMode, brand })`): når brandet har et logo, indsættes logoet centreret øverst i alle skabeloner undtagen "Start blank". Accentfarven bruges ikke i satisfaction-mailen i denne leverance. Rating-farverne er afstemt efter læsbarhed, og det kræver et separat design at ændre dem.
- **Nye designs:** standardudkastet til en butik uden gemt design (`confirmation-store` og builderens fallback) forbliver Simple. Brandet bruges kun, når man aktivt vælger en skabelon.

## 3. Synlig kobling til Brand-siden

Skabelon-dialogen viser én linje under beskrivelsen:

- Med brand: "Templates use your logo and accent color from **Brand settings**."
- Uden brand: "Add your logo and accent color in **Brand settings** to use them in templates."

"Brand settings" er et link til `/settings/brand`.

## 4. Minimal — afklaring

Mit tidligere forslag sagde "Minimal: hvid, centreret og stille". Indholdet er allerede centreret som en 600 px kolonne, mens teksten er venstrestillet. Centreret brødtekst i en mail med flere afsnit er svær at læse og ligner ikke en personlig mail. Minimal forbliver derfor venstrestillet.

## Test og evidens

- **Unit (vitest):**
  - Confirmation-skabeloner med og uden brand:
    - logo-src
    - accentfarve på overskrift og linje i Branded
    - Dark-overskriften er hvid
    - footer-teksten findes
    - Simple og Minimal er identiske med og uden brand
    - alle skabeloner kan stadig gemmes og sende ticket-nummeret
  - Satisfaction-skabeloner med og uden logo: logoet står øverst, og "Start blank" er uden logo. Eksisterende CSAT-tests forbliver grønne.
  - Route-test for `/api/settings/email-images`: 401 og at filen gemmes i `<workspace>/email-images/`.
- **Manuelt i Chrome mod dev (Jonas' login):**
  - Brand sat → confirmation-designer → Templates → Branded → logo og farve vises → Preview
  - et billede uploades til en ny billedblok
  - det samme i satisfaction-designeren
  - testdesigns sættes tilbage bagefter
- `next build` grøn. Dev-serveren genstartes bagefter.

## Leverance

Én PR. Ingen merge uden eksplicit instruks. Ingen migration.
