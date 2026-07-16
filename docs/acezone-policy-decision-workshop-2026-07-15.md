# ACEZONE × Sona — policy decision workshop

**Dato:** 2026-07-15
**Status:** Beslutningsgrundlag, ikke godkendt policy
**Effektiv action-grænse indtil godkendelse:** 0 DKK og ingen autonome mutationer

## Formål

Sona kan ikke svare korrekt på næsten alle henvendelser ved at kopiere historiske medarbejdersvar. Historikken viser, hvad en medarbejder gjorde i en konkret sag; den beviser ikke, hvad ACEZONE ønsker som gældende regel i dag.

Dette dokument omsætter 3.713 PII-scrubbede Zendesk-eksempler og de aktive knowledge-kilder til konkrete ejervalg. Kandidattallene er regex-screenede og overlapper. De gamle eksempler er ofte fejlankrede og mangler dato og medarbejderidentitet. Mønstrene nedenfor er derfor beslutningsinput, aldrig automatisk sandhed.

Ingen af de ni områder har i dag en entydig policy med navngiven ejer, ikrafttrædelsesdato og reviewdato. De aktive kilder modsiger desuden hinanden på flere risikofyldte områder.

## Prioriteret beslutningsrækkefølge

1. Sonas økonomiske og operationelle myndighed
2. Fradrag ved åbnede produkter
3. Tredjepartskøb og Amazon
4. Revner og borderline warranty
5. Repair-flow og omkostningsansvar
6. Leveret-men-mangler
7. Rabat efter køb
8. Mistet/ekstra dongle
9. Invoice/receipt

De første fem kan direkte skabe økonomiske, juridiske eller irreversible fejl.

## Beslutningskontrakt

Hver godkendt regel skal minimum have:

- `decision_id` og versionsnummer;
- ejer og godkender;
- ikrafttrædelses- og reviewdato;
- produkter, lande, valutaer og købskanaler i scope;
- nødvendige live facts og dokumentation;
- maskinlæsbare udfald og forbudte løfter;
- `auto_execute`, `human_approve` eller `prohibited`;
- beløbs-, antal- og frekvensgrænser;
- fallback ved manglende data eller tool-fejl;
- mindst én positiv, negativ og grænsetilfælde-regressionstest.

## 1. Normal-use cracks og borderline warranty

**Historisk evidens:** 126 kandidater; 92 relevante svar. 50 bad om billeder/købsbevis, 35 tilbød replacement, 21 gik mod repair/send-in, 17 beskrev positiv dækning og 10 nævnte betaling. Næsten ingen tydelige afslag.

**Konflikt:** A-Spire-guiden åbner for dækning af revner ved normal brug på en fejlbehæftet batch, men kræver review. Den generelle warrantytekst dækker produktionsfejl og undtager slitage/misbrug.

**ACEZONE skal vælge:**

- `normal_use_crack = presumed_covered | review_required | paid_repair | denied`
- modeller/batches, produktalder, region og købskanal;
- obligatoriske billeder, serienummer og købsbevis;
- `remedy = replacement | repair | case_by_case`;
- om Sona må godkende eller kun indsamle og eskalere.

**Midlertidig sikker regel:** Indsaml evidens, lov aldrig dækning eller løsning, og send til review.

## 2. Mistet, defekt eller ekstra dongle/receiver

**Historisk evidens:** 41 højpræcisionskandidater; 34 relevante svar, heraf kun 18 entydigt om en mistet dongle. Syv tilbød gratis spare, fem pegede mod salg/pris, seks kontrollerede warranty og tre brugte manuel office-fulfilment.

**Konflikt:** En arkiveret tekst siger gratis spare under warranty og sales-løsning uden warranty. Der findes ingen aktiv regel for tab, kompatibilitet, lager eller pris. Historikken blander tab og defekt.

**ACEZONE skal vælge:**

- separate udfald for `lost`, `defective` og `extra`;
- `lost = paid_spare | one_time_goodwill | unavailable`;
- kompatible dongle-SKU'er pr. headset;
- pris, moms, valuta og fragt pr. land;
- lagerets source of truth og out-of-stock-flow;
- hvem der må udføre office-fulfilment.

