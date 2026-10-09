import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  workspaceId: "workspace-a",
  denied: false,
  rows: null,
  calls: [],
  rpcError: null,
}));
vi.mock("../csat-route", () => ({
  requireCsatWorkspace: async () =>
    state.denied
      ? { response: new Response(null, { status: 401 }) }
      : { workspaceId: state.workspaceId, serviceClient: client },
}));
vi.mock("../confirmation-configuration", () => ({
  loadConfirmationConfiguration: async () => ({
    mailboxes: [
      {
        id: "mail-a",
        effective: {
          subject_template: "Mailbox subject",
          body_text_template: "Mailbox body",
        },
      },
    ],
    workspace_setting: {
      subject_template: "Workspace subject",
      body_text_template: "Workspace body",
    },
  }),
}));
vi.mock("../confirmation-email", () => ({
  compileConfirmationEmail: async ({ content, subject }) => ({
    content,
    subject,
    text: "compiled message",
    html: "{{content}}",
  }),
}));
const client = {
  from(table) {
    state.calls.push(["from", table]);
    const query = {
      select: () => query,
      eq: (key, value) => {
        state.calls.push([key, value]);
        return query;
      },
      update: (body) => {
        state.calls.push(["update", body]);
        return query;
      },
      upsert: (body, options) => {
        state.calls.push(["upsert", body, options]);
        return query;
      },
      maybeSingle: async () => ({ data: state.rows, error: null }),
      single: async () => ({ data: state.rows, error: null }),
    };
    return query;
  },
  rpc: async (name, args) => {
    state.calls.push(["rpc", name, args]);
    return { data: { version: 1 }, error: state.rpcError };
  },
};
import {
  confirmationContext,
  loadConfirmationDraft,
  saveConfirmationDraft,
  publishConfirmationDraft,
  syncConfirmationDraftSubject,
} from "../confirmation-store";
const context = {
  serviceClient: client,
  workspaceId: "workspace-a",
  mailboxId: "mail-a",
  scopeKey: "mail-a",
  setting: {
    subject_template: "Subject",
    body_text_template: "Current message",
  },
};
beforeEach(() => {
  state.calls = [];
  state.rows = null;
  state.denied = false;
  state.rpcError = null;
});
describe("confirmation draft scope and publication", () => {
  it("rejects anonymous requests and a mailbox outside the current workspace", async () => {
    state.denied = true;
    expect(
      (await confirmationContext(new Request("https://app.test"))).response
        .status,
    ).toBe(401);
    state.denied = false;
    expect(
      (
        await confirmationContext(
          new Request("https://app.test?mailbox_id=foreign"),
        )
      ).response.status,
    ).toBe(404);
    expect(state.calls).toEqual([]);
    expect(
      (
        await confirmationContext(
          new Request("https://app.test?mailbox_id=mail-a"),
        )
      ).setting.subject_template,
    ).toBe("Mailbox subject");
  });
  it("loads drafts by workspace and mailbox, keeping the current message as its starting point", async () => {
    const draft = await loadConfirmationDraft(context);
    expect(state.calls).toContainEqual(["workspace_id", "workspace-a"]);
    expect(state.calls).toContainEqual(["scope_key", "mail-a"]);
    expect(draft.editor_json.blocks[0].children[0][0].fieldValues.message).toBe(
      "Current message",
    );
  });
  it("saves only draft data without changing live settings or sending mail", async () => {
    await saveConfirmationDraft(context, {
      editor_json: {},
      subject: "Draft subject",
    });
    expect(state.calls.filter(([key]) => key === "from")).toEqual([
      ["from", "confirmation_email_drafts"],
    ]);
    const body = state.calls.find(([key]) => key === "upsert")[1];
    expect(body).toMatchObject({
      workspace_id: "workspace-a",
      mailbox_id: "mail-a",
      status: "draft",
    });
  });
  it("updates only the subject of an existing draft when Settings changes it", async () => {
    await syncConfirmationDraftSubject(context, "[{{ticket.reference}}] New subject");
    const body = state.calls.find(([key]) => key === "update")[1];
    expect(Object.keys(body).sort()).toEqual(["subject", "updated_at"]);
    expect(body.subject).toBe("[{{ticket.reference}}] New subject");
    expect(state.calls).toContainEqual(["workspace_id", "workspace-a"]);
    expect(state.calls).toContainEqual(["scope_key", "mail-a"]);
  });
  it("publishes the saved draft with its workspace and expected revision", async () => {
    await expect(publishConfirmationDraft(context)).rejects.toThrow("Save");
    state.rows = {
      id: "draft-a",
      updated_at: "revision-a",
      editor_json: {},
      subject: "Subject",
    };
    await publishConfirmationDraft(context);
    expect(state.calls.find(([key]) => key === "rpc")).toEqual([
      "rpc",
      "publish_confirmation_email",
      {
        p_workspace_id: "workspace-a",
        p_draft_id: "draft-a",
        p_expected_updated_at: "revision-a",
        p_subject: "Subject",
        p_body_text: "compiled message",
        p_html_layout: "{{content}}",
      },
    ]);
    state.rpcError = { message: "draft changed" };
    await expect(publishConfirmationDraft(context)).rejects.toThrow(
      "draft changed",
    );
  });
});
