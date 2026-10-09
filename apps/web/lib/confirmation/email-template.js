import {
  CSAT_PALETTE_BLOCKS,
  CSAT_SAMPLE_DATA,
} from "@/lib/csat/email-template";
export const CONFIRMATION_SAMPLE_DATA = {
  ...CSAT_SAMPLE_DATA,
  ticket: { reference: "T-50001" },
};
// Variables offered in the designer. The ticket reference may sit anywhere in the
// layout (for example a footer); the message block keeps the customer variables.
export const CONFIRMATION_DESIGN_VARIABLES = [
  {
    label: "Ticket reference",
    value: "{{ticket.reference}}",
    sample: "T-50001",
    group: "Ticket",
    description:
      "Use it in the message or any text block, for example the footer. Without it, the reference is added below the message. Lines with it are left out when the reference is turned off.",
  },
];
export const CONFIRMATION_VARIABLES = [
  ["Customer first name", "customer.first_name"],
  ["Customer full name", "customer.full_name"],
  ["Team name", "store.name"],
  ["Conversation subject", "conversation.subject"],
].map(([label, path]) => ({
  label,
  value: `{{${path}}}`,
  group: "Confirmation",
}));
export const CONFIRMATION_TOKEN_MAP = {
  "customer.first_name": "customer_first_name",
  "customer.full_name": "customer_name",
  "store.name": "team_name",
  "conversation.subject": "subject",
  "ticket.reference": "ticket_reference",
};

// The designer and Settings show dotted variables; the sender stores underscore tokens.
export function toDesignerTokens(value) {
  let result = String(value || "");
  for (const [path, legacy] of Object.entries(CONFIRMATION_TOKEN_MAP)) {
    result = result.replaceAll(`{{${legacy}}}`, `{{${path}}}`);
  }
  return result;
}

export function toStoredTokens(value) {
  return String(value || "").replace(/{{\s*([a-z0-9_.]+)\s*}}/gi, (match, path) => {
    const legacy = CONFIRMATION_TOKEN_MAP[String(path).toLowerCase()];
    return legacy ? `{{${legacy}}}` : match;
  });
}
export const CONFIRMATION_MESSAGE_BLOCK = {
  type: "confirmation-message",
  name: "Confirmation message",
  description: "Your message and optional ticket reference.",
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg>',
  fields: [
    {
      key: "message",
      label: "Message",
      type: "textarea",
      default:
        "Hi {{customer.first_name}},\n\nThanks for contacting us. We've received your message and our team will get back to you as soon as possible.\n\nYour ticket number: {{ticket.reference}}\n\nYou can reply directly to this email if you would like to add more information.\n\nBest,\n{{store.name}}",
    },
    { key: "fontSize", label: "Text size", type: "number", default: 16 },
    { key: "color", label: "Text color", type: "color", default: "#172033" },
  ],
  defaultStyles: { padding: { top: 16, right: 24, bottom: 16, left: 24 } },
  template:
    '<div style="white-space:pre-wrap;font-size:{{ fontSize }}px;color:{{ color }};line-height:1.6">{{ message | escape }}</div>',
};
export const CONFIRMATION_PALETTE = [
  ...CSAT_PALETTE_BLOCKS.filter((type) => !type.startsWith("custom:")),
  "custom:confirmation-message",
];
export function countConfirmationMessageBlocks(content) {
  const count = (blocks) =>
    (blocks || []).reduce(
      (sum, block) =>
        sum +
        (block.customType === "confirmation-message" ? 1 : 0) +
        (block.children || []).reduce(
          (total, column) => total + count(column),
          0,
        ),
      0,
    );
  return count(content?.blocks);
}
export function createConfirmationContent(
  message = CONFIRMATION_MESSAGE_BLOCK.fields[0].default,
) {
  for (const [path, legacy] of Object.entries(CONFIRMATION_TOKEN_MAP))
    message = message.replaceAll(`{{${legacy}}}`, `{{${path}}}`);
  return {
    settings: {
      width: 600,
      backgroundColor: "#f3f4f6",
      textColor: "#172033",
      fontFamily: "Arial, sans-serif",
    },
    blocks: [
      {
        id: "confirmation-section",
        type: "section",
        columns: "1",
        styles: {
          backgroundColor: "#ffffff",
          padding: { top: 24, right: 24, bottom: 24, left: 24 },
        },
        children: [
          [
            {
              id: "confirmation-message",
              type: "custom",
              customType: "confirmation-message",
              fieldValues: { message, fontSize: 16, color: "#172033" },
              styles: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
            },
          ],
        ],
      },
    ],
  };
}