**Midlertidig sikker regel:** Bekræft model og problemtype; ingen pris, lager- eller gratisløfter uden live source og approval.

## 3. Leveret, men mangler / forkert leveringsfoto

**Historisk evidens:** 19 kandidater; 11 relevante svar. Fem gik mod replacement/refund, to mod ACEZONE/carrier-investigation, én bad kunden kontakte carrier og to bad om adresse/foto/signaturbevis. Intet stabilt standardflow.

**Konflikt:** Den publicerede shippingtekst placerer risikoen hos ACEZONE indtil fysisk overdragelse, men definerer ikke delivered-scan, forkert foto, carrier claim eller resolutionstidspunkt.

**ACEZONE skal vælge:**

- obligatorisk lokal kontrol og eventuel ventetid;
- hvornår forkert leveringsfoto er tilstrækkeligt bevis;
- hvem der åbner carrier-sagen;
- accepteret carrier- og kundedokumentation;
- `resolution = replacement | refund | wait_for_claim`;
- SLA, regionsforskelle og fraud/declaration-flow.

**Midlertidig sikker regel:** Sona må samle fakta og starte en menneskegodkendt undersøgelse, men ikke love refund/replacement.

## 4. Rabatter, streamer-koder og prisfald efter køb

**Historisk evidens:** 207 brede discount-kandidater, men kun 12 klare post-purchase-sager og ni relevante svar. I det brede sæt sagde otte ingen stacking, syv afviste retroaktiv kode, fire gav prisdifference/partial refund og 14 eskalerede. Intet dominerende udfald.

**Konflikt:** Aktuel viden forbyder uverificerede creator/B2B-løfter, men der findes ingen forbrugerregel for prisfald eller glemt kode efter køb.

**ACEZONE skal vælge:**

- `post_purchase_price_drop = deny | refund_difference | cancel_and_reorder | return_and_reorder`;
- eventuelt tidsvindue;
- kodeprioritet, stacking og udløb;
- ejer af streamer-koder;
- goodwill-cap pr. ordre og kunde;
- lande, kanaler og approval-krav.

**Midlertidig sikker regel:** Ingen retroaktiv rabat eller prisdifference uden en godkendt regel og live ordrefakta.

## 5. Invoice og receipt resend

**Historisk evidens:** 102 kandidater; 42 relevante svar. 37 sendte/vedhæftede dokumentet, 20 bad om ordre-, firma- eller VAT-data, tre pegede mod confirmation/self-service og én til finance. Direkte support-ejerskab ser ud til at være den nyere praksis, men datoer mangler.

**Konflikt:** Ingen aktiv guide fastslår dokumenttype, source of truth, identitetskontrol eller hvem der må ændre VAT-oplysninger.

**ACEZONE skal vælge:**

- `invoice_owner = sona_shopify | support | finance`;
- kilde: Shopify, payment provider eller accounting;
- forskel på receipt, commercial invoice og VAT invoice;
- hvilke firma-/VAT-felter der må ændres efter køb;
- identitetskontrol og tilladt modtageradresse;
- om Sona må generere, vedhæfte og sende dokumentet.

**Midlertidig sikker regel:** Klassificér separat fra `other`; kræv ordre-match og menneskelig handling.

## 6. Tredjepartskøb

**Historisk evidens:** 115 kandidater; 49 relevante svar. 16 viste ACEZONE som direkte handler, fem dirigerede til seller/place of purchase, tre krævede proof of purchase og én afviste dækning.

**Konflikt:** De aktive kilder siger på skift regional distributor, place of purchase, ingen ACEZONE-warranty, direkte ACEZONE-håndtering af webshop og Amazon eller særskilt Amazon-afklaring.

**ACEZONE skal godkende en matrix for:**

- egen webshop;
- Amazon solgt af ACEZONE;
- Amazon marketplace-seller;
- autoriseret reseller/distributor;
- uautoriseret reseller;
- second-hand, refurbished og præmier.

For hver kanal kræves udfald for ordinary return, warranty, paid repair, proof of purchase, fragtansvar og præcis routing.

**Midlertidig sikker regel:** Ingen eligibility-konklusion, før købskanal, sælger, land og request type er kendt; alle tredjepartssager til review.

## 7. Åbnede produkter og refund deduction

