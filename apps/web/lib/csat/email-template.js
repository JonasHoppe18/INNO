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
    },
    {
      key: "leftLabel",
      label: "Low score label",
      type: "text",
      default: "Very poor",
    },
    {
      key: "rightLabel",
      label: "High score label",
      type: "text",
      default: "Excellent",
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
      key: "ratingBorderColor",
      label: "Rating border",
      type: "color",
      default: "#e5e7eb",
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
          {% if question != "" %}<p style="margin: 0 0 14px; color: {{ textColor }}; font-size: 18px; line-height: 1.4; font-weight: 600;">
            {{ question }}
          </p>{% endif %}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="{{ alignment }}" style="max-width: 400px; table-layout: fixed;">
            <tr>
              <td width="20%" style="padding: 0 4px;">
                <a href="{{ ratingUrl1 }}" style="display: block; width: 100%; max-width: 64px; height: 64px; box-sizing: border-box; margin: 0 auto; border: 1px solid {{ ratingBorderColor }}; border-radius: 50%; color: {{ ratingColor }}; text-align: center; text-decoration: none; font-size: {{ size }}; line-height: 62px;">{% if ratingStyle == "emoji" %}😡{% elsif ratingStyle == "stars" %}★{% else %}1{% endif %}</a>
              </td>
              <td width="20%" style="padding: 0 4px;">
                <a href="{{ ratingUrl2 }}" style="display: block; width: 100%; max-width: 64px; height: 64px; box-sizing: border-box; margin: 0 auto; border: 1px solid {{ ratingBorderColor }}; border-radius: 50%; color: {{ ratingColor }}; text-align: center; text-decoration: none; font-size: {{ size }}; line-height: 62px;">{% if ratingStyle == "emoji" %}🙁{% elsif ratingStyle == "stars" %}★{% else %}2{% endif %}</a>
              </td>
              <td width="20%" style="padding: 0 4px;">
                <a href="{{ ratingUrl3 }}" style="display: block; width: 100%; max-width: 64px; height: 64px; box-sizing: border-box; margin: 0 auto; border: 1px solid {{ ratingBorderColor }}; border-radius: 50%; color: {{ ratingColor }}; text-align: center; text-decoration: none; font-size: {{ size }}; line-height: 62px;">{% if ratingStyle == "emoji" %}😐{% elsif ratingStyle == "stars" %}★{% else %}3{% endif %}</a>
              </td>
              <td width="20%" style="padding: 0 4px;">
                <a href="{{ ratingUrl4 }}" style="display: block; width: 100%; max-width: 64px; height: 64px; box-sizing: border-box; margin: 0 auto; border: 1px solid {{ ratingBorderColor }}; border-radius: 50%; color: {{ ratingColor }}; text-align: center; text-decoration: none; font-size: {{ size }}; line-height: 62px;">{% if ratingStyle == "emoji" %}🙂{% elsif ratingStyle == "stars" %}★{% else %}4{% endif %}</a>
              </td>
              <td width="20%" style="padding: 0 4px;">
                <a href="{{ ratingUrl5 }}" style="display: block; width: 100%; max-width: 64px; height: 64px; box-sizing: border-box; margin: 0 auto; border: 1px solid {{ ratingBorderColor }}; border-radius: 50%; color: {{ ratingColor }}; text-align: center; text-decoration: none; font-size: {{ size }}; line-height: 62px;">{% if ratingStyle == "emoji" %}😍{% elsif ratingStyle == "stars" %}★{% else %}5{% endif %}</a>
              </td>
            </tr>
            <tr>
              <td width="20%" align="left" style="padding: 14px 4px 0; color: {{ textColor }}; font-size: 14px; line-height: 1.3; white-space: nowrap;">{{ leftLabel }}</td>
              <td colspan="3"></td>
              <td width="20%" align="right" style="padding: 14px 4px 0; color: {{ textColor }}; font-size: 14px; line-height: 1.3; white-space: nowrap;">{{ rightLabel }}</td>
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
          padding: spacing(30, 32, 30, 32),
          backgroundColor: "#ffffff",
        },
        children: [
          [
            {
              id: "csat-title-1",
              type: "title",
              level: 1,
              content: "How was your support experience?",
              textAlign: "center",
              styles: { padding: spacing(0, 0, 14, 0) },
            },
            {
              id: "csat-paragraph-1",
              type: "paragraph",
              content:
                "<p style=\"text-align: center; color: #737373; font-size: 26px; line-height: 1.35;\">We'd love to hear how we did. Your feedback helps us make every reply better.</p>",
              styles: { padding: spacing(0, 0, 24, 0) },
            },
            {
              id: "csat-rating-1",
              type: "custom",
              customType: "csat-rating",
              fieldValues: {
                question: "",
                scale: 5,
                leftLabel: "Very poor",
                rightLabel: "Excellent",
                ratingStyle: "numbers",
                alignment: "center",
                textColor: "#737373",
                ratingColor: "#737373",
                ratingBorderColor: "#e5e7eb",
                size: "28px",
                ...csatRatingFields({ linkMode }),
              },
              styles: { padding: spacing(0, 0, 42, 0) },
            },
            {
              id: "csat-footer-1",
              type: "paragraph",
              content: "<p style=\"text-align: center; color: #a3a3a3; font-size: 14px; line-height: 1.45;\">You're receiving this because your support conversation was resolved.</p>",
              styles: { padding: spacing(0, 0, 0, 0) },
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

function updateDefaultTemplateCopy(content, { title, intro, footer, backgroundColor = "#f3f4f6" }) {
  const section = content.blocks[0];
  const [titleBlock, introBlock, ratingBlock, footerBlock] = section.children[0];
  if (title !== undefined) titleBlock.content = title;
  if (intro !== undefined) introBlock.content = `<p style="text-align: center; color: #737373; font-size: 26px; line-height: 1.35;">${intro}</p>`;
  if (footer !== undefined) footerBlock.content = `<p style="text-align: center; color: #a3a3a3; font-size: 14px; line-height: 1.45;">${footer}</p>`;
  section.styles.backgroundColor = "#ffffff";
  content.settings.backgroundColor = backgroundColor;
  return content;
}

export function createMinimalCsatEmailContent({ linkMode = "preview" } = {}) {
  return updateDefaultTemplateCopy(createDefaultCsatEmailContent({ linkMode }), {
    title: "How did we do?",
    intro: "A quick rating helps us make every reply better.",
    footer: "Thanks for helping us improve.",
    backgroundColor: "#f8f8fb",
  });
}

export function createPersonalCsatEmailContent({ linkMode = "preview" } = {}) {
  return updateDefaultTemplateCopy(createDefaultCsatEmailContent({ linkMode }), {
    title: "Could you share your experience?",
    intro: "Hi {{customer.first_name}}, we'd love to know how your support experience felt.",
    footer: "You're receiving this because your support conversation was resolved.",
    backgroundColor: "#f7f5ff",
  });
}

export function createBlankCsatEmailContent() {
  return {
    blocks: [
      {
        id: "csat-section-blank-1",
        type: "section",
        columns: "1",
        styles: {
          padding: spacing(24, 24, 24, 24),
          backgroundColor: "#ffffff",
        },
        children: [[]],
      },
    ],
    settings: {
      width: 600,
      backgroundColor: "#f8f8fb",
      textColor: "#172033",
      linkUnderline: true,
      fontFamily: "Arial, sans-serif",
      locale: "en",
    },
  };
}

export const CSAT_EMAIL_STARTER_TEMPLATES = [
  {
    id: "sona-default",
    name: "Sona default",
    description: "The balanced, ready-to-send CSAT email.",
    accent: "#635bff",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "A shorter email with more breathing room.",
    accent: "#111118",
  },
  {
    id: "personal",
    name: "Personal",
    description: "A warmer version that greets the customer by name.",
    accent: "#8b5cf6",
  },
  {
    id: "blank",
    name: "Start blank",
    description: "Build from scratch and add the rating block yourself.",
    accent: "#a1a1aa",
  },
];

export function createCsatEmailStarterTemplate(id, { linkMode = "preview" } = {}) {
  if (id === "minimal") return createMinimalCsatEmailContent({ linkMode });
  if (id === "personal") return createPersonalCsatEmailContent({ linkMode });
  if (id === "blank") return createBlankCsatEmailContent({ linkMode });
  return createDefaultCsatEmailContent({ linkMode });
}

export function countCsatRatingBlocks(content) {
  const visit = (block) => {
    if (!block || typeof block !== "object") return 0;
    if (block.type === "custom" && block.customType === "csat-rating") return 1;
    if (block.type !== "section" || !Array.isArray(block.children)) return 0;
    return block.children.reduce((total, column) => total + (Array.isArray(column) ? column.reduce((sum, child) => sum + visit(child), 0) : 0), 0);
  };
  return Array.isArray(content?.blocks) ? content.blocks.reduce((total, block) => total + visit(block), 0) : 0;
}

export function getCsatRatingFields(fieldValues = {}) {
  return {
    question: String(fieldValues.question ?? "How was your experience?").slice(0, 500),
    leftLabel: String(fieldValues.leftLabel ?? "Very poor").slice(0, 100),
    rightLabel: String(fieldValues.rightLabel ?? "Excellent").slice(0, 100),
    scale: 5,
    ratingStyle: ["emoji", "numbers", "stars"].includes(fieldValues.ratingStyle)
      ? fieldValues.ratingStyle
      : "emoji",
    alignment: ["left", "center", "right"].includes(fieldValues.alignment)
      ? fieldValues.alignment
      : "center",
    textColor: normalizeHexColor(fieldValues.textColor, "#172033"),
    ratingColor: normalizeHexColor(fieldValues.ratingColor, "#f59e0b"),
    ratingBorderColor: normalizeHexColor(fieldValues.ratingBorderColor, "#e5e7eb"),
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
