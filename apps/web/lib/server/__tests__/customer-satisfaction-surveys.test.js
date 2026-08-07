import { afterAll, describe, expect, it } from "vitest";

import {
  buildCustomerSatisfactionUrl,
  buildSurveyEmail,
  deriveCustomerSatisfactionToken,
  hashCustomerSatisfactionToken,
  scheduledCustomerSatisfactionAt,
} from "../customer-satisfaction-surveys.js";

const previousSecret = process.env.CSAT_TOKEN_SECRET;
process.env.CSAT_TOKEN_SECRET = "test-csat-secret";

afterAll(() => {
  if (previousSecret === undefined) delete process.env.CSAT_TOKEN_SECRET;
  else process.env.CSAT_TOKEN_SECRET = previousSecret;
});

describe("customer satisfaction survey links", () => {
  it("derives a stable opaque token without storing customer data", () => {
    const first = deriveCustomerSatisfactionToken("workspace-1", "thread-1");
    const second = deriveCustomerSatisfactionToken("workspace-1", "thread-1");
    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(hashCustomerSatisfactionToken(first)).toHaveLength(64);
    expect(first).not.toBe(deriveCustomerSatisfactionToken("workspace-1", "thread-2"));
  });

  it("keeps delivery delay semantics explicit", () => {
    const resolvedAt = "2026-08-05T10:00:00.000Z";
    expect(scheduledCustomerSatisfactionAt(resolvedAt, "immediately")).toBe(resolvedAt);
    expect(scheduledCustomerSatisfactionAt(resolvedAt, "1h")).toBe("2026-08-05T11:00:00.000Z");
    expect(scheduledCustomerSatisfactionAt(resolvedAt, "24h")).toBe("2026-08-06T10:00:00.000Z");
    expect(scheduledCustomerSatisfactionAt(resolvedAt, "custom", 90)).toBe("2026-08-05T11:30:00.000Z");
  });

  it("builds a shareable public URL from the request origin", () => {
    expect(buildCustomerSatisfactionUrl("abc123", "https://app.example.com/")).toBe(
      "https://app.example.com/csat/abc123",
    );
  });

  it("includes the selected score in each email rating link", () => {
    const rendered = buildSurveyEmail({
      settings: {
        subject: "How did we do?",
        headline: "How was your support experience?",
        intro: "Tell us how we did.",
        thankYou: "Thanks.",
        footer: "Your feedback matters.",
        company: "Acme",
        accent: "#635bff",
        logoUrl: "",
      },
      surveyUrl: "https://app.example.com/csat/token",
      customerName: "Sam",
      subject: "Order question",
    });

    for (const score of [1, 2, 3, 4, 5]) {
      expect(rendered.html).toContain(`https://app.example.com/csat/token?score=${score}`);
      expect(rendered.text).toContain(`https://app.example.com/csat/token?score=${score}`);
    }
  });

  it("localizes default copy to the conversation language", () => {
    const rendered = buildSurveyEmail({
      settings: {
        subject: "How did we do?",
        headline: "How was your support experience?",
        intro: "We'd love to hear how we did. Your feedback helps us make every reply better.",
        thankYou: "Thanks for helping us improve.",
        footer: "You're receiving this because your support conversation was resolved.",
        company: "Acme",
        accent: "#635bff",
        logoUrl: "",
      },
      surveyUrl: "https://app.example.com/csat/token",
      language: "da",
    });

    expect(rendered.subject).toBe("Hvordan klarede vi os?");
    expect(rendered.html).toContain("Hvordan var din supportoplevelse?");
    expect(rendered.html).toContain("Meget dårlig");
    expect(rendered.html).toContain("language=da");
    expect(rendered.html).toContain("role=\"presentation\"");
    expect(rendered.html).toContain('align="right" style="padding:0;text-align:right;">Fremragende</td>');
  });

  it("omits optional email fields when they are left empty", () => {
    const rendered = buildSurveyEmail({
      settings: {
        subject: "Feedback",
        headline: "",
        intro: "",
        thankYou: "",
        footer: "",
        company: "",
        senderName: "",
        accent: "#635bff",
        logoUrl: "",
      },
      surveyUrl: "https://app.example.com/csat/token",
    });

    expect(rendered.html).not.toContain("Customer feedback");
    expect(rendered.html).not.toContain("Your support team");
    expect(rendered.html).not.toContain("You're receiving this");
    expect(rendered.text).not.toContain("Your feedback");
  });
});
