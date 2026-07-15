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
