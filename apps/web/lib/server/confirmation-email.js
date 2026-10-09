import {
  CsatTemplateValidationError,
  normalizeCsatTemplateContent,
  renderCsatEmail,
} from "./csat-email";
import {
  CONFIRMATION_TOKEN_MAP,
  countConfirmationMessageBlocks,
} from "@/lib/confirmation/email-template";
import { renderCustomerConfirmation } from "./customer-confirmation";

// The ticket reference is the one variable a design may place outside the message.
const TICKET_REFERENCE_PATTERN = /{{\s*ticket\.reference\s*}}/gi;
const withoutTicketReference = (value) => String(value || "").replace(TICKET_REFERENCE_PATTERN, "");
// Plain marker that survives the shared renderer, which only knows CSAT variables.
const TICKET_REFERENCE_MARKER = "SONATICKETREFERENCEMARKER";
const mapStrings = (node, fn) => {
  if (typeof node === "string") return fn(node);
  if (Array.isArray(node)) return node.map((item) => mapStrings(item, fn));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, mapStrings(value, fn)]));
  }
  return node;
};
const markTicketReference = (node) =>
  mapStrings(node, (value) => value.replace(TICKET_REFERENCE_PATTERN, TICKET_REFERENCE_MARKER));
const unmarkTicketReference = (node) =>
  mapStrings(node, (value) => value.replaceAll(TICKET_REFERENCE_MARKER, "{{ticket.reference}}"));

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
  const normalized = normalizeCsatTemplateContent(markTicketReference(content), {
    purpose: "confirmation",
  });
  if (countConfirmationMessageBlocks(normalized) !== 1)
    throw new CsatTemplateValidationError(
      "Keep exactly one confirmation message block.",
    );
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === "custom") {
        if (String(block.fieldValues.message || "").includes(TICKET_REFERENCE_MARKER)) {
          throw new CsatTemplateValidationError(
            "Place the ticket reference in a text block outside the confirmation message.",
          );
        }
        legacyTokens(block.fieldValues.message);
      } else {
        for (const value of Object.values(block))
          if (typeof value === "string" && /{{|}}/.test(withoutTicketReference(value)))
            throw new CsatTemplateValidationError(
              "Personalization variables belong in the confirmation message block.",
            );
      }
      (block.children || []).forEach(walk);
    }
  };
  walk(normalized.blocks);
  return unmarkTicketReference(normalized);
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
  let message = "";
  const find = (blocks) =>
    blocks.forEach((block) => {
      if (block.customType === "confirmation-message")
        message = block.fieldValues.message;
      (block.children || []).forEach(find);
    });
  find(normalized.blocks);
  const rendered = await renderCsatEmail({
    content: markTicketReference(normalized),
    subject: "Confirmation",
    previewText,
    purpose: "confirmation",
  });
  if ((rendered.html.match(/{{content}}/g) || []).length !== 1)
    throw new CsatTemplateValidationError(
      "Confirmation message is missing from the layout.",
    );
  return {
    content: normalized,
    subject: legacyTokens(subject),
    text: legacyTokens(message),
    html: rendered.html.replaceAll(TICKET_REFERENCE_MARKER, "{{ticket_reference}}"),
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
