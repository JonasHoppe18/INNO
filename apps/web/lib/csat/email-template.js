export const CSAT_EMAIL_TEMPLATE_VERSION = 1;

export const CSAT_PALETTE_BLOCKS = [
  "section",
  "title",
  "paragraph",
  "image",
  "button",
  "divider",
  "spacer",
  "custom:csat-rating",
];

export const CSAT_VARIABLES = [
  {
    label: "Customer first name",
    value: "{{customer.first_name}}",
    sample: "Alex",
    group: "Customer",
  },
  {
    label: "Customer full name",
    value: "{{customer.full_name}}",
    sample: "Alex Johnson",
    group: "Customer",
  },
  {
    label: "Customer email",
    value: "{{customer.email}}",
    sample: "alex@example.com",
    group: "Customer",
  },
  {
    label: "Store name",
    value: "{{store.name}}",
    sample: "Demo Store",
    group: "Store",
  },
  {
    label: "Store URL",
    value: "{{store.url}}",
    sample: "https://demo.example.com",
    group: "Store",
  },
  {
    label: "Conversation subject",
    value: "{{conversation.subject}}",
    sample: "A question about my order",
    group: "Conversation",
  },
  {
    label: "Agent name",
    value: "{{conversation.agent_name}}",
    sample: "Sona",
    group: "Conversation",
  },
  {
    label: "Order number",
    value: "{{order.number}}",
    sample: "#1054",
    group: "Order",
    description: "Optional. It stays blank when no order is available.",
  },
];

export const CSAT_VARIABLE_VALUES = [
  "customer.first_name",
  "customer.full_name",
  "customer.email",
  "store.name",
  "store.url",
  "conversation.subject",
  "conversation.agent_name",
  "order.number",
  "csat.rating_url_1",
  "csat.rating_url_2",
  "csat.rating_url_3",
  "csat.rating_url_4",
  "csat.rating_url_5",
];

export const CSAT_SAMPLE_DATA = {
  customer: {
    first_name: "Alex",
    full_name: "Alex Johnson",
    email: "alex@example.com",
  },
  store: {
    name: "Demo Store",
    url: "https://demo.example.com",
  },
  conversation: {
    subject: "A question about my order",
    agent_name: "Sona",
  },
  order: {
    number: "#1054",
  },
};

const spacing = (top = 16, right = 24, bottom = 16, left = 24) => ({
  top,
  right,
  bottom,
  left,
});

export const CSAT_RATING_BLOCK_DEFINITION = {
  type: "csat-rating",
  name: "CSAT Rating",
  description: "Collect a secure 1–5 customer satisfaction score.",
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 14.5c1.1 1.2 2.4 1.8 4 1.8s2.9-.6 4-1.8M8.5 9.5h.01M15.5 9.5h.01" stroke-linecap="round"/></svg>',
  fields: [
    {
      key: "question",
      label: "Question",
      type: "textarea",
      default: "How was your experience?",
      required: true,
    },
    {
      key: "scale",
      label: "Scale",
      type: "number",
      default: 5,
      min: 5,
      max: 5,
      step: 1,
      readOnly: true,
    },
    {
      key: "ratingStyle",
      label: "Style",
      type: "select",
      default: "emoji",
      options: [
        { label: "Emoji", value: "emoji" },
        { label: "Numbers", value: "numbers" },
        { label: "Stars", value: "stars" },
      ],
    },
    {
      key: "alignment",
      label: "Alignment",
      type: "select",
      default: "center",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
    {
      key: "textColor",
      label: "Text color",
      type: "color",
      default: "#172033",
    },
    {
      key: "ratingColor",
      label: "Rating color",
      type: "color",
      default: "#f59e0b",
    },
    {
      key: "size",
      label: "Size",
      type: "select",
      default: "28px",
      options: [
        { label: "Small", value: "22px" },
        { label: "Medium", value: "28px" },
        { label: "Large", value: "36px" },
      ],
    },
    ...[1, 2, 3, 4, 5].map((score) => ({
      key: `ratingUrl${score}`,
      label: `Score ${score} link`,
      type: "text",
      readOnly: true,
      default: `#sona-csat-preview-score-${score}`,
    })),
  ],
  defaultStyles: {
    padding: spacing(20, 24, 20, 24),
  },
  template: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="{{ alignment }}" style="text-align: {{ alignment }}; font-family: Arial, sans-serif;">
          <p style="margin: 0 0 14px; color: {{ textColor }}; font-size: 18px; line-height: 1.4; font-weight: 600;">
            {{ question }}
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="{{ alignment }}">
            <tr>
              <td style="padding: 0 4px;">
                <a href="{{ ratingUrl1 }}" style="display: inline-block; color: {{ ratingColor }}; text-decoration: none; font-size: {{ size }}; line-height: 1;">{% if ratingStyle == "emoji" %}😡{% elsif ratingStyle == "stars" %}★{% else %}1{% endif %}</a>
              </td>
              <td style="padding: 0 4px;">
                <a href="{{ ratingUrl2 }}" style="display: inline-block; color: {{ ratingColor }}; text-decoration: none; font-size: {{ size }}; line-height: 1;">{% if ratingStyle == "emoji" %}🙁{% elsif ratingStyle == "stars" %}★{% else %}2{% endif %}</a>
              </td>
              <td style="padding: 0 4px;">
                <a href="{{ ratingUrl3 }}" style="display: inline-block; color: {{ ratingColor }}; text-decoration: none; font-size: {{ size }}; line-height: 1;">{% if ratingStyle == "emoji" %}😐{% elsif ratingStyle == "stars" %}★{% else %}3{% endif %}</a>
              </td>
              <td style="padding: 0 4px;">
                <a href="{{ ratingUrl4 }}" style="display: inline-block; color: {{ ratingColor }}; text-decoration: none; font-size: {{ size }}; line-height: 1;">{% if ratingStyle == "emoji" %}🙂{% elsif ratingStyle == "stars" %}★{% else %}4{% endif %}</a>
              </td>
              <td style="padding: 0 4px;">
                <a href="{{ ratingUrl5 }}" style="display: inline-block; color: {{ ratingColor }}; text-decoration: none; font-size: {{ size }}; line-height: 1;">{% if ratingStyle == "emoji" %}😍{% elsif ratingStyle == "stars" %}★{% else %}5{% endif %}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `,
};

function csatRatingFields({ linkMode = "preview", token = "" } = {}) {
  return Object.fromEntries(
    [1, 2, 3, 4, 5].map((score) => [
      `ratingUrl${score}`,
      linkMode === "live"
        ? `{{csat.rating_url_${score}}}`
        : linkMode === "markers"
          ? `[[SONA_CSAT_RATING_URL_${score}]]`
          : `#sona-csat-${token ? "token" : "preview"}-score-${score}`,
    ])
  );
}

