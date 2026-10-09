# Mediebibliotek og brand i mail-designerne (B) — design

Dato: 2026-10-09 · Branch: `feat/brand-in-designers-1009` · Status: til review
Forudsætning: workspace-brand (A, PR #114) og confirmation-skabeloner (PR #113), begge merget.

## Formål

En butik skal kunne bygge mails med sine egne billeder og sit eget brand uden at kende til URL'er. Billeder uploades én gang til et fælles bibliotek pr. workspace og genbruges derefter overalt.

Leverancen er delt i to PR'er:

| | Indhold |
|---|---|
| **B1 – Mediebibliotek** | Tabel, API, en fælles billedvælger, kobling til begge designere og til Brand-siden. Det eksisterende brand-logo flyttes ind i biblioteket |
| **B2 – Skabeloner bruger brandet** | "Branded" og "Dark" udfyldes med logo og accentfarve. Satisfaction-skabeloner får logoet. Skabelon-dialogen linker til Brand-siden |

**Succeskriterier:**
- Et billede uploadet i confirmation-designeren kan vælges igen i satisfaction-designeren og på Brand-siden uden ny upload.
- En butik med brand vælger "Branded" og får sit logo og sin farve uden at redigere blokke.

## Ikke i scope

- En separat bibliotek-side i Settings. Biblioteket findes, hvor man vælger billeder. En side kan komme senere.
- Signaturernes logoer. De har egen upload i dag og flyttes ind i biblioteket senere, som en separat opgave.
- Mapper, tags, redigering eller beskæring af billeder.
- Fysisk sletning af filer.
- Formatering i beskedblokken, footer med butiksnavn og eksempelværdier på lærredet (leverance C).
- Import af brandet fra butikkens platform.

---

# B1 — Mediebibliotek

## Data

Ny tabel `public.workspace_media`:

```sql
create table public.workspace_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null unique,          -- <workspaceId>/media/<uuid>.<ext>
  public_url text not null,
  file_name text not null,                    -- originalt navn, maks. 200 tegn
  content_type text not null check (content_type in ('image/png','image/jpeg','image/gif')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  width integer, height integer,
  uploaded_by uuid,                           -- supabase user id, null for flyttede filer
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index workspace_media_library_idx
  on public.workspace_media (workspace_id, created_at desc) where deleted_at is null;
```

- RLS er slået til med en select-policy for workspace-medlemmer (samme mønster som `workspace_customer_satisfaction_settings`). Alle skrivninger sker via API'et med service-klienten.
- **Brandets logo** gemmes fortsat som `workspaces.brand_logo_url`. Valideringen ændres: URL'en skal tilhøre en ikke-slettet række i `workspace_media` for samme workspace. Logoer, der allerede ligger i `<ws>/brand/`, flyttes ind i biblioteket: migrationen indsætter en række for hvert workspace med et `brand_logo_url`, med `content_type`/`size_bytes` hentet fra `storage.objects`.
- Migrationen køres kun på dev. I prod skal den køres før web-deploy.

## Filer og formater

- PNG, JPEG og GIF (også animeret). Filens indhold tjekkes mod typen via magic bytes (`GIF87a`/`GIF89a` for GIF).
- SVG og WebP afvises. Mange mailprogrammer viser dem ikke, og SVG kan indeholde scripts.
- **Optimering ved upload** (med `sharp`, som allerede er en afhængighed):
  - JPEG genkodes altid: maks. 1200 px bredde (dobbelt opløsning af 600 px-mailen), kvalitet 82. Det fjerner også metadata som GPS-position og anvender kameraets rotation. Det er vigtigt, fordi billederne er offentlige.
  - PNG genkodes kun, når den er bredere end 1200 px eller over 1 MB, og forbliver PNG af hensyn til gennemsigtighed.
  - GIF røres aldrig, så animationer bevares.
- **Grænser:**
  - JPEG og PNG må uploades op til 15 MB, fordi de komprimeres, men det gemte billede skal være højst 5 MB.
  - GIF højst 5 MB. Over 1 MB vises en advarsel ("Large GIFs load slowly in email").
- Bredde og højde gemmes efter optimering. Billeder, der er flyttet ind fra før biblioteket, har ingen dimensioner. Vælgeren aflæser dem fra thumbnailen.
- Storage: det eksisterende offentlige bucket `workspace-email-signature-assets` under `<workspaceId>/media/<uuid>.<ext>`. Filnavnene er tilfældige UUID'er og kan ikke gættes. Billederne er offentlige, fordi mails skal kunne vise dem.

## API

| Route | Gør |
|---|---|
| `GET /api/media?before=<created_at>` | Workspacets ikke-slettede billeder, nyeste først, 60 ad gangen. Returnerer `{ items, next_before }` |
| `POST /api/media` (multipart `file`) | Validerer, uploader og indsætter en række. Returnerer elementet |
| `DELETE /api/media/:id` | Sætter `deleted_at`. Filen bliver liggende, så sendte mails og eksisterende designs stadig viser billedet |
| `POST /api/media/:id/restore` | Fortryder en sletning (fjerner `deleted_at`) |

- Alle workspace-medlemmer må liste, uploade og skjule billeder. Sletning er blød og kan rettes i databasen, så det kræver ikke admin.
- Et element: `{ id, url, file_name, content_type, size_bytes, width, height, created_at }`.
- Rækker filtreres altid på `workspace_id` fra auth-scope. Et id fra et andet workspace giver 404.

## Billedvælgeren (`MediaPicker`)

En dialog (`components/media/MediaPicker.jsx`) med:

- **Header:** titlen "Choose an image" og knappen "Upload". Man kan også trække filer ind i dialogen.
- **Gitter** med kvadratiske thumbnails (`object-contain` på neutral baggrund). Under hver: filnavn og dimensioner. Det valgte billede har en ring om sig. Ved hover vises en `⋯`-menu med "Delete".
- **Upload:** et nyt billede vises øverst med en spinner, mens det uploades, og bliver valgt, når det er færdigt. Fejl vises som toast.
- **Tom tilstand:** "No images yet. Upload your logo or other images to use them in your emails."
- **"Load more"** når `next_before` findes.
- **Footer:** "Cancel" og "Use image".
- API: `openMediaPicker()` via en `MediaPickerProvider`, som resolver med elementet eller `null`.

- **Fortryd:** efter "Delete" vises en besked med "Undo", som gendanner billedet på samme plads.

**Bruges i:**
- `EmailTemplateBuilder`: `onRequestMedia` åbner vælgeren og returnerer `{ url, alt }`, hvor alt er filnavnet uden extension. Det gælder både confirmation- og satisfaction-designeren.
  - Trækkes en fil direkte ind på en billedblok, uploades den til biblioteket og indsættes uden dialog.
  - **Bredde:** nye billedblokke starter i fuld bredde. Efter et valg får blokken billedets egen bredde, når billedet er smallere end mailen (fx et 417 px logo). Editoren kan kun overføre `src` og `alt`, så bredden sættes i `onChange` via `setContent`.
- Brand-siden: "Upload" og "Replace" erstattes af "Choose logo", som åbner vælgeren. Brand-ruten `/api/settings/brand/logo` fjernes. "Remove" fjerner kun koblingen til brandet, ikke billedet i biblioteket.

## Test og evidens (B1)

- **Unit:**
  - dimensionslæsning for PNG, JPEG (SOF0 og SOF2) og GIF
  - typevalidering med GIF-magic bytes, afvisning af SVG/WebP og ikke-matchende indhold
  - brand-validering, der kræver en media-række
- **Route-tests:**
  - 401
  - liste filtreret på workspace og ikke-slettede
  - pagination
  - upload gemmer under `<ws>/media/` og indsætter en række
  - DELETE på et andet workspace giver 404
  - blød sletning
- **Migration på dev:** tabel, index og policy findes. Det eksisterende brand-logo for Morrow Home er flyttet ind i biblioteket.
- **Chrome mod dev (Jonas' login):**
  - upload i confirmation-designeren → billedet indsættes
  - åbn satisfaction-designeren → samme billede kan vælges uden ny upload
  - Brand → Choose logo → vælg fra biblioteket → Save → genindlæs
  - skjul et testbillede
  - testdesigns og testbilleder ryddes bagefter

---

# B2 — Skabeloner bruger brandet

- `EmailTemplateBuilder` henter `/api/settings/brand` ved åbning. `createStarter(templateId, { linkMode, brand })` får `brand = { logoUrl, accentColor }`.
- **Confirmation:**
  - **Branded:** logo, en tynd accentlinje øverst og overskriften i accentfarven. Footer i lille grå tekst: "You're receiving this email because you contacted our support team."
  - **Dark:** logo og accentlinje. Overskriften forbliver hvid af hensyn til kontrasten.
  - **Simple og Minimal:** uændrede. Minimal forbliver venstrestillet, fordi centreret brødtekst over flere afsnit er svær at læse.
  - **Uden brand:** standardfarver og tomt logo-felt.
- **Satisfaction:** når brandet har et logo, sættes det centreret øverst i alle skabeloner undtagen "Start blank". Accentfarven bruges ikke på rating-knapperne, fordi deres farver er valgt for læsbarhed.
- **Brandet bruges kun, når man vælger en skabelon.** Gemte designs ændres ikke, når brandet ændres.
- Skabelon-dialogen får én linje med link til `/settings/brand`:
  - med brand: "Templates use your logo and accent color from Brand settings."
  - uden brand: "Add your logo and accent color in Brand settings to use them in templates."
- **Test:**
  - unit for skabeloner med og uden brand: logo, accentfarve, hvid Dark-overskrift, footer, Simple og Minimal uændrede, alle kan gemmes og sender ticket-nummeret
  - CSAT-skabeloner med og uden logo
  - manuelt i Chrome: Branded med brand → preview

## Leverance

To PR'er: B1, derefter B2. Ingen merge uden eksplicit instruks. Ingen prod-migration uden eksplicit "prod".
