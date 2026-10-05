"use client";
import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { EmailTemplateBuilder } from "@/components/email/EmailTemplateBuilder";
import {
  CONFIRMATION_PALETTE,
  CONFIRMATION_MESSAGE_BLOCK,
  CONFIRMATION_SAMPLE_DATA,
  createConfirmationContent,
  countConfirmationMessageBlocks,
} from "@/lib/confirmation/email-template";
const templates = [
  {
    id: "default",
    name: "Simple confirmation",
    description:
      "A clean message you can brand with your logo, colors and additional sections.",
    accent: "#635bff",
  },
];
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
      backHref: `/settings?tab=email&section=auto-reply${mailboxId ? `&mailbox_id=${encodeURIComponent(mailboxId)}` : ""}`,
      palette: CONFIRMATION_PALETTE,
      block: CONFIRMATION_MESSAGE_BLOCK,
      variables: [],
      sampleData: CONFIRMATION_SAMPLE_DATA,
      templates,
      countBlocks: countConfirmationMessageBlocks,
      createStarter: () => createConfirmationContent(),
      createFallbackDraft: () => ({
        id: null,
        name: "Customer confirmation",
        subject: "We've received your message",
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