**Historisk evidens:** 118 kandidater; 80 relevante svar. 28 accepterede return, 29 krævede inspektion, 25 nævnte fradrag, 24 sagde case-by-case, 22 nævnte rengøring/sanitation, 21 diminished value, fem lovede fuld refund og én afviste return. Ingen historiske svar i kohorten brugte et fast EUR 50-fradrag.

**Kritisk konflikt:** Den publicerede warranty/returns-side siger ét sted fast EUR 50-fradrag og umiddelbart efter individuel vurdering uden fast beløb. Den aktive interne guide siger intet fast beløb før inspektion.

**ACEZONE skal vælge:**

- `opened_deduction = fixed_EUR_50 | documented_case_by_case | full_refund_if_criteria`;
- tilladt test/brug og emballagekrav;
- inspektionscheckliste;
- rengøring, earpads og komponentfradrag;
- hvem der godkender beløbet;
- præcis formulering før inspektion;
- refund-frist og regionsspecifik lovgivning.

**Midlertidig sikker regel:** Beskriv kun, at produktet inspiceres, og at et dokumenteret værdiforringelsesfradrag kan forekomme. Intet beløb eller endeligt refund-løfte før inspektion.

## 8. Repair intake, turnaround og staffing

**Historisk evidens:** 796 brede kandidater; 417 relevante svar. 215 bad om evidens/købsbevis, 98 nævnte pris/quote, 67 gik mod replacement, 53 lod kunden sende selv, 27 nævnte prepaid label og 15 brugte midlertidig technician/staff-availability. Intet stabilt turnaround kunne udledes.

**Konflikt:** A-Rise-guiden kræver samlet evidens og kontaktdata før quote/shipping, men kilderne modsiger hinanden om purchase channel, warranty, repairbetaling, fragt og label. Andre produkter følger ofte swap/review i stedet for repair.

**ACEZONE skal vælge:**

- produktmatrix for A-Rise, A-Spire og A-Blaze;
- eligibility og purchase-channel-regler;
- obligatoriske billeder, kontaktdata og købsbevis;
- hvem der betaler repair, fragt og import;
- prepaid label eller kundebooket fragt;
- SLA-intervaller og update cadence;
- et live capacity-felt for technician/staffing.

**Midlertidig sikker regel:** Midlertidig medarbejdertilgængelighed må aldrig ligge som statisk knowledge. Sona må indsamle intake-data, men ikke love pris, label eller turnaround.

## 9. Sonas økonomiske og operationelle myndighed

**Historisk evidens:** Svag og ikke handlingsverificeret. Korpuset har 216 approval/escalation-omtaler, 169 label-omtaler, 57 replacement-løfter, 29 refund-løfter, 36 discounts/credits, 14 goodwill, otte påståede cancellations og fem påståede refunds. Tekst beviser ikke, at handlingen blev udført.

**Konflikt:** Aktive guides siger overvejende, at Sona ikke må love eller udføre automatisk. Den fulde idempotente action/send-orchestrator findes endnu ikke.

**ACEZONE skal udfylde en authority-matrix for:**

- refund og partial refund;
- discount/goodwill;
- replacement og spare parts;
- return label;
- cancel og address change;
- return og exchange.

For hver handling kræves maksimal værdi, antal, fragtomkostning, lande, produkter, salgskanaler, live facts, risikoflag, frekvensgrænse og `auto_execute | human_approve | prohibited`. Kundeløfter før og efter execution skal defineres separat.

**Midlertidig sikker regel:** Alle mutationer og økonomiske løfter er review-only.

## Godkendelsesskabelon

For hver sektion udfyldes:

- **Valgt udfald:**
- **Undtagelser:**
- **Ejer:**
- **Godkender:**
- **Ikrafttrædelsesdato:**
- **Reviewdato:**
- **Produkter/lande/kanaler:**
- **Maksimal myndighed:**
- **Påkrævede live facts:**
- **Tilladte kundeløfter:**
- **Forbudte kundeløfter:**
- **Fallback/escalation:**
- **Regression-cases godkendt af:**

Først når en sektion er godkendt, versioneret, lagt ind som kanonisk knowledge og dækket af regressionstests, kan dens intent begynde en shadow/no-edit-måling mod autonomi-gaten.
