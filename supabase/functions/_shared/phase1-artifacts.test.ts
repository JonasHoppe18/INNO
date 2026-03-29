import { assertEquals } from "jsr:@std/assert@1";

import {
  buildReplyGoalArtifact,
  type MessageUnderstandingArtifact,
  type RecipientTypeArtifact,
} from "./phase1-artifacts.ts";

const baseMessageUnderstanding: MessageUnderstandingArtifact = {
  artifact_type: "message_understanding",
  latest_user_request: "Customer needs help with the device behavior.",
  ask_shape: "question",
  is_continuation: false,
  prior_instruction_detected: false,
  prior_instruction_summary: null,
  unresolved_need: "Needs technical help.",
  already_answered_need_detected: false,
  message_noise_detected: false,
  noise_signals: [],
  signature_detected: false,
  quoted_history_detected: false,
  sender_role_hint: "customer",
  confidence: 0.8,
  explanation: "test",
};

const baseRecipientType: RecipientTypeArtifact = {
  artifact_type: "recipient_type",
  recipient_type: "customer",
  confidence: 0.8,
  signals: ["test"],
  allowed_tone_profile: "customer_support_plain",
  operational_jargon_allowed: false,
  direct_instruction_style_preferred: false,
  explanation: "test",
};

Deno.test("technical continuation does not fall back to answer_policy_question", () => {
  const artifact = buildReplyGoalArtifact({
    assessment: {
      primary_case_type: "technical_issue",
      secondary_case_types: [],
      confidence: 0.7,
    } as any,
    messageUnderstanding: {
      ...baseMessageUnderstanding,
      is_continuation: true,
    },
    recipientType: baseRecipientType,
    replyStrategy: null,
    validation: null,
  });

  assertEquals(artifact.reply_goal, "continue_troubleshooting");
});

Deno.test("technical first response falls back to practical answer, not policy answer", () => {
  const artifact = buildReplyGoalArtifact({
    assessment: {
      primary_case_type: "technical_issue",
      secondary_case_types: [],
      confidence: 0.7,
    } as any,
    messageUnderstanding: {
      ...baseMessageUnderstanding,
      is_continuation: false,
    },
    recipientType: baseRecipientType,
    replyStrategy: null,
    validation: null,
  });

  assertEquals(artifact.reply_goal, "answer_practical_question");
});
