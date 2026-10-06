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
  const normalized = normalizeCsatTemplateContent(content, {
    purpose: "confirmation",
  });
  if (countConfirmationMessageBlocks(normalized) !== 1)
    throw new CsatTemplateValidationError(
      "Keep exactly one confirmation message block.",
    );
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === "custom") {
        legacyTokens(block.fieldValues.message);
      } else {
        for (const value of Object.values(block))
          if (typeof value === "string" && /{{|}}/.test(value))
            throw new CsatTemplateValidationError(
              "Personalization variables belong in the confirmation message block.",
            );
      }
      (block.children || []).forEach(walk);
    }
  };
  walk(normalized.blocks);
  return normalized;
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
    content: normalized,
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
    html: rendered.html,
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
