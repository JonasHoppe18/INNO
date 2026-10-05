import { describe, expect, it } from "vitest";
import { createPendingThreadReads } from "../pending-thread-read";
describe("pending thread reads", () => {
  it("shares hover/click work only while running and separates identities", async () => {
    const pool = createPendingThreadReads();
    let complete; let calls = 0;
    const loader = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
    const first = pool.read("account/session/org", "/thread", loader);
    const second = pool.read("account/session/org", "/thread", loader);
    expect(second).toBe(first);
    await Promise.resolve(); complete({ messages: [] }); await first;
    await pool.read("account/session/org", "/thread", async () => { calls++; return {}; });
    await pool.read("other/session/org", "/thread", async () => { calls++; return {}; });
    expect(calls).toBe(3);
  });
  it("retries errors and never lets an old completion remove a new read", async () => {
    const pool = createPendingThreadReads();
    await expect(pool.read("scope", "/thread", async () => { throw Error("failed"); })).rejects.toThrow("failed");
    let finish;
    const old = pool.read("scope", "/thread", () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); pool.clear();
    const fresh = pool.read("scope", "/thread", () => new Promise(() => {}));
    finish({}); await old;
    expect(pool.read("scope", "/thread", async () => ({}))).toBe(fresh);
  });
});
