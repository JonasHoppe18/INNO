import { describe, expect, it } from "vitest";
import {
  getActiveSectionId,
  parseKnowledgeDocumentOutline,
  sectionAnchorId,
} from "../knowledge-doc-outline.js";

describe("parseKnowledgeDocumentOutline", () => {
  it("extracts H2 headings in order with stable anchor ids", () => {
    const markdown = [
      "# A-Blaze — Product Support",
      "",
      "## Product overview",
      "",
      "Some text.",
      "",
      "### Not a section",
      "",
      "## Cable and adapter compatibility",
    ].join("\n");

    expect(parseKnowledgeDocumentOutline(markdown)).toEqual([
      { id: "knowledge-doc-section-0", index: 0, title: "Product overview" },
      { id: "knowledge-doc-section-1", index: 1, title: "Cable and adapter compatibility" },
    ]);
  });

  it("ignores H1 and H3 headings", () => {
    const markdown = "# Title\n### Subsection\nBody text";
    expect(parseKnowledgeDocumentOutline(markdown)).toEqual([]);
  });

  it("returns an empty array for empty or missing markdown", () => {
    expect(parseKnowledgeDocumentOutline("")).toEqual([]);
    expect(parseKnowledgeDocumentOutline(undefined)).toEqual([]);
  });

  it("ignores a heading marker with no title text", () => {
    expect(parseKnowledgeDocumentOutline("## \nBody")).toEqual([]);
  });
});

describe("sectionAnchorId", () => {
  it("builds a stable, index-based anchor id", () => {
    expect(sectionAnchorId(0)).toBe("knowledge-doc-section-0");
    expect(sectionAnchorId(3)).toBe("knowledge-doc-section-3");
  });
});

describe("getActiveSectionId", () => {
  const sectionTops = [
    { id: "knowledge-doc-section-0", top: 0 },
    { id: "knowledge-doc-section-1", top: 400 },
    { id: "knowledge-doc-section-2", top: 900 },
  ];

  it("returns the first section before any scrolling has happened", () => {
    expect(getActiveSectionId({ sectionTops, scrollTop: 0, offset: 32 })).toBe(
      "knowledge-doc-section-0",
    );
  });

  it("returns the last section whose top is within the scroll threshold", () => {
    expect(getActiveSectionId({ sectionTops, scrollTop: 420, offset: 32 })).toBe(
      "knowledge-doc-section-1",
    );
  });

  it("returns the final section once scrolled past its top", () => {
    expect(getActiveSectionId({ sectionTops, scrollTop: 1000, offset: 0 })).toBe(
      "knowledge-doc-section-2",
    );
  });

  it("returns null when there are no sections", () => {
    expect(getActiveSectionId({ sectionTops: [], scrollTop: 0 })).toBeNull();
  });

  it("is resilient to unsorted input", () => {
    const shuffled = [sectionTops[2], sectionTops[0], sectionTops[1]];
    expect(getActiveSectionId({ sectionTops: shuffled, scrollTop: 420, offset: 32 })).toBe(
      "knowledge-doc-section-1",
    );
  });
});
