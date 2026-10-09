import { describe, expect, it } from "vitest";
import { createDefaultCsatEmailContent } from "@/lib/csat/email-template";
import { updateCsatSubject } from "../csat-store";

const WS = "ws-1";
const liveContent = createDefaultCsatEmailContent({ linkMode: "preview" });
const draftContent = structuredClone(liveContent);
draftContent.blocks[0].children[0][0].content = "A headline that is not live yet";

// Answers each query by table and the first builder call, and records writes.
function fakeClient({ draft, published, latestVersion = 3 }) {
  const writes = [];
  const from = (table) => {
    const chain = [];
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          const [op, arg] = chain[0] || [];
          let result = { data: null, error: null };
          if (op === "insert" || op === "update" || op === "delete") writes.push({ table, op, values: arg, chain });
          if (table === "csat_email_templates" && op === "select") result = { data: draft, error: null };
          if (table === "csat_email_templates" && op === "update") result = { data: { ...draft, ...arg }, error: null };
          if (table === "csat_email_templates" && op === "insert") result = { data: { id: "new-draft", ...arg }, error: null };
          if (table === "csat_email_template_versions" && op === "select") {
            const columns = String(arg);
            if (columns.startsWith("id, workspace_id, template_id")) result = { data: published, error: null };
            else if (columns === "version") result = { data: { version: latestVersion }, error: null };
            else result = { data: published ? [{ id: published.id }] : [], error: null };
          }
          if (table === "csat_email_template_versions" && op === "insert") {
            result = { data: { id: "v-new", ...arg, published_at: "now" }, error: null };
          }
          return (resolve) => resolve(result);
        }
        return (...args) => {
          chain.push([prop, ...args]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { from, writes };
}

const draftRow = (overrides = {}) => ({
  id: "draft-1",
  workspace_id: WS,
  name: "Survey",
  subject: "Old subject",
  preview_text: "Preview",
  editor_json: draftContent,
  rendered_html: "",
  rendered_text: "",
  status: "draft",
  version: 3,
  published_version: 3,
  updated_at: null,
  ...overrides,
});
const publishedRow = {
  id: "v-3",
  workspace_id: WS,
  template_id: "draft-1",
  version: 3,
  name: "Survey",
  subject: "Old subject",
  preview_text: "Live preview",
  editor_json: liveContent,
  rendered_html: "<html>live</html>",
  rendered_text: "live",
};

describe("updateCsatSubject", () => {
  it("publishes the live design with the new subject and leaves other draft changes unpublished", async () => {
    const client = fakeClient({ draft: draftRow(), published: publishedRow });
    const result = await updateCsatSubject(client, WS, { subject: "  How did we do?  " });

    const inserted = client.writes.find((write) => write.table === "csat_email_template_versions" && write.op === "insert");
    expect(inserted.values).toMatchObject({
      version: 4,
      subject: "How did we do?",
      preview_text: "Live preview",
      status: "published",
    });
    expect(JSON.stringify(inserted.values.editor_json)).not.toContain("not live yet");
    expect(client.writes.some((write) => write.op === "update" && write.values?.status === "archived")).toBe(true);

    const draftUpdate = client.writes.find((write) => write.table === "csat_email_templates" && write.op === "update");
    expect(draftUpdate.values).toMatchObject({ subject: "How did we do?", version: 4, published_version: 4 });
    expect(draftUpdate.values.status).toBeUndefined();
    expect(draftUpdate.values.editor_json).toBeUndefined();
    expect(result.published.subject).toBe("How did we do?");
  });

  it("keeps a fully published draft marked as published", async () => {
    const client = fakeClient({ draft: draftRow({ status: "published", editor_json: liveContent }), published: publishedRow });
    await updateCsatSubject(client, WS, { subject: "New" });
    const draftUpdate = client.writes.find((write) => write.table === "csat_email_templates" && write.op === "update");
    expect(draftUpdate.values).toMatchObject({ subject: "New", status: "published" });
    expect(draftUpdate.values.rendered_html).toBeTruthy();
  });

  it("only updates the draft when nothing is published yet", async () => {
    const client = fakeClient({ draft: draftRow({ published_version: null, version: 0 }), published: null });
    await updateCsatSubject(client, WS, { subject: "First subject" });
    expect(client.writes.some((write) => write.table === "csat_email_template_versions")).toBe(false);
    const draftUpdate = client.writes.find((write) => write.table === "csat_email_templates");
    expect(draftUpdate.values.subject).toBe("First subject");
  });

  it("requires a subject", async () => {
    const client = fakeClient({ draft: draftRow(), published: publishedRow });
    await expect(updateCsatSubject(client, WS, { subject: "   " })).rejects.toThrow("subject is required");
    expect(client.writes).toHaveLength(0);
  });
});
