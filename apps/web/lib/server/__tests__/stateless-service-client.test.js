import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn((url, key, options) => ({ url, key, options })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
import { createStatelessServiceClient } from "../stateless-service-client.js";
afterEach(() => { delete globalThis[Symbol.for("sona.stateless-service-client")]; vi.clearAllMocks(); });

describe("stateless service transport", () => {
  it("reuses only identical server configuration and never persists a user's auth session", () => {
    const a = createStatelessServiceClient("https://a.test", "service-a");
    expect(createStatelessServiceClient("https://a.test", "service-a")).toBe(a);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(a.options.auth).toEqual({ autoRefreshToken: false, persistSession: false, detectSessionInUrl: false });
    expect(createStatelessServiceClient("https://b.test", "service-a")).not.toBe(a);
    expect(createStatelessServiceClient("https://a.test", "rotated-key")).not.toBe(a);
  });
  it("does not create a client with missing service credentials", () => {
    expect(createStatelessServiceClient("", "key")).toBeNull();
    expect(createStatelessServiceClient("https://a.test", "")).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
