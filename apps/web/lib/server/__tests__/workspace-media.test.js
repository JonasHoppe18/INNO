import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  MEDIA_PAGE_SIZE,
  decodeMediaCursor,
  encodeMediaCursor,
  findActiveWorkspaceMediaByUrl,
  listWorkspaceMedia,
  mediaCursorFilter,
  restoreWorkspaceMedia,
  softDeleteWorkspaceMedia,
  uploadWorkspaceMedia,
} from "../workspace-media";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const AT = "2026-10-09T12:00:00.123456+00:00";
const gifBytes = new Uint8Array([...Buffer.from("GIF89a"), 40, 0, 20, 0, 0, 0, 0]);

// Records every query-builder call and resolves with the queued result for that table.
function fakeClient(results = {}) {
  const calls = [];
  const storage = [];
  const builder = (table) => {
    const chain = [];
    calls.push({ table, chain });
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          const result = results[table]?.(chain) ?? { data: null, error: null };
          return (resolve) => resolve(result);
        }
        return (...args) => { chain.push([prop, ...args]); return proxy; };
      },
    });
    return proxy;
  };
  return {
    calls,
    storage,
    from: builder,
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes, options) => { storage.push({ op: "upload", bucket, path, bytes, options }); return { error: null }; },
        remove: async (paths) => { storage.push({ op: "remove", bucket, paths }); return { error: null }; },
      }),
    },
    storageCalls: storage,
  };
}
const has = (chain, ...call) => chain.some((entry) => JSON.stringify(entry) === JSON.stringify(call));

describe("media cursor", () => {
  it("round-trips the created_at and id of the last item", () => {
    const cursor = encodeMediaCursor({ created_at: AT, id: ID });
    expect(decodeMediaCursor(cursor)).toEqual({ createdAt: AT, id: ID });
  });

  it("ignores malformed cursors", () => {
    expect(decodeMediaCursor("")).toBeNull();
    expect(decodeMediaCursor("nope")).toBeNull();
    expect(decodeMediaCursor(`${AT}|not-a-uuid`)).toBeNull();
    expect(decodeMediaCursor(`yesterday|${ID}`)).toBeNull();
  });

  it("continues after the cursor without skipping rows that share its timestamp", () => {
    expect(mediaCursorFilter({ createdAt: AT, id: ID }))
      .toBe(`created_at.lt."${AT}",and(created_at.eq."${AT}",id.lt.${ID})`);
  });
});

describe("listWorkspaceMedia", () => {
  it("lists this workspace's visible images, newest first, one page at a time", async () => {
    const rows = Array.from({ length: MEDIA_PAGE_SIZE + 1 }, (_, index) => ({
      id: ID, created_at: AT, public_url: `u${index}`, file_name: "a", content_type: "image/png",
      size_bytes: 10, width: 1, height: 1,
    }));
    const client = fakeClient({ workspace_media: () => ({ data: rows, error: null }) });
    const page = await listWorkspaceMedia(client, WS, { before: encodeMediaCursor({ created_at: AT, id: ID }) });
    const { chain } = client.calls[0];
    expect(has(chain, "eq", "workspace_id", WS)).toBe(true);
    expect(has(chain, "is", "deleted_at", null)).toBe(true);
    expect(has(chain, "order", "created_at", { ascending: false })).toBe(true);
    expect(has(chain, "order", "id", { ascending: false })).toBe(true);
    expect(has(chain, "limit", MEDIA_PAGE_SIZE + 1)).toBe(true);
    expect(chain.some(([method]) => method === "or")).toBe(true);
    expect(page.items).toHaveLength(MEDIA_PAGE_SIZE);
    expect(page.items[0]).toEqual({
      id: ID, url: "u0", file_name: "a", content_type: "image/png", size_bytes: 10, width: 1, height: 1, created_at: AT,
    });
    expect(page.next_before).toBe(encodeMediaCursor({ created_at: AT, id: ID }));
  });

  it("has no next page when the last page is short", async () => {
    const client = fakeClient({ workspace_media: () => ({ data: [], error: null }) });
    expect(await listWorkspaceMedia(client, WS)).toEqual({ items: [], next_before: null });
    expect(client.calls[0].chain.some(([method]) => method === "or")).toBe(false);
  });
});

