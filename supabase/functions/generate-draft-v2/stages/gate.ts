// supabase/functions/generate-draft-v2/stages/gate.ts

export interface GateInput {
  thread: Record<string, unknown>;
  latestMessage: Record<string, unknown>;
  shop: Record<string, unknown>;
}

export interface GateResult {
  should_process: boolean;
  reason: string;
}

export async function runGate(
  { latestMessage }: GateInput,
): Promise<GateResult> {
  const msg = latestMessage as {
    clean_body_text?: string;
    body_text?: string;
    from_email?: string;
  };

  const body = msg.clean_body_text ?? msg.body_text ?? "";

  if (!body || body.trim().length < 5) {
    return { should_process: false, reason: "empty_body" };
  }

  // Skip auto-replies / delivery failures
  const lowerBody = body.toLowerCase();
  const isAutoReply = lowerBody.includes("mailer-daemon") ||
    lowerBody.includes("delivery status notification") ||
    lowerBody.includes("auto-reply") ||
    lowerBody.includes("out of office") ||
    lowerBody.includes("automatic reply");

  if (isAutoReply) {
    return { should_process: false, reason: "auto_reply" };
  }

  return { should_process: true, reason: "ok" };
}
