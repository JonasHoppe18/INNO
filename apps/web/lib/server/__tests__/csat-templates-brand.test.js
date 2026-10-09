import { describe, expect, it } from "vitest";
import { CSAT_EMAIL_STARTER_TEMPLATES, createCsatEmailStarterTemplate } from "@/lib/csat/email-template";
import { normalizeCsatTemplateContent } from "../csat-email";

const logoUrl = "https://abc.supabase.co/storage/v1/object/public/workspace-email-signature-assets/ws/media/logo.png";
const firstBlock = (content) => content.blocks[0].children[0][0];

describe("satisfaction starter templates with the workspace brand", () => {
  it("puts the brand logo centered at the top of every template except Start blank", () => {
    for (const { id } of CSAT_EMAIL_STARTER_TEMPLATES.filter((template) => template.id !== "blank")) {
      const content = createCsatEmailStarterTemplate(id, { brand: { logoUrl, accentColor: "#e11d48" } });
      expect(firstBlock(content)).toMatchObject({ type: "image", src: logoUrl, align: "center" });
      expect(() => normalizeCsatTemplateContent(content)).not.toThrow();
    }
    const blank = createCsatEmailStarterTemplate("blank", { brand: { logoUrl } });
    expect(blank.blocks[0].children[0]).toEqual([]);
  });

  it("is unchanged without a brand logo", () => {
    for (const { id } of CSAT_EMAIL_STARTER_TEMPLATES) {
      expect(createCsatEmailStarterTemplate(id, { brand: { logoUrl: "", accentColor: "#e11d48" } }))
        .toEqual(createCsatEmailStarterTemplate(id));
    }
  });
});
