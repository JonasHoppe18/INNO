import { describe, expect, it } from "vitest";
import {
  brandDirty,
  brandFromPayload,
  isWorkspaceBrandLogoUrl,
  normalizeAccentColor,
} from "../brand";

const supabaseUrl = "https://abc.supabase.co";
const base = `${supabaseUrl}/storage/v1/object/public/workspace-email-signature-assets`;

describe("normalizeAccentColor", () => {
  it("accepts hex colors and stores them lowercase", () => {
    expect(normalizeAccentColor("#4f46e5")).toBe("#4f46e5");
    expect(normalizeAccentColor(" #FFAA00 ")).toBe("#ffaa00");
  });

  it("treats a blank value as not set", () => {
    expect(normalizeAccentColor("")).toBeNull();
    expect(normalizeAccentColor(null)).toBeNull();
    expect(normalizeAccentColor(undefined)).toBeNull();
  });

  it("rejects anything that is not a six-digit hex color", () => {
    for (const value of ["red", "#fff", "4f46e5", "#4f46e5ff", "#gggggg"]) {
      expect(() => normalizeAccentColor(value)).toThrow("Accent color must be a hex color");
    }
  });
});

describe("isWorkspaceBrandLogoUrl", () => {
  const options = { supabaseUrl, workspaceId: "ws-1" };

  it("accepts a logo in this workspace's brand folder", () => {
    expect(isWorkspaceBrandLogoUrl(`${base}/ws-1/brand/a1.png`, options)).toBe(true);
  });

  it("rejects logos outside this workspace's brand folder", () => {
    expect(isWorkspaceBrandLogoUrl(`${base}/ws-2/brand/a1.png`, options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl(`${base}/ws-1/user-1/a1.png`, options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl(`${supabaseUrl}/storage/v1/object/public/other/ws-1/brand/a1.png`, options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl(`${base}/ws-1/brand/../../ws-2/brand/a1.png`, options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl(`https://evil.example/ws-1/brand/a1.png`, options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl(base.replace("https:", "http:") + "/ws-1/brand/a1.png", options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl("", options)).toBe(false);
    expect(isWorkspaceBrandLogoUrl(`${base}/ws-1/brand/a1.png`, { supabaseUrl, workspaceId: "" })).toBe(false);
  });
});

describe("brand state", () => {
  it("reads the payload with empty strings for missing values", () => {
    expect(brandFromPayload(null)).toEqual({ logoUrl: "", accentColor: "" });
    expect(brandFromPayload({ logo_url: "https://x/y.png", accent_color: "#ABCDEF" }))
      .toEqual({ logoUrl: "https://x/y.png", accentColor: "#abcdef" });
  });

  it("is dirty only when the logo or the color actually changed", () => {
    const initial = { logoUrl: "a", accentColor: "#abcdef" };
    expect(brandDirty(initial, { logoUrl: "a", accentColor: "#ABCDEF" })).toBe(false);
    expect(brandDirty(initial, { logoUrl: "b", accentColor: "#abcdef" })).toBe(true);
    expect(brandDirty(initial, { logoUrl: "a", accentColor: "#000000" })).toBe(true);
  });
});
