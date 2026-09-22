// Synthetic regression fixture based on the reported shape. It contains no
// customer or production data.
export const ACEZONE_QUOTED_REPLY_FIXTURE = {
  text: [
    "I still need help with the replacement.",
    "font-family: Arial; mso-line-height-rule: exactly;",
    "Old Zendesk history should not be current text.",
  ].join("\n"),
  html: [
    "<div><p>I still need help with the replacement.</p></div>",
    "<div class=\"gmail_quote\"><style>.legacy { color: red; }</style>",
    "<p>Old Zendesk history should not be current text.</p></div>",
  ].join(""),
  hasReplyHeaders: true,
};
