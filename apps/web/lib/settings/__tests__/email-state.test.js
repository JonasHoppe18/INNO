import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIRMATION_BODY_TEXT,
  DEFAULT_CONFIRMATION_SUBJECT,
  DEFAULT_CONFIRMATION_TEMPLATE_HTML,
  initialEmailState,
} from "../email-state";

const ok = (payload) => ({ ok: true, status: 200, payload });

describe("initialEmailState", () => {
  it("returns today's defaults when nothing loaded", () => {
    expect(initialEmailState({}, "")).toEqual({
      confirmationConfiguration: null, selectedConfirmationMailboxId: "", autoReplyInheritsWorkspace: false,
      autoReplyEnabled: false, autoReplyIncludeTicketNumber: true,
      autoReplySubjectTemplate: DEFAULT_CONFIRMATION_SUBJECT, autoReplyBodyTextTemplate: DEFAULT_CONFIRMATION_BODY_TEXT,
      autoReplyBodyHtmlTemplate: "", autoReplyTemplateId: null, autoReplyTemplateName: "Default template",
      autoReplyTemplateHtml: DEFAULT_CONFIRMATION_TEMPLATE_HTML,
      emailRoutingRows: [], emailSenderRuleRows: [], emailBlocklistRows: [], workspaceInboxesForRules: [],
    });
  });

  it("selects the requested mailbox scope", () => {
    const autoReply = {
      workspace_setting: { enabled: false, subject_template: "WS" },
      mailboxes: [{ id: "m1", inherits_workspace: true, effective: { enabled: true, subject_template: "MB", include_ticket_number: false }, template: { id: "t1", name: "Mailbox tpl" } }],
    };
    const state = initialEmailState({ "/api/settings/auto-reply": ok(autoReply) }, "m1");
    expect(state).toMatchObject({
      confirmationConfiguration: autoReply, selectedConfirmationMailboxId: "m1", autoReplyInheritsWorkspace: true,
      autoReplyEnabled: true, autoReplySubjectTemplate: "MB", autoReplyIncludeTicketNumber: false,
      autoReplyTemplateId: "t1", autoReplyTemplateName: "Mailbox tpl",
    });
    expect(initialEmailState({ "/api/settings/auto-reply": ok(autoReply) }, "unknown")).toMatchObject({ selectedConfirmationMailboxId: "", autoReplySubjectTemplate: "WS" });
  });

  it("normalizes rows and inboxes", () => {
    const state = initialEmailState({
      "/api/settings/email-routing": ok({ routes: [{ id: "r1", category_key: "Billing", label: "Billing" }, { id: "r2", category_key: "support" }] }),
      "/api/settings/email-blocklist": ok({ blocks: [{ id: "b1", matcher_type: "domain", matcher_value: "@Spam.com" }] }),
      "/api/inboxes": ok({ inboxes: [{ id: "i1" }] }),
    }, "");
    expect(state).not.toHaveProperty("signatureIsActive");
    expect(state.emailRoutingRows.map((row) => row.category_key)).toEqual(["billing"]);
    expect(state.emailBlocklistRows[0]).toMatchObject({ matcher_type: "domain", matcher_value: "spam.com" });
    expect(state.workspaceInboxesForRules).toEqual([{ id: "i1" }]);
  });
});
