import { describe, expect, it } from "vitest";
import {
  buildCsatResponseUrl,
  getCsatGroup,
  hashCsatToken,
  isValidCsatScore,
  normalizeCsatTemplateContent,
  renderCsatEmail,
  replaceCsatVariables,
  selectThankYouMessage,
} from "../csat-email.js";
import { createDefaultCsatEmailContent } from "@/lib/csat/email-template";
import { recordCsatResponse } from "../csat-response.js";
import {
  defaultCsatDraft,
  loadCsatDraft,
  loadPublishedCsatTemplate,
  scopeCsatWorkspaceQuery,
} from "../csat-store.js";

function createQuery(result, calls = []) {
  return {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    order(column, options) {
      calls.push(["order", column, options]);
      return this;
    },
    limit(value) {
      calls.push(["limit", value]);
      return this;
    },
    maybeSingle: async () => result,
  };
}

describe("CSAT email safety and rendering", () => {
  it("rejects unsupported HTML blocks and scripts", () => {
    expect(() => normalizeCsatTemplateContent({
      blocks: [{ id: "x", type: "html", content: "<script>alert(1)</script>" }],
      settings: {},
    })).toThrow(/not allowed/i);
    expect(() => normalizeCsatTemplateContent({
      blocks: [{ id: "x", type: "paragraph", content: "<p><script>alert(1)</script></p>" }],
      settings: {},
    })).toThrow(/unsupported markup/i);
  });

  it("renders variables and tolerates missing optional data", () => {
    expect(replaceCsatVariables("Hi {{customer.first_name}} {{order.number}}", {
      customer: { first_name: "Alex" },
      order: {},
    })).toBe("Hi Alex ");
  });

  it("renders missing optional variables as blank through the email pipeline", async () => {
    const content = createDefaultCsatEmailContent({ linkMode: "preview" });
    content.blocks[0].children[0].push({
      id: "optional-order",
      type: "paragraph",
      content: "Order {{order.number}}",
      styles: {},
    });
    const rendered = await renderCsatEmail({
      content,
      data: { customer: { first_name: "Alex" }, order: {} },
      linkMode: "test",
    });
    expect(rendered.html).not.toContain("{{order.number}}");
    expect(rendered.text).toContain("Order");
  });

  it("renders five safe score links without scripts", async () => {
    const rendered = await renderCsatEmail({
      content: createDefaultCsatEmailContent({ linkMode: "preview" }),
      linkMode: "test",
    });
    expect(rendered.html).not.toMatch(/<script/i);
    for (const score of [1, 2, 3, 4, 5]) {
      expect(rendered.html).toContain(`#sona-csat-test-score-${score}`);
    }
  });

  it("requires a secure token for live rating links", async () => {
    await expect(renderCsatEmail({
      content: createDefaultCsatEmailContent(),
      linkMode: "live",
    })).rejects.toThrow(/secure CSAT token/i);
  });

  it("validates scores, token hashing, and response URLs", () => {
    expect(isValidCsatScore(1)).toBe(true);
    expect(isValidCsatScore(5)).toBe(true);
    expect(isValidCsatScore(0)).toBe(false);
    expect(isValidCsatScore(6)).toBe(false);
    expect(hashCsatToken("token")).not.toBe("token");
    expect(buildCsatResponseUrl("abc", 5, "https://sona.example")).toBe(
      "https://sona.example/csat/respond/abc?score=5"
    );
  });

  it("does not expose real response URLs in test email rendering", async () => {
    const rendered = await renderCsatEmail({
      content: createDefaultCsatEmailContent(),
      linkMode: "test",
    });
    expect(rendered.html).not.toMatch(/\/csat\/respond\//);
    expect(rendered.html).toContain("#sona-csat-test-score-1");
  });

  it("selects negative, neutral, and positive Thank You groups", () => {
    expect([1, 2].map(getCsatGroup)).toEqual(["negative", "negative"]);
    expect(getCsatGroup(3)).toBe("neutral");
    expect([4, 5].map(getCsatGroup)).toEqual(["positive", "positive"]);
    const messages = {
      negative: { heading: "No", body: "", button_text: "", button_url: "" },
      neutral: { heading: "Maybe", body: "", button_text: "", button_url: "" },
      positive: { heading: "Yes", body: "", button_text: "", button_url: "" },
    };
    expect(selectThankYouMessage(messages, 1).heading).toBe("No");
    expect(selectThankYouMessage(messages, 3).heading).toBe("Maybe");
    expect(selectThankYouMessage(messages, 5).heading).toBe("Yes");
  });

  it("keeps draft persistence explicitly workspace-scoped", () => {
    const calls = [];
    const query = { eq(column, value) { calls.push([column, value]); return this; } };
    scopeCsatWorkspaceQuery(query, "workspace-a");
    expect(calls).toEqual([["workspace_id", "workspace-a"]]);
  });

  it("does not make a draft live automatically", () => {
    const draft = defaultCsatDraft("workspace-a");
    expect(draft.status).toBe("draft");
    expect(draft.version).toBe(0);
    expect(draft.published_version).toBeNull();
  });

  it("scopes template reads and returns the default draft for another workspace", async () => {
    const calls = [];
    const serviceClient = {
      from() {
        return {
          select() {
            return createQuery({ data: null, error: null }, calls);
          },
        };
      },
    };
    const draft = await loadCsatDraft(serviceClient, "workspace-b");
    expect(calls).toContainEqual(["eq", "workspace_id", "workspace-b"]);
    expect(draft.workspace_id).toBe("workspace-b");
    expect(draft.status).toBe("draft");
  });

  it("loads the latest published template inside the workspace scope", async () => {
    const calls = [];
    const serviceClient = {
      from() {
        return {
          select() {
            return createQuery({
              data: {
                id: "version-id",
                workspace_id: "workspace-a",
                template_id: "template-id",
                version: 3,
                name: "Published CSAT",
                subject: "How did we do?",
                preview_text: "Tell us what you think",
                editor_json: createDefaultCsatEmailContent(),
                rendered_html: "<html></html>",
                rendered_text: "How did we do?",
                published_at: "2026-09-10T00:00:00.000Z",
              },
              error: null,
            }, calls);
          },
        };
      },
    };
    const published = await loadPublishedCsatTemplate(serviceClient, "workspace-a");
    expect(published.version).toBe(3);
    expect(published.workspace_id).toBe("workspace-a");
    expect(calls).toContainEqual(["eq", "workspace_id", "workspace-a"]);
    expect(calls).toContainEqual(["eq", "status", "published"]);
  });

  it("rejects test-mode response tokens before writing CSAT feedback", async () => {
    const serviceClient = {
      from(table) {
        if (table === "csat_survey_tokens") {
          return {
            select() {
              return {
                eq() {
                  return { maybeSingle: async () => ({
                    data: {
                      id: "test-token",
                      workspace_id: "workspace-a",
                      thread_id: "thread-a",
                      test_mode: true,
                      expires_at: null,
                      consumed_at: null,
                    },
                    error: null,
                  }) };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table access: ${table}`);
      },
    };
    await expect(recordCsatResponse(serviceClient, { token: "test-token", score: 5 }))
      .resolves.toEqual({ ok: false, reason: "invalid_token" });
  });
});
