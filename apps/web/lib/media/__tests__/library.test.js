import { describe, expect, it } from "vitest";
import { appendMediaPage, fitPickedImageWidth, formatMediaSize, isLargeMedia, mediaAltText } from "../library";

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

describe("fitPickedImageWidth", () => {
  const content = (image) => ({
    settings: { width: 600 },
    blocks: [{ id: "s", type: "section", children: [[{ id: "p", type: "paragraph" }, { id: "i", type: "image", src: "", width: "full", ...image }]] }],
  });
  const imageOf = (result) => result.content.blocks[0].children[0][1];

  it("gives a newly picked image its own width instead of the full email width", () => {
    const result = fitPickedImageWidth(content({ src: "https://x/logo.png" }), { url: "https://x/logo.png", width: 417 });
    expect(result.changed).toBe(true);
    expect(imageOf(result).width).toBe(417);
  });

  it("keeps full width for images at least as wide as the email", () => {
    const result = fitPickedImageWidth(content({ src: "https://x/banner.png" }), { url: "https://x/banner.png", width: 1200 });
    expect(result.changed).toBe(false);
    expect(imageOf(result).width).toBe("full");
  });

  it("leaves images alone that were already sized or are not the picked one", () => {
    expect(fitPickedImageWidth(content({ src: "https://x/logo.png", width: 200 }), { url: "https://x/logo.png", width: 417 }).changed).toBe(false);
    expect(fitPickedImageWidth(content({ src: "https://x/other.png" }), { url: "https://x/logo.png", width: 417 }).changed).toBe(false);
    expect(fitPickedImageWidth(content({ src: "https://x/logo.png" }), { url: "https://x/logo.png", width: null }).changed).toBe(false);
  });
});
