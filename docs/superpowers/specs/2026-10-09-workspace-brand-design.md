# Workspace-brand og bedre mail-designere — design

Dato: 2026-10-09 · Branch: `feat/workspace-brand-1009` · Status: til review
Forudsætning: confirmation-skabeloner (PR #113).

## Formål

Det skal være let for en webshop at få confirmation- og satisfaction-mails, der ligner deres eget brand. I dag er det svært af to grunde:

- Designeren kan ikke uploade billeder. Et logo kræver en offentlig URL, som butikken selv skal finde.
- Brandet sættes pr. blok og pr. mail. Brand-data ligger allerede tre steder: satisfaction-indstillingernes logo, accentfarve og firmanavn samt hver medarbejders signatur-logo.

Arbejdet deles i tre leverancer. Hver merges og testes for sig.

| | Leverance | Kort |
|---|---|---|
| A | Brand i Settings | Logo og accentfarve gemt ét sted pr. workspace |
| B | Designerne bruger brandet | Skabeloner udfyldes med logo og farve. Billeder kan uploades direkte i designeren |
| C | Bedre redigering | Formatering i beskeden, footer-blok og eksempelværdier på lærredet |

Denne spec beskriver A i detaljer. B og C er skitseret nederst og får hver deres spec og plan, når A er merget.

**Succeskriterium for A:** en admin kan uploade et logo og vælge en accentfarve under Settings → Brand. Værdierne gemmes på workspacet og står der efter genindlæsning. Logoet ligger på en offentlig HTTPS-URL, som kan bruges i mails.

## Ikke i scope (A)

- At designerne eller mails bruger brandet. Det er B.
- At hente brandet fra butikkens platform. Det kan tilføjes senere som en platform-neutral knap ("Import from your store"), der bruger den tilsluttede platform (Shopify i dag, andre senere). Navne i UI og kode må ikke binde funktionen til Shopify.
- At flytte satisfaction-indstillingernes eller signaturernes logoer over på brandet. De forbliver uændrede.
- Font-valg. Designerne har deres egen font-indstilling.

## Placering i Settings

En egen side **"Brand"** under WORKSPACE, efter General og Members (`/settings/brand`). Brandet handler om, hvordan butikken ser ud over for kunderne, og hører ikke hjemme blandt General's driftsindstillinger. Siden får også mere indhold med tiden (fx "Import from your store"). Beslutningen er truffet med Jonas efter første test, hvor gruppen lå i General.

| Række | Kontrol | Hjælpetekst |
|---|---|---|
| Logo | Thumbnail og knapperne "Upload" og "Remove" (når der er et logo) | "PNG or JPG, up to 5 MB. Used in your email designs." |
| Accent color | Farvefelt (native color input) og hex-felt (h-8) | "Used for headlines, links and buttons in your email designs." |

Rækkerne følger settings-redesignets byggeklodser (`SettingsGroup`, `SettingsRow`). Ændringer gemmes med sidens egen `SettingsSaveBar`. Upload sker straks, når filen vælges, så thumbnailen kan vises. URL'en gemmes dog først på workspacet, når der trykkes Save. "Discard" fortryder derfor også et logo-skift.

Al UI-tekst er på engelsk.

## Data

To nye kolonner på `public.workspaces`, begge nullable:

```sql
alter table public.workspaces
  add column if not exists brand_logo_url text,
  add column if not exists brand_accent_color text
    check (brand_accent_color is null or brand_accent_color ~ '^#[0-9a-fA-F]{6}$');
```

- `null` betyder "ikke sat". Designerne (B) bruger så deres egne standardværdier.
- Migrationen køres kun på dev (`zxaoycxzdjrbnzvbullk`). I prod skal migrationen køres **før** web-deploy, fordi General-sektionen og bootstrap læser kolonnerne.

## API

**`GET /api/settings/brand`** returnerer `{ logo_url, accent_color }` for det aktuelle workspace. Den indgår i settings-bootstrap (`/api/settings/bootstrap`), så sektionsskift stadig sker uden ekstra kald.

**`PUT /api/settings/brand`** tager `{ logo_url, accent_color }`:

- `accent_color`: `null` eller `#rrggbb`. Ellers 400.
- `logo_url`: `null` eller en HTTPS-URL i vores eget offentlige billed-bucket for **dette** workspace (præfiks `<supabase>/storage/v1/object/public/workspace-email-signature-assets/<workspaceId>/brand/`). Ellers 400, så en vilkårlig ekstern URL aldrig gemmes som brand.
- Rettigheder som de øvrige workspace-indstillinger i General: samme scope-opslag (`resolveAuthScope`) og samme rolle-tjek som `/api/settings/test-mode`.

**`POST /api/settings/brand/logo`** (multipart, felt `file`):

- Genbruger `validateEmailSignatureImage`: PNG/JPEG, maks. 5 MB og et tjek af filens magic bytes.
- Gemmes i det eksisterende offentlige bucket `workspace-email-signature-assets` under `<workspaceId>/brand/<uuid>.<ext>`.
- Returnerer `{ url }`. Den skriver ikke til `workspaces`, det gør PUT ved Save.
- Gamle logofiler slettes ikke i A. Et forladt upload koster et par hundrede KB i storage. Oprydning kan komme senere uden datatab.

Hvorfor det eksisterende bucket: det er allerede offentligt og lavet til billeder i mails (signaturer). Et nyt bucket ville kræve ny storage-opsætning og nye policies i begge miljøer uden nogen gevinst.

## Ren logik (testbar)

`apps/web/lib/settings/brand.js`:

- `normalizeAccentColor(value)` → `"#rrggbb"` (små bogstaver), `null` for tom værdi, og fejl ved ugyldig værdi
- `isWorkspaceBrandLogoUrl(url, { supabaseUrl, workspaceId })` → boolean
- `brandDirty(initial, current)` → boolean

## Fejl og tomme tilstande

- Upload-fejl (forkert type, for stor, ikke-matchende indhold) vises som toast med serverens besked. Thumbnailen forbliver uændret.
- Intet logo: rækken viser kun "Upload".
- Bootstrap-fejl for brand: sektionen viser tomme værdier, som de andre ressourcer gør i dag.

## Test og evidens

- **Unit (vitest):**
  - `lib/settings/brand.js`: gyldige og ugyldige farver, logo-URL for eget workspace, andet workspace, andet bucket, http og ekstern host
  - route-tests for PUT (afviser ugyldig farve og fremmed URL) i samme stil som `app/api/settings/__tests__`
- **Migration:** anvendt på dev og verificeret med et `select` af kolonnerne og check-constraint.
- **Manuelt i Chrome mod dev:**
  - upload logo → thumbnail vises
  - vælg farve → gem-bar vises → Save → genindlæs, og værdierne står der stadig
  - Discard fortryder
  - Remove → Save → logoet er væk
  - testen sættes tilbage bagefter

  Kræver, at Chrome er logget ind i dev-appen. Det gør Jonas.
- `npx vitest run lib/settings app/api/settings` og `next build` grønne. Build køres ikke mod den kørende dev-servers `.next`.

## Leverance

Én PR. Ingen merge uden eksplicit instruks. Ingen prod-migration uden eksplicit "prod".

---

## B — designerne bruger brandet (skitse, egen spec senere)

- **Billed-upload i designeren:** Templatical-editoren har `onRequestMedia`. Den kobles til en fil-vælger, der uploader til `<workspaceId>/email-images/<uuid>` i samme bucket og returnerer URL'en. Det gælder både confirmation- og satisfaction-designeren.
- **Skabeloner udfyldes:** når en skabelon vælges, sættes logo-feltet til brandets logo, og accentfarven bruges i overskrift, links og knapper. Eksisterende designs ændres ikke.
- **Branded-skabelonen** får sin accent-linje og footer tilbage, nu i brandets farve. Minimal centreres. Begge punkter blev lovet tidligere, men ikke leveret i #113.

## C — bedre redigering (skitse, egen spec senere)

- **Formatering i beskedblokken** (fed skrift, links, justering). Svært, fordi afsenderen bygger både en tekst- og en HTML-version af beskeden. Det skal designes særskilt.
- **Footer-blok** med butiksnavn og links. Det kræver, at `{{store.name}}` tillades uden for beskedblokken.
- **Eksempelværdier på lærredet** ("Hi Alex" i stedet for `{{customer.first_name}}`). Editoren har en indbygget Sample/Label-visning for merge tags, som måske kun kræver konfiguration.
