import { describe, expect, it } from "vitest";
import { missingResourceUrls, resourcePayload, resourcesFromBootstrap, SETTINGS_RESOURCE_URLS } from "../resource-map";

describe("settings resource map", () => {
  it("keeps every bootstrap entry, including failures", () => {
    const resources = resourcesFromBootstrap({ resources: {
      "/api/persona": { ok: true, status: 200, payload: { persona: { instructions: "x" } } },
      "/api/settings/test-mode": { ok: false, status: 500, payload: { error: "no" } },
    } });
    expect(resourcePayload(resources, "/api/persona")).toEqual({ persona: { instructions: "x" } });
    expect(resources["/api/settings/test-mode"]).toEqual({ ok: false, status: 500, payload: { error: "no" } });
    expect(resourcePayload(resources, "/api/settings/test-mode")).toBeNull();
    expect(resourcePayload(resources, "/api/inboxes")).toBeNull();
  });

  it("treats a missing bootstrap as empty", () => {
    expect(resourcesFromBootstrap(null)).toEqual({});
  });

  it("lists missing urls and skips workspace-only urls without a workspace", () => {
    const resources = resourcesFromBootstrap({ resources: { "/api/inboxes": { ok: true, status: 200, payload: {} } } });
    expect(missingResourceUrls(resources, { hasWorkspace: true })).toEqual(SETTINGS_RESOURCE_URLS.filter((url) => url !== "/api/inboxes"));
    expect(missingResourceUrls(resources, { hasWorkspace: false })).not.toContain("/api/settings/test-mode");
    expect(missingResourceUrls(resources, { hasWorkspace: false })).not.toContain("/api/persona");
  });
});
