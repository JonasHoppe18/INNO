# Lokalt designreview

Branch: codex/sona-design-local-1002b. Dette gennemløb fortsætter fra 951b9548 i worktreet sona-design-local-1002b. Ingen push eller ny PR.

## Ændringer

Hvid canvas og sidebar, Inter, neutral toolbar og svag violet selection. Customers, Analytics, Integrations, Settings og Knowledge-komponenterne bruger fælles semantiske tokens. Desktop-layout og panelbredder er bevaret.

| Before | After | Why |
| --- | --- | --- |
| Lokale farvepaletter i sider og overlays | Fælles tokens i begge temaer | Ens farver og statusroller |
| Mobilfelter fulgte mindre body-token | text-input 16 px mobil, 13 px desktop | Læsbarhed uden automatisk zoom |
| Fejlfelter havde normal kant | aria-invalid markerer kant og fokusring | Synlig fejl med koblet hjælpetekst |
| Mobilnavigation manglede på flere sider | Fælles trigger, lukker ved sideskift | Hovedsider kan nås |
| Settings-felter og Knowledge-knapper klippede | Controls wrapper; Members-tabellen scrolles lokalt | Desktop-layout bevares |

PR80-filerne KnowledgeCategoriesClient.jsx og SonaActivityContent.jsx er ikke redigeret. Deres lokale farver og størrelser afventer afstemning. [new-feature/SKILL.md](../skills/new-feature/SKILL.md) siger "stop and ask for direction" ved overlap.

Logoer, chart-serier, brugerens tagfarver, formateret brugerindhold og theme-picker-miniaturer beholder egne farver. Marketing beholder sin skala.

## Kørsel

Fra worktreets rod, når der er diskplads:

```sh
ulimit -n 8192
SONA_DESIGN_DISABLE_WEBPACK_CACHE=1 NODE_OPTIONS=--max-old-space-size=1024 npm --workspace apps/web run dev -- --hostname localhost --port 3106
```

Dev-.env.local matcher localhost:3106. Cache- og hukommelsesflag er lokale hensyn til maskinen. [Inbox](http://localhost:3106/inbox) og [design-lab](http://localhost:3106/design-lab). Lab findes kun under next dev og bruger fiktive data.

## Checks

| Check | Resultat | Evidens / begrænsning |
| --- | --- | --- |
| TypeScript | Bestået | tsc --noEmit --incremental false |
| Lint | Bestået | Alle ændrede JSX-filer uden cache; sidste mobilrettelser kontrolleret separat |
| Diff-check | Bestået | git diff --check |
| Produktionsbuild | Blokeret | ENOSPC under webpack. Tidligere build med 161 sider validerer ikke sidste ændringer |
| Mobil Customers | Bestået | Faktisk viewport og root scrollWidth 390 px; input 16 px |
| Mobil Settings General | Bestået inden genstart | Test-email-feltet wrapper; ingen klippede felter |
| Mobil Settings Members | Bestået inden genstart | Intern tabelscroll: 356 px synlig bredde, 748 px indhold |
| Mobilnavigation | Bestået | Åbner, Escape lukker; Integrations → Analytics → Knowledge/new lukker menu efter sideskift |
| Mobil Integrations | Bestået | 390 px uden sideoverflow eller klippede controls; h1 16 px og sektioner 14 px |
| Shopify-overlay | Bestået | Inter og hvidt panel, Escape lukker. Ingen gemt eller frakoblet integration |
| Mobil Knowledge/new | Bestået | 390 px root; input 16 px, header-controls inden for viewport efter wrap |
| Knowledge source-sheet | Gennemgået | Panel 390 px, felter 16 px. Langt panel scrolles; ingen drafts oprettet |
| Desktop | Bestået på målte sider | Analytics, Customers, Integrations, Knowledge/new: 1470 px root uden overflow; h1 16 px, input 13 px |
| Desktop Settings efter genstart | Ufuldstændigt | Navigation og skeleton renderede; felter indlæste ikke før server blev stoppet |
| Design-lab light/dark | Bestået | 390 px uden overflow; body hvid / rgb(21,21,26) |
| Fejlkant og fokus | Bestået | Light kant og fokusring rgb(180,35,24); dark kant rgb(253,162,155) |
| Select og Escape | Bestået | Demo Shop lukker og returnerer fokus til demo-shop |

Fejlvarianterne bruger Tailwind 3-syntaksen aria-[invalid=true]. Browsermåling fandt, at den kortere aria-invalid-variant ikke genererede CSS; det er rettet.

## Evidens og resterende arbejde

Aktuelle lokale screenshots: /tmp/sona-design-local-1002b-evidence/01-mobile-error.png og 02-mobile-dark.png. Begge viser fiktive lab-data. Gamle screenshots fra før genstart findes ikke længere. Ingen video eller offentlig upload.

Der mangler fuldt produktionsbuild med mere diskplads, PR80-afstemning og komplet kontrol af alle legacy-underruter, integrationspaneler og 200 % zoom. Serveren er stoppet efter checks; kun dette worktrees genererede .next blev slettet for at gemme dokumentation sikkert.

Ingen mails sendt, settings eller knowledge gemt, backend-logik ændret eller deploy udført.

## Fælles skala efter lokalt review

Dashboard, Settings, Customers, Analytics, Integrations, Knowledge og design-lab arver nu samme UI-token på 12/18 px og metadata på 12/16 px. Sidetitler bruger 16/24 px og sektionstitler 14/20 px. Nøgletal beholder deres større roller. Fra 1024 px bruger alle dashboard-sider samme 90 % rem-tæthed; fonttokens på UI og headings er faste px. Mobilfelter beholder 16 px.

| Before | After | Why |
| --- | --- | --- |
| Inbox var 12 px, øvrige sider 13 px | Fælles 12 px UI-token | Samme tekstrolle på tværs af sider |
| Rem-tæthed kun i inbox | Fælles desktop-tæthed | Sidebar og controls skifter ikke størrelse ved navigation |
| Dashboard-kort havde text-lg og Analytics text-base på titler | Fælles section-heading | Samme overskriftshierarki |
| Dashboard-actions overskrev compact-knappens højde | Button size sm ejer h-7 | Samme kompakte control på flere sider |
| Activity-badges blev strakt til hele rækkens højde | self-center | Almindelig badge-højde |

Lint af alle ændrede JSX-filer og separat tsc --noEmit --incremental false er bestået. git diff --check er bestået. Den nye fælles tæthed er endnu ikke visuelt kontrolleret på alle sider, og tidligere mål i tabellen ovenfor er historiske. Produktionsbuild af den seneste revision mangler fortsat. PR80-filerne er stadig undtaget fra lokale overrides. Ingen push, PR eller deploy.

## Snapshot før kortvarianten, 5. oktober 2026

Brugeren har bedt om at pushe den nuværende version først og derefter prøve kort med luft lokalt. Snapshot-listen prioriterer emne, dato, afsender og kundepreview; 76 px rækkehøjde og bredde clamp(16rem, 18vw, 21rem). Ingen avatarer eller ventetidslabels.

Lint, tre preview-tests og separat TypeScript-check er bestået før snapshot. De tilføjede preview-kolonner er kontrolleret mod dev med en forespørgsel, som returnerede nul rækker. Ingen kundedata blev udskrevet. Preview-hentning bruger eksisterende workspace-scope og kun det virtuelle listevindue. Fuld produktionsbuild af den seneste revision mangler fortsat. PR80-filerne er ikke ændret. Ingen PR, merge eller deploy er godkendt.
