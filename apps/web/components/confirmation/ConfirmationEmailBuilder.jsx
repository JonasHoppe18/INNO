"use client";
import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { EmailTemplateBuilder } from "@/components/email/EmailTemplateBuilder";
import {
  CONFIRMATION_PALETTE,
  CONFIRMATION_MESSAGE_BLOCK,
  CONFIRMATION_DESIGN_VARIABLES,
  CONFIRMATION_SAMPLE_DATA,
  CONFIRMATION_STARTER_TEMPLATES,
  createConfirmationContent,
  createConfirmationStarterTemplate,
  countConfirmationMessageBlocks,
} from "@/lib/confirmation/email-template";
export function ConfirmationEmailBuilder({ mailboxId = "" }) {
  const { userId, orgId, sessionId } = useAuth();
  const config = useMemo(
    () => ({
      title: "Confirmation email",
      description:
        "Customize the email customers receive when they create a support ticket.",
      apiBase: "/api/settings/confirmation/email",
      scopeQuery: mailboxId
        ? `?mailbox_id=${encodeURIComponent(mailboxId)}`
        : "",
      backHref: `/settings/confirmation-email${mailboxId ? `?mailbox_id=${encodeURIComponent(mailboxId)}` : ""}`,
      palette: CONFIRMATION_PALETTE,
      block: CONFIRMATION_MESSAGE_BLOCK,
      variables: CONFIRMATION_DESIGN_VARIABLES,
      sampleData: CONFIRMATION_SAMPLE_DATA,
      templates: CONFIRMATION_STARTER_TEMPLATES,
      countBlocks: countConfirmationMessageBlocks,
      createStarter: (templateId) => createConfirmationStarterTemplate(templateId),
      createFallbackDraft: () => ({
        id: null,
        name: "Customer confirmation",
        subject: "[{{ticket.reference}}] We've received your message",
        preview_text: "Our team will get back to you soon.",
        editor_json: createConfirmationContent(),
        status: "draft",
        version: 0,
      }),
    }),
    [mailboxId],
  );
  return (
    <EmailTemplateBuilder
      key={`${userId}:${sessionId}:${orgId}:${mailboxId}`}
      config={config}
    />
  );
}