export function createDefaultCsatEmailContent({ linkMode = "preview" } = {}) {
  return {
    blocks: [
      {
        id: "csat-section-1",
        type: "section",
        columns: "1",
        styles: {
          padding: spacing(32, 32, 32, 32),
          backgroundColor: "#ffffff",
        },
        children: [
          [
            {
              id: "csat-title-1",
              type: "title",
              level: 1,
              content: "We'd love your feedback",
              textAlign: "center",
              styles: { padding: spacing(6, 0, 10, 0) },
            },
            {
              id: "csat-paragraph-1",
              type: "paragraph",
              content:
                "<p style=\"text-align: center;\">Hi {{customer.first_name}},</p><p style=\"text-align: center;\">How did we do? Your feedback helps {{store.name}} improve every support experience.</p>",
              styles: { padding: spacing(0, 0, 18, 0) },
            },
            {
              id: "csat-rating-1",
              type: "custom",
              customType: "csat-rating",
              fieldValues: {
                question: "How was your experience?",
                scale: 5,
                ratingStyle: "emoji",
                alignment: "center",
                textColor: "#172033",
                ratingColor: "#f59e0b",
                size: "28px",
                ...csatRatingFields({ linkMode }),
              },
              styles: { padding: spacing(0, 0, 12, 0) },
            },
            {
              id: "csat-divider-1",
              type: "divider",
              lineStyle: "solid",
              color: "#e5e7eb",
              thickness: 1,
              width: "full",
              styles: { padding: spacing(14, 0, 14, 0) },
            },
            {
              id: "csat-footer-1",
              type: "paragraph",
              content: "<p style=\"text-align: center; color: #64748b; font-size: 13px;\">Thanks for helping us get better.</p>",
              styles: { padding: spacing(0, 0, 4, 0) },
            },
          ],
        ],
      },
    ],
    settings: {
      width: 600,
      backgroundColor: "#f3f4f6",
      textColor: "#172033",
      linkUnderline: true,
      fontFamily: "Arial, sans-serif",
      locale: "en",
    },
  };
}

export function getCsatRatingFields(fieldValues = {}) {
  return {
    question: String(fieldValues.question || "How was your experience?").slice(0, 500),
    scale: 5,
    ratingStyle: ["emoji", "numbers", "stars"].includes(fieldValues.ratingStyle)
      ? fieldValues.ratingStyle
      : "emoji",
    alignment: ["left", "center", "right"].includes(fieldValues.alignment)
      ? fieldValues.alignment
      : "center",
    textColor: normalizeHexColor(fieldValues.textColor, "#172033"),
    ratingColor: normalizeHexColor(fieldValues.ratingColor, "#f59e0b"),
    size: ["22px", "28px", "36px"].includes(String(fieldValues.size))
      ? String(fieldValues.size)
      : fieldValues.size === "lg"
        ? "36px"
        : fieldValues.size === "sm"
          ? "22px"
          : "28px",
    ...Object.fromEntries(
      [1, 2, 3, 4, 5].map((score) => [
        `ratingUrl${score}`,
        String(fieldValues[`ratingUrl${score}`] || `#sona-csat-preview-score-${score}`),
      ])
    ),
  };
}

export function normalizeHexColor(value, fallback) {
  const candidate = String(value || "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(candidate) ? candidate : fallback;
}

export function getVariablePath(value) {
  const match = String(value || "").match(/^{{\s*([a-z0-9_.]+)\s*}}$/i);
  return match ? match[1].toLowerCase() : null;
}

export function getCsatGroup(score) {
  const numericScore = Number(score);
  if (numericScore <= 2) return "negative";
  if (numericScore === 3) return "neutral";
  if (numericScore >= 4 && numericScore <= 5) return "positive";
  return null;
}
