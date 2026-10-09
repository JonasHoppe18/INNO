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
