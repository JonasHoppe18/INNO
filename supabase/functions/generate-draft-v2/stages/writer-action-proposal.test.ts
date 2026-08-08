import { assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildActionProposalDirective,
} from "./writer.ts";

Deno.test("planned address change gets customer-ready copy guidance", () => {
  const directive = buildActionProposalDirective([{
    type: "update_shipping_address",
    confidence: "high",
    reason: "Ordren er ikke afsendt — adressen kan ændres",
    params: {
      order_name: "#1061",
      shipping_address: {
        address1: "Frederiksberg Allé 22",
        address2: "4. th.",
        zip: "1820",
        city: "Frederiksberg C",
      },
    },
    requires_approval: true,
  }]);

  assertStringIncludes(directive, "Ny leveringsadresse: Frederiksberg Allé 22, 4. th., 1820, Frederiksberg C");
  assertStringIncludes(directive, "sørger for at ændre leveringsadressen");
  assertStringIncludes(directive, "Gentag ikke den gamle adresse");
});

Deno.test("planned cancellation gets concise, safe copy guidance", () => {
  const directive = buildActionProposalDirective([{
    type: "cancel_order",
    confidence: "high",
    reason: "Kunden ønsker annullering og ordren er endnu ikke afsendt",
    params: { order_name: "#1054" },
    requires_approval: true,
  }]);

  assertStringIncludes(directive, "Ordre: #1054");
  assertStringIncludes(directive, "sørger for at annullere ordren");
  assertStringIncludes(directive, "Lov ikke refundering");
  assertStringIncludes(directive, "Lov ikke at give en senere besked");
});

Deno.test("non-customer-facing proposals do not add action copy guidance", () => {
  const directive = buildActionProposalDirective([{
    type: "add_note",
    confidence: "high",
    reason: "Internal note",
    params: {},
    requires_approval: true,
  }]);

  if (directive !== "") throw new Error("unexpected action copy guidance");
});