describe("uploadWorkspaceMedia", () => {
  it("stores the file under the workspace media folder and records it", async () => {
    let inserted;
    const client = fakeClient({
      workspace_media: (chain) => {
        inserted = chain.find(([method]) => method === "insert")?.[1];
        return { data: { ...inserted, id: ID, created_at: AT }, error: null };
      },
    });
    const file = { name: "Summer sale.gif", type: "image/gif", arrayBuffer: async () => gifBytes.buffer };
    const item = await uploadWorkspaceMedia(client, {
      supabaseUrl: "https://abc.supabase.co", workspaceId: WS, userId: "user-1", file,
    });
    const upload = client.storageCalls[0];
    expect(upload.bucket).toBe("workspace-email-signature-assets");
    expect(upload.path).toMatch(new RegExp(`^${WS}/media/[0-9a-f-]{36}\\.gif$`));
    expect(inserted).toMatchObject({
      workspace_id: WS, storage_path: upload.path, file_name: "Summer sale.gif",
      content_type: "image/gif", size_bytes: gifBytes.length, width: 40, height: 20, uploaded_by: "user-1",
    });
    expect(inserted.public_url).toBe(`https://abc.supabase.co/storage/v1/object/public/workspace-email-signature-assets/${upload.path}`);
    expect(item.url).toBe(inserted.public_url);
  });

  it("stores large photos scaled down to the email maximum", async () => {
    let inserted;
    const client = fakeClient({
      workspace_media: (chain) => {
        inserted = chain.find(([method]) => method === "insert")?.[1];
        return { data: { ...inserted, id: ID, created_at: AT }, error: null };
      },
    });
    const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#e11d48" } }).jpeg().toBuffer();
    const file = { name: "photo.jpg", type: "image/jpeg", arrayBuffer: async () => new Uint8Array(photo).buffer };
    await uploadWorkspaceMedia(client, { supabaseUrl: "https://abc.supabase.co", workspaceId: WS, userId: null, file });
    expect(inserted).toMatchObject({ width: 1200, height: 800, content_type: "image/jpeg" });
    expect((await sharp(Buffer.from(client.storageCalls[0].bytes)).metadata()).width).toBe(1200);
    expect(inserted.size_bytes).toBe(client.storageCalls[0].bytes.length);
  });

  it("removes the uploaded file when the row cannot be saved", async () => {
    const client = fakeClient({ workspace_media: () => ({ data: null, error: { message: "boom" } }) });
    const file = { name: "a.gif", type: "image/gif", arrayBuffer: async () => gifBytes.buffer };
    await expect(uploadWorkspaceMedia(client, { supabaseUrl: "https://abc.supabase.co", workspaceId: WS, userId: null, file }))
      .rejects.toThrow("boom");
    expect(client.storageCalls.map((call) => call.op)).toEqual(["upload", "remove"]);
  });

  it("rejects a file that is not a PNG, JPG or GIF before uploading", async () => {
    const client = fakeClient();
    const file = { name: "a.svg", type: "image/svg+xml", arrayBuffer: async () => new Uint8Array([60]).buffer };
    await expect(uploadWorkspaceMedia(client, { supabaseUrl: "https://abc.supabase.co", workspaceId: WS, file }))
      .rejects.toMatchObject({ status: 400 });
    expect(client.storageCalls).toHaveLength(0);
  });
});

describe("soft delete and lookup", () => {
  it("hides only a visible image in this workspace", async () => {
    const client = fakeClient({ workspace_media: () => ({ data: [{ id: ID }], error: null }) });
    expect(await softDeleteWorkspaceMedia(client, WS, ID)).toBe(true);
    const { chain } = client.calls[0];
    expect(chain[0][0]).toBe("update");
    expect(chain[0][1].deleted_at).toEqual(expect.any(String));
    expect(has(chain, "eq", "workspace_id", WS)).toBe(true);
    expect(has(chain, "eq", "id", ID)).toBe(true);
    expect(has(chain, "is", "deleted_at", null)).toBe(true);
  });

  it("restores a hidden image in this workspace", async () => {
    const client = fakeClient({ workspace_media: () => ({ data: [{ id: ID }], error: null }) });
    expect(await restoreWorkspaceMedia(client, WS, ID)).toBe(true);
    const { chain } = client.calls[0];
    expect(chain[0]).toEqual(["update", { deleted_at: null }]);
    expect(has(chain, "eq", "workspace_id", WS)).toBe(true);
    expect(has(chain, "eq", "id", ID)).toBe(true);
    expect(has(chain, "not", "deleted_at", "is", null)).toBe(true);
    expect(await restoreWorkspaceMedia(fakeClient(), WS, "not-a-uuid")).toBe(false);
  });

  it("reports a missing or foreign image", async () => {
    const client = fakeClient({ workspace_media: () => ({ data: [], error: null }) });
    expect(await softDeleteWorkspaceMedia(client, WS, ID)).toBe(false);
    expect(await softDeleteWorkspaceMedia(fakeClient(), WS, "not-a-uuid")).toBe(false);
  });

  it("finds a visible image in this workspace by its url", async () => {
    const client = fakeClient({ workspace_media: () => ({ data: { id: ID }, error: null }) });
    expect(await findActiveWorkspaceMediaByUrl(client, WS, "https://x/y.png")).toEqual({ id: ID });
    const { chain } = client.calls[0];
    expect(has(chain, "eq", "workspace_id", WS)).toBe(true);
    expect(has(chain, "eq", "public_url", "https://x/y.png")).toBe(true);
    expect(has(chain, "is", "deleted_at", null)).toBe(true);
    expect(await findActiveWorkspaceMediaByUrl(fakeClient(), WS, "")).toBeNull();
  });
});
