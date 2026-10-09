import { describe, expect, it } from "vitest";
import { surveyPreviewSource } from "../satisfaction";

const draft = { subject: "Draft subject", preview_text: "", editor_json: { blocks: [1] } };
const published = { subject: "Live subject", preview_text: "p", editor_json: { blocks: [2] }, rendered_html: "<html>live</html>" };

describe("surveyPreviewSource", () => {
  it("previews the live version customers receive when one is published", () => {
    expect(surveyPreviewSource({ draft, published })).toEqual({
      label: "Live version",
      subject: "Live subject",
      html: "<html>live</html>",
      request: { subject: "Live subject", preview_text: "p", editor_json: { blocks: [2] } },
    });
  });

  it("falls back to the draft before anything is published", () => {
    expect(surveyPreviewSource({ draft, published: null })).toEqual({
      label: "Draft",
      subject: "Draft subject",
      html: "",
      request: { subject: "Draft subject", preview_text: "", editor_json: { blocks: [1] } },
    });
  });

  it("has nothing to preview without a draft", () => {
    expect(surveyPreviewSource({ draft: null, published: null })).toBeNull();
  });
});
