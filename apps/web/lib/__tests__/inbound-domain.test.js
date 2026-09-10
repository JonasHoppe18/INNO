import { describe, expect, it } from "vitest";
import {
  DEFAULT_INBOUND_DOMAIN,
  buildInboundAddress,
  normalizeInboundDomain,
} from "../inbound-domain";

describe("inbound domain helpers", () => {
  it("uses the production domain as the safe default", () => {
    expect(normalizeInboundDomain()).toBe(DEFAULT_INBOUND_DOMAIN);
    expect(buildInboundAddress("mailbox-123", "")).toBe(
      "mailbox-123@inbound.sona-ai.dk",
    );
  });

  it("normalizes an environment-specific domain", () => {
    expect(normalizeInboundDomain(" @INBOUND-DEV.SONA-AI.DK. ")).toBe(
      "inbound-dev.sona-ai.dk",
    );
    expect(
      buildInboundAddress("mailbox-123", "inbound-dev.sona-ai.dk"),
    ).toBe("mailbox-123@inbound-dev.sona-ai.dk");
  });

  it("returns an empty address when no slug exists", () => {
    expect(buildInboundAddress("", "inbound-dev.sona-ai.dk")).toBe("");
  });
});
