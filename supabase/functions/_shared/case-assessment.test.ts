import { assertEquals } from "jsr:@std/assert@1";

import { assessCase } from "./case-assessment.ts";

Deno.test("assessCase extracts Danish multiline replacement shipping address", () => {
  const result = assessCase({
    subject: "Ny adresse til ordre #1048",
    body: `Hej

Jeg har lige opdaget, at adressen på min ordre #1048 er forkert.

Kan I ændre leveringsadressen til:
Jonas Hoppe
Gammel Kongevej 74, 3. th.
1850 Frederiksberg C
Danmark

Det er ordren med Hybrid Dyne.

Mvh
Jonas`,
    matchedSubjectNumber: "1048",
    hasSelectedOrder: true,
  });

  assertEquals(result.entities.address_candidate, {
    name: "Jonas Hoppe",
    address1: "Gammel Kongevej 74, 3. th.",
    address2: "",
    city: "Frederiksberg C",
    zip: "1850",
    country: "Danmark",
    phone: "",
  });
});
