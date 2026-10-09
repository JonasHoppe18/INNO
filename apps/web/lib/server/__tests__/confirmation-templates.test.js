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
      expect(mail.html).toContain("Your ticket number: T-50001");
      expect(mail.html).not.toContain("font-size: 32px");
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

describe("starter templates with the workspace brand", () => {
  const brand = {
    logoUrl: "https://abc.supabase.co/storage/v1/object/public/workspace-email-signature-assets/ws/media/logo.png",
    accentColor: "#e11d48",
  };
  const find = (content, predicate) => blocksOf(content).find(predicate);

  it("puts the logo and accent color into the branded template", () => {
    const content = createConfirmationStarterTemplate("branded", { brand });
    expect(find(content, (block) => block.type === "image").src).toBe(brand.logoUrl);
    expect(find(content, (block) => block.type === "title").color).toBe("#e11d48");
    expect(find(content, (block) => block.id === "confirmation-accent")).toMatchObject({ type: "divider", color: "#e11d48" });
    expect(find(content, (block) => block.id === "confirmation-footer").content).toContain("contacted our support team");
  });

  it("keeps the dark headline white for contrast and uses the accent for the line", () => {
    const content = createConfirmationStarterTemplate("dark", { brand });
    expect(find(content, (block) => block.type === "image").src).toBe(brand.logoUrl);
    expect(find(content, (block) => block.type === "title").color).toBe("#ffffff");
    expect(find(content, (block) => block.id === "confirmation-accent").color).toBe("#e11d48");
  });

  it("falls back to default colors and an empty logo slot without a brand", () => {
    for (const options of [undefined, { brand: { logoUrl: "", accentColor: "" } }, { brand: { accentColor: "red" } }]) {
      const content = createConfirmationStarterTemplate("branded", options);
      expect(find(content, (block) => block.type === "image").src).toBe("");
      expect(find(content, (block) => block.type === "title").color).toBe("#111827");
      expect(find(content, (block) => block.id === "confirmation-accent").color).toBe("#4f46e5");
    }
  });

  it("leaves Simple and Minimal unchanged by the brand", () => {
    for (const id of ["default", "minimal"]) {
      expect(createConfirmationStarterTemplate(id, { brand })).toEqual(createConfirmationStarterTemplate(id));
    }
  });

  it.each(["default", "branded", "dark", "minimal"])("%s with a brand can still be saved and sends the ticket number", async (id) => {
    const content = createConfirmationStarterTemplate(id, { brand });
    expect(() => normalizeConfirmationContent(content)).not.toThrow();
    const mail = await sendWith(content);
    expect(mail.html).toContain("Your ticket number: T-50001");
  });
});
