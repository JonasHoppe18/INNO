import { describe, expect, it, vi } from "vitest";
import { createScopedReadCache } from "../scoped-read-cache.js";

describe("scoped read cache", () => {
  it("shares concurrent reads and reuses a fresh result", async () => {
    const cache = createScopedReadCache();
    const loader = vi.fn(async () => ({ rows: [1] }));
    const [a, b] = await Promise.all([cache.load("user/session/org-a", "/rows", loader), cache.load("user/session/org-a", "/rows", loader)]);
    expect(a).toEqual(b);
    await cache.load("user/session/org-a", "/rows", loader);
    expect(loader).toHaveBeenCalledOnce();
  });
  it("never reuses data between accounts, sessions, organizations or resources", async () => {
    const cache = createScopedReadCache();
    await cache.load("user/session/org-a", "/rows", async () => "private-a");
    for (const scope of ["other/session/org-a", "user/new-session/org-a", "user/session/org-b"]) {
      expect(cache.get(scope, "/rows")).toBeUndefined();
      expect(await cache.load(scope, "/rows", async () => scope)).toBe(scope);
    }
    expect(cache.get("user/session/org-a", "/different")).toBeUndefined();
    await expect(cache.load(null, "/rows", async () => "invalid")).rejects.toThrow("Authentication");
  });
  it("expires results and lets explicit refresh bypass the cache", async () => {
    let clock = 0;
    const cache = createScopedReadCache({ now: () => clock, maxAgeMs: 15 });
    await cache.load("scope", "/rows", async () => 1);
    clock = 15;
    expect(cache.get("scope", "/rows")).toBeUndefined();
    expect(await cache.load("scope", "/rows", async () => 2)).toBe(2);
    expect(await cache.load("scope", "/rows", async () => 3, { force: true })).toBe(3);
  });
  it("does not cache failures or resurrect invalidated in-flight reads", async () => {
    const cache = createScopedReadCache();
    await expect(cache.load("scope", "/rows", async () => { throw Error("offline"); })).rejects.toThrow("offline");
    let finish;
    const pending = cache.load("scope", "/rows", () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve();
    cache.invalidate("scope", "/rows");
    finish("old");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.get("scope", "/rows")).toBeUndefined();
  });
  it("bounds memory and clears data and pending requests on logout", async () => {
    const cache = createScopedReadCache({ maxEntries: 2 });
    await cache.load("scope", "/one", async () => 1);
    await cache.load("scope", "/two", async () => 2);
    await cache.load("scope", "/three", async () => 3);
    expect(cache.get("scope", "/one")).toBeUndefined();
    cache.clear();
    expect(cache.get("scope", "/two")).toBeUndefined();
  });
  it("returns oversized data without retaining it in browser memory", async () => {
    const cache = createScopedReadCache({ maxValueChars: 16 });
    const value = { rows: ["a very large response"] };
    expect(await cache.load("scope", "/rows", async () => value)).toBe(value);
    expect(cache.get("scope", "/rows")).toBeUndefined();
  });

});
