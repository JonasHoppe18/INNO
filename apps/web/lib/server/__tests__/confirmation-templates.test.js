import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_STARTER_TEMPLATES,
  countConfirmationMessageBlocks,
  createConfirmationStarterTemplate,
} from "@/lib/confirmation/email-template";
import { compileConfirmationEmail, normalizeConfirmationContent } from "../confirmation-email";
import { renderCustomerConfirmation } from "../customer-confirmation";

const sendWith = async (content) => {
  const compiled = await compileConfirmationEmail({
    content,
    subject: "[{{ticket.reference}}] We've received your message",
  });
  return renderCustomerConfirmation({
    templateHtml: compiled.html,
    bodyTextTemplate: compiled.text,
    subjectTemplate: compiled.subject,
    tokens: { customer_first_name: "Anna", team_name: "Example Store" },
    ticketNumber: 50001,
  });
};

const blocksOf = (content) => {
  const all = [];
  const visit = (block) => {
    all.push(block);
    (block.children || []).forEach((column) => column.forEach(visit));
  };
  content.blocks.forEach(visit);
  return all;
};

describe("confirmation starter templates", () => {
  it("offers a classic, branded, dark and minimal starting point", () => {
    expect(CONFIRMATION_STARTER_TEMPLATES.map((template) => template.id)).toEqual([
      "default", "branded", "dark", "minimal",
    ]);
  });

  it.each(CONFIRMATION_STARTER_TEMPLATES.map((template) => template.id))(
    "%s can be saved and sends the ticket number",
    async (id) => {
      const content = createConfirmationStarterTemplate(id);
      expect(countConfirmationMessageBlocks(content)).toBe(1);
      expect(() => normalizeConfirmationContent(content)).not.toThrow();
      const mail = await sendWith(content);
      expect(mail.subject).toBe("[T-50001] We've received your message");
      expect(mail.html).toContain("T-50001");
      expect(mail.html).toContain("Hi Anna");
      expect(mail.html).not.toContain("{{");
    },
  );

  it("keeps the templates free of any one store's copy", () => {
    for (const template of CONFIRMATION_STARTER_TEMPLATES) {
      const source = JSON.stringify(createConfirmationStarterTemplate(template.id)).toLowerCase();
      expect(source).not.toContain("acezone");
    }
  });

  it("leaves an empty logo slot that is left out of the sent email", async () => {
    for (const id of ["branded", "dark"]) {
      const content = createConfirmationStarterTemplate(id);
      const logo = blocksOf(content).find((block) => block.type === "image");
      expect(logo?.src).toBe("");
      const mail = await sendWith(content);
      expect(mail.html).not.toMatch(/<img[^>]+src=""/);
    }
  });

  it("uses light text on the dark template", () => {
    const content = createConfirmationStarterTemplate("dark");
    const message = blocksOf(content).find((block) => block.customType === "confirmation-message");
    expect(message.fieldValues.color.toLowerCase()).not.toBe("#172033");
    expect(content.settings.backgroundColor.toLowerCase()).not.toBe("#f3f4f6");
  });

  it("applies the message block's text color and size in the sent email", async () => {
    const mail = await sendWith(createConfirmationStarterTemplate("dark"));
    expect(mail.html).not.toContain("<mj-text");
    expect(mail.html).toMatch(/color:\s*#e5e7eb[^>]*>\s*<p[^>]*>Hi Anna/);
  });

  it("falls back to the classic template for an unknown id", () => {
    expect(createConfirmationStarterTemplate("nope")).toEqual(createConfirmationStarterTemplate("default"));
  });
});
