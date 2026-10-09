import {
  CsatTemplateValidationError,
  normalizeCsatTemplateContent,
  renderCsatEmail,
} from "./csat-email";
import {
  CONFIRMATION_TOKEN_MAP,
  countConfirmationMessageBlocks,
} from "@/lib/confirmation/email-template";
import { FULL_DESIGN_MARKER, renderCustomerConfirmation } from "./customer-confirmation";
import { htmlToPlainText } from "@/lib/confirmation/plain-text";

// Variables become plain markers while the shared renderer runs, because it only
// knows CSAT variables. The ticket reference may sit anywhere in a design; the
// other variables only in text and headlines.
const VARIABLE_PATTERN = /{{\s*([a-z0-9_.]+)\s*}}/gi;
const MARKER = (key) => `SONAVAR${key}SONAEND`;
const MARKER_PATTERN = /SONAVAR([a-z_]+)SONAEND/g;
const TEXT_BLOCK_TYPES = new Set(["title", "paragraph"]);
const mapStrings = (node, fn) => {
  if (typeof node === "string") return fn(node);
  if (Array.isArray(node)) return node.map((item) => mapStrings(item, fn));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, mapStrings(value, fn)]));
  }
  return node;
};
const markVariables = (node) =>
  mapStrings(node, (value) =>
    value.replace(VARIABLE_PATTERN, (match, path) => {
      const key = CONFIRMATION_TOKEN_MAP[String(path).toLowerCase()];
      return key ? MARKER(key) : match;
    }),
  );
const DESIGNER_PATH = Object.fromEntries(Object.entries(CONFIRMATION_TOKEN_MAP).map(([path, key]) => [key, path]));
const unmarkToDesigner = (node) =>
  mapStrings(node, (value) => value.replace(MARKER_PATTERN, (_match, key) => `{{${DESIGNER_PATH[key]}}}`));
const unmarkToSender = (value) => String(value || "").replace(MARKER_PATTERN, (_match, key) => `{{${key}}}`);
const hasNonTicketMarker = (value) =>
  [...String(value || "").matchAll(MARKER_PATTERN)].some(([, key]) => key !== "ticket_reference");

function legacyTokens(value) {
  return String(value || "").replace(
    /{{\s*([a-z0-9_.]+)\s*}}/gi,
    (_match, path) => {
      const key =
        CONFIRMATION_TOKEN_MAP[path.toLowerCase()] ||
        (Object.values(CONFIRMATION_TOKEN_MAP).includes(path.toLowerCase())
          ? path.toLowerCase()
          : null);
      if (!key)
        throw new CsatTemplateValidationError(
          `Unsupported confirmation variable: ${path}`,
        );
      return `{{${key}}}`;
    },
  );
}
export function normalizeConfirmationContent(content) {
  if (JSON.stringify(content || {}).length > 250000)
    throw new CsatTemplateValidationError("Email design is too large.");
  const normalized = normalizeCsatTemplateContent(markVariables(content), {
    purpose: "confirmation",
  });
  if (countConfirmationMessageBlocks(normalized) > 1)
    throw new CsatTemplateValidationError(
      "Keep at most one confirmation message block.",
    );
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === "custom") {
        legacyTokens(unmarkToSender(block.fieldValues.message));
      } else {
        for (const value of Object.values(block)) {
          if (typeof value !== "string") continue;
          if (/{{|}}/.test(value))
            throw new CsatTemplateValidationError(
              "This variable can't be used in a confirmation email.",
            );
          if (!TEXT_BLOCK_TYPES.has(block.type) && hasNonTicketMarker(value))
            throw new CsatTemplateValidationError(
              "Personalization variables can only be used in text and headline blocks.",
            );
        }
      }
      (block.children || []).forEach(walk);
    }
  };
  walk(normalized.blocks);
  return unmarkToDesigner(normalized);
}
export async function compileConfirmationEmail({
  content,
  subject,
  previewText = "",
}) {
  const normalized = normalizeConfirmationContent(content);
  if (!String(subject || "").trim())
    throw new CsatTemplateValidationError("Add a subject before saving.");
  if (/{{|}}/.test(previewText))
    throw new CsatTemplateValidationError(
      "Preview text cannot contain personalization variables.",
    );
  let message = null;
  const find = (blocks) =>
    blocks.forEach((block) => {
      if (block.customType === "confirmation-message")
        message = block.fieldValues.message;
      (block.children || []).forEach(find);
    });
  find(normalized.blocks);
  const rendered = await renderCsatEmail({
    content: markVariables(normalized),
    subject: "Confirmation",
    previewText,
    purpose: "confirmation",
  });
  const html = unmarkToSender(rendered.html);
  if (message === null) {
    // A full design: the whole email carries the variables, and the sender fills them.
    const fullHtml = `${FULL_DESIGN_MARKER}${html}`;
    return {
      content: normalized,
      subject: legacyTokens(subject),
      text: htmlToPlainText(fullHtml),
      html: fullHtml,
    };
  }
  if ((html.match(/{{content}}/g) || []).length !== 1)
    throw new CsatTemplateValidationError(
      "Confirmation message is missing from the layout.",
    );
  return {
    content: normalized,
    subject: legacyTokens(subject),
    text: legacyTokens(message),
    html,
  };
}
export async function previewConfirmationEmail(
  input,
  includeTicketNumber = true,
) {
  const compiled = await compileConfirmationEmail(input);
  return renderCustomerConfirmation({
    subjectTemplate: compiled.subject,
    bodyTextTemplate: compiled.text,
    templateHtml: compiled.html,
    includeTicketNumber,
    ticketNumber: 50001,
    tokens: {
      customer_first_name: "Alex",
      customer_name: "Alex Johnson",
      team_name: "Demo Store",
      subject: "A question about my order",
    },
  });
}
