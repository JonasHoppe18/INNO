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

const pad = (top = 0, right = 0, bottom = 0, left = 0) => ({ top, right, bottom, left });
const messageBlock = (message, color) => ({
  id: "confirmation-message",
  type: "custom",
  customType: "confirmation-message",
  fieldValues: { message, fontSize: 16, color },
  styles: { padding: pad(0, 0, 0, 0) },
});
// Empty image: the editor shows an upload slot, and the sent email leaves it out.
const logoSlot = () => ({
  id: "confirmation-logo",
  type: "image",
  src: "",
  alt: "Logo",
  width: 160,
  align: "center",
  styles: { padding: pad(0, 0, 24, 0) },
});
const divider = (id, color) => ({
  id,
  type: "divider",
  lineStyle: "solid",
  color,
  thickness: 1,
  width: "full",
  styles: { padding: pad(24, 0, 24, 0) },
});
const DEFAULT_MESSAGE = CONFIRMATION_MESSAGE_BLOCK.fields[0].default;
const singleSection = (backgroundColor, children, padding = pad(40, 40, 40, 40)) => ({
  id: "confirmation-section",
  type: "section",
  columns: "1",
  styles: { backgroundColor, padding },
  children: [children],
});
const contentWith = (backgroundColor, blocks) => ({
  settings: { width: 600, backgroundColor, textColor: "#172033", fontFamily: "Arial, sans-serif" },
  blocks,
});

function createBrandedConfirmationContent() {
  return contentWith("#f3f4f6", [
    singleSection("#ffffff", [
      logoSlot(),
      {
        id: "confirmation-title",
        type: "title",
        level: 2,
        content: "We've received your message",
        textAlign: "center",
        color: "#111827",
        styles: { padding: pad(0, 0, 0, 0) },
      },
      divider("confirmation-divider-top", "#e5e7eb"),
      messageBlock(DEFAULT_MESSAGE, "#374151"),
    ]),
  ]);
}

function createDarkConfirmationContent() {
  return contentWith("#0b0d17", [
    singleSection("#161827", [
      logoSlot(),
      {
        id: "confirmation-title",
        type: "title",
        level: 2,
        content: "We've received your message",
        textAlign: "center",
        color: "#ffffff",
        styles: { padding: pad(8, 0, 0, 0) },
      },
      divider("confirmation-divider-top", "#3b3f55"),
      messageBlock(DEFAULT_MESSAGE, "#e5e7eb"),
    ]),
  ]);
}

function createMinimalConfirmationContent() {
  return contentWith("#ffffff", [
    singleSection("#ffffff", [
      messageBlock(DEFAULT_MESSAGE, "#111827"),
    ], pad(32, 24, 32, 24)),
  ]);
}

export const CONFIRMATION_STARTER_TEMPLATES = [
  {
    id: "default",
    name: "Simple",
    description: "A clean message on a light background.",
    accent: "#635bff",
  },
  {
    id: "branded",
    name: "Branded",
    description: "Your logo and a headline above the message.",
    accent: "#4f46e5",
  },
  {
    id: "dark",
    name: "Dark",
    description: "Your logo and a headline on a dark background.",
    accent: "#5fd47a",
    surface: "#161827",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Looks like a personal email, with no design around it.",
    accent: "#111118",
  },
];

export function createConfirmationStarterTemplate(id) {
  if (id === "branded") return createBrandedConfirmationContent();
  if (id === "dark") return createDarkConfirmationContent();
  if (id === "minimal") return createMinimalConfirmationContent();
  return createConfirmationContent();
}
