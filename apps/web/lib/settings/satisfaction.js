// What the Settings preview and test send show: the live version customers
// receive when one is published, otherwise the draft.
export function surveyPreviewSource({ draft, published }) {
  const source = published?.id || published?.rendered_html ? published : draft;
  if (!source) return null;
  const isLive = source === published;
  return {
    label: isLive ? "Live version" : "Draft",
    subject: source.subject || "",
    html: isLive ? source.rendered_html || "" : "",
    request: {
      subject: source.subject || "",
      preview_text: source.preview_text || "",
      editor_json: source.editor_json,
    },
  };
}

const DEFAULT_REVIEW_LABEL = "Leave a review";

// Customers see one thank-you message whatever they rate. Ratings are still
// stored in three groups, so happy customers (4–5) can get a review button.
export function thankYouFormFromMessages(messages) {
  const neutral = messages?.neutral || {};
  const positive = messages?.positive || {};
  const reviewUrl = String(positive.button_url || "").trim();
  return {
    heading: String(neutral.heading || ""),
    body: String(neutral.body || ""),
    reviewEnabled: Boolean(reviewUrl),
    reviewLabel: reviewUrl ? String(positive.button_text || "").trim() || DEFAULT_REVIEW_LABEL : DEFAULT_REVIEW_LABEL,
    reviewUrl,
  };
}

export function thankYouMessagesFromForm(form) {
  const shared = {
    heading: String(form?.heading || "").trim(),
    body: String(form?.body || "").trim(),
    button_text: "",
    button_url: "",
  };
  const reviewUrl = form?.reviewEnabled ? String(form.reviewUrl || "").trim() : "";
  return {
    negative: { ...shared },
    neutral: { ...shared },
    positive: reviewUrl
      ? { ...shared, button_text: String(form.reviewLabel || "").trim() || DEFAULT_REVIEW_LABEL, button_url: reviewUrl }
      : { ...shared },
  };
}
