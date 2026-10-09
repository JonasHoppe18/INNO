import { describe, expect, it } from "vitest";
import { appendMediaPage, formatMediaSize, isLargeMedia, mediaAltText } from "../library";

describe("media library helpers", () => {
  it("formats file sizes for the picker", () => {
    expect(formatMediaSize(800)).toBe("800 B");
    expect(formatMediaSize(23842)).toBe("23 KB");
    expect(formatMediaSize(1572864)).toBe("1.5 MB");
  });

  it("warns about images over 1 MB", () => {
    expect(isLargeMedia(1024 * 1024)).toBe(false);
    expect(isLargeMedia(1024 * 1024 + 1)).toBe(true);
  });

  it("turns a file name into readable alt text", () => {
    expect(mediaAltText("summer-sale_banner.final.png")).toBe("summer sale banner.final");
    expect(mediaAltText("")).toBe("");
  });

  it("appends the next page without repeating images already shown", () => {
    const shown = [{ id: "new" }, { id: "a" }];
    expect(appendMediaPage(shown, [{ id: "a" }, { id: "b" }])).toEqual([{ id: "new" }, { id: "a" }, { id: "b" }]);
  });
});
