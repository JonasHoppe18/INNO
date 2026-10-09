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

describe("one thank-you message for every rating", () => {
  it("reads the shared message and the review link of happy customers", async () => {
    const { thankYouFormFromMessages } = await import("../satisfaction");
    const same = { heading: "Thanks!", body: "We read every rating.", button_text: "", button_url: "" };
    expect(thankYouFormFromMessages({
      negative: same,
      neutral: same,
      positive: { ...same, button_text: "Review us", button_url: "https://reviews.test/shop" },
    })).toEqual({ heading: "Thanks!", body: "We read every rating.", reviewEnabled: true, reviewLabel: "Review us", reviewUrl: "https://reviews.test/shop" });
  });

  it("starts from the neutral message when the old pages differ, without a review link", async () => {
    const { thankYouFormFromMessages } = await import("../satisfaction");
    expect(thankYouFormFromMessages({
      negative: { heading: "Sorry", body: "We'll do better.", button_text: "Contact support", button_url: "" },
      neutral: { heading: "Thank you for your feedback", body: "We appreciate it.", button_text: "", button_url: "" },
      positive: { heading: "Yay", body: "Glad we helped.", button_text: "Visit our store", button_url: "" },
    })).toEqual({ heading: "Thank you for your feedback", body: "We appreciate it.", reviewEnabled: false, reviewLabel: "Leave a review", reviewUrl: "" });
  });

  it("writes the same message to every rating and the review button only for happy customers", async () => {
    const { thankYouMessagesFromForm } = await import("../satisfaction");
    const messages = thankYouMessagesFromForm({ heading: " Thanks! ", body: "Noted.", reviewEnabled: true, reviewLabel: "", reviewUrl: " https://reviews.test " });
    expect(messages.negative).toEqual({ heading: "Thanks!", body: "Noted.", button_text: "", button_url: "" });
    expect(messages.neutral).toEqual(messages.negative);
    expect(messages.positive).toEqual({ heading: "Thanks!", body: "Noted.", button_text: "Leave a review", button_url: "https://reviews.test" });
    expect(thankYouMessagesFromForm({ heading: "A", body: "B", reviewEnabled: false, reviewLabel: "X", reviewUrl: "https://x.test" }).positive.button_url).toBe("");
  });
});
