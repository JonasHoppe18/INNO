import { assertEquals } from "jsr:@std/assert@1";
import { parsePartialAddressCorrection } from "./pipeline.ts";

Deno.test("clears address2 when the customer asks to remove line-2 junk", () => {
  const r = parsePartialAddressCorrection(
    'There is a "7 1tv" on address line 2 or something like that it has to be removed',
    {
      first_name: "Simon",
      last_name: "Boutrup",
      address1: "Testvej 5",
      address2: "7 1tv",
      zip: "2100",
      city: "København",
      country: "Denmark",
    },
  );
  assertEquals(r?.address1, "Testvej 5");
  assertEquals(r?.address2, null);
  assertEquals(r?.zip, "2100");
  assertEquals(r?.city, "København");
});

Deno.test("returns null when no order shipping address exists to correct", () => {
  assertEquals(parsePartialAddressCorrection("remove line 2", {}), null);
});

Deno.test("returns null when the correction can't be localised to a field", () => {
  assertEquals(
    parsePartialAddressCorrection("something is wrong with my address", {
      address1: "Testvej 5",
      zip: "2100",
      city: "København",
      country: "Denmark",
    }),
    null,
  );
});
