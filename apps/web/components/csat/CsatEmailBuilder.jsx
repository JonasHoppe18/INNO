"use client";
import { EmailTemplateBuilder } from "@/components/email/EmailTemplateBuilder";
import {
  CSAT_PALETTE_BLOCKS,
  CSAT_RATING_BLOCK_DEFINITION,
  CSAT_SAMPLE_DATA,
  CSAT_VARIABLES,
  CSAT_EMAIL_STARTER_TEMPLATES,
  countCsatRatingBlocks,
  createCsatEmailStarterTemplate,
  createDefaultCsatEmailContent,
} from "@/lib/csat/email-template";
const config = {
  title: "Satisfaction survey",
  description:
    "Customize the survey email customers receive after a ticket is resolved.",
  apiBase: "/api/settings/csat/email",
  backHref: "/settings/customer-satisfaction",
  ratingPreview: true,
  palette: CSAT_PALETTE_BLOCKS,
  block: CSAT_RATING_BLOCK_DEFINITION,
  variables: CSAT_VARIABLES,
  sampleData: CSAT_SAMPLE_DATA,
  templates: CSAT_EMAIL_STARTER_TEMPLATES,
  testDescription: "The five rating links are disabled in test sends and cannot create a CSAT response.",
  countBlocks: countCsatRatingBlocks,
  createStarter: createCsatEmailStarterTemplate,
  createFallbackDraft: () => ({
    id: null,
    name: "CSAT survey email",
    subject: "How was your support experience?",
    preview_text: "Your feedback helps us improve.",
    editor_json: createDefaultCsatEmailContent({ linkMode: "preview" }),
    status: "draft",
    version: 0,
    published_version: null,
  }),
};
export function CsatEmailBuilder() {
  return <EmailTemplateBuilder config={config} />;
}
