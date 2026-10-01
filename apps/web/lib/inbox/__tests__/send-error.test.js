import { describe, expect, it } from "vitest";
import { getSendErrorPresentation } from "../send-error.js";

describe("composer outbound delivery errors", () => {
  it("keeps recipient suppression wording persistent and explicit", () => {
    expect(
      getSendErrorPresentation({ errorCode: "recipient_suppressed" }),
    ).toEqual({
      kind: "rejected",
      title: "Email couldn't be delivered",
      message:
        "This email address appears not to exist or is no longer accepting mail. Check the recipient address before trying again. The message was not sent.",
    });
  });

  it("uses safe policy-rejection wording when the address is not classified as invalid", () => {
    expect(
      getSendErrorPresentation({ errorCode: "recipient_rejected" }),
    ).toEqual({
      kind: "rejected",
      title: "Email couldn't be delivered",
      message:
        "The recipient's mail server rejected this message. Check the recipient address before trying again. The message was not sent.",
    });
  });

  it("does not claim an unknown provider outcome was not sent", () => {
    const presentation = getSendErrorPresentation({
      errorCode: "send_status_unknown",
      sendStatus: "unknown",
    });

    expect(presentation.kind).toBe("unknown");
    expect(presentation.title).toBe("Send status unknown");
    expect(presentation.message).not.toMatch(/message was not sent/i);
    expect(presentation.message).toMatch(/may have accepted/i);
  });

  it("does not claim an accepted email was not sent when local finalization is pending", () => {
    const presentation = getSendErrorPresentation({
      errorCode: "send_accepted_local_finalize_pending",
      sendStatus: "sent",
    });

    expect(presentation.kind).toBe("unknown");
    expect(presentation.message).not.toMatch(/message was not sent/i);
    expect(presentation.message).toMatch(/provider accepted/i);
  });

  it("uses the same presentation for reply and forward failures", () => {
    const reply = getSendErrorPresentation({
      errorCode: "recipient_suppressed",
    });
    const forward = getSendErrorPresentation({
      errorCode: "recipient_suppressed",
    });

    expect(forward).toEqual(reply);
  });

  it("falls back to safe generic copy for other known failures", () => {
    const presentation = getSendErrorPresentation({
      errorCode: "send_failed",
      message: "provider internals must not reach the composer",
    });

    expect(presentation.title).toBe("Email couldn't be sent");
    expect(presentation.message).toBe(
      "Sona couldn't send this message. The message was not sent. Please review the error and try again.",
    );
    expect(presentation.message).not.toMatch(/provider internals/);
  });
});
