import type { WorkflowRoute } from "../types.ts";

export function buildGeneralDraft(): WorkflowRoute {
  return {
    category: "General",
    workflow: "general",
    promptHint: "WORKFLOW: General. Answer the inquiry directly and concisely using only what is in APPROVED FACTS and KNOWLEDGE BASE.",
    systemHint: "Workflow er General: vælg mindst nødvendige handlinger.",
    promptBlocks: [
      "GENERAL WORKFLOW RULES:\n" +
      "- If the email is clearly NOT an order-related inquiry (e.g. partnership request, press/media inquiry, B2B inquiry, job application, sponsorship), do NOT ask for order number or name used at purchase. These are irrelevant.\n" +
      "- If you do not have routing information, a specific contact email, or escalation instructions in APPROVED FACTS or KNOWLEDGE BASE, do NOT invent any. Do not guess department names, email addresses, or contact points. If you cannot route the inquiry, acknowledge it professionally and say the team will be in touch.\n" +
      "- Only ask for details that are genuinely needed to help this specific customer with this specific inquiry.\n" +
      "- Do NOT open with any of these phrases or close variants: 'Thank you for reaching out', 'Thank you for contacting us', 'Thank you for your message', 'It's great to hear from you', 'I hope this finds you well', 'Thank you for sharing your interest', or any other opener that only acknowledges receipt. Start with the actual substance.\n" +
      "- Do NOT use hollow closing phrases like 'We look forward to the possibility of working together', 'We look forward to hearing from you', 'Don't hesitate to reach out', or similar filler. End the reply when the substance is complete.\n" +
      "- Do NOT invent or assume context about the sender that is not in the email (e.g. their role, expertise, platform, or professional background) just to sound engaged.",
    ],
    systemRules: [
      "Never invent email addresses, phone numbers, department names, or contact details not present in APPROVED FACTS or KNOWLEDGE BASE.",
      "Do not ask for order number or purchase name for non-order inquiries such as partnership, press, media, B2B, or sponsorship emails.",
      "Never open with a receipt-acknowledgement phrase. The first sentence must deliver substance.",
      "Never close with hollow forward-looking phrases. End when the content is complete.",
    ],
  };
}

