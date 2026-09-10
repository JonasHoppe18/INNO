import { describe, expect, it } from "vitest";
import { Ship24ReadOnlyProvider } from "../ship24-read-only";

const provenance = { source: "shopify_order_fulfillment", workspaceId: "workspace-test", orderNumber: "1051" };

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function ship24Payload(overrides = {}) {
  return {
    data: {
      trackings: [{
        shipment: {
          courierCode: "gls",
          statusMilestone: "in_transit",
          statusCode: "in_transit",
          delivery: { estimatedDeliveryDate: "2026-09-06T00:00:00+02:00" },
          ...overrides.shipment,
        },
        events: [
          { statusMilestone: "in_transit", statusCode: "in_transit", status: "Arrived at depot", datetime: "2026-09-04T10:30:00+02:00", city: "Aarhus", courierCode: "gls" },
          { statusMilestone: "info_received", statusCode: "info_received", status: "Label created", datetime: "2026-09-03T08:00:00+02:00", city: "Berlin", courierCode: "gls" },
          ...(overrides.events ?? []),
        ],
      }],
    },
  };
}

describe("Ship24 read-only provider", () => {
  it("normalizes carrier-neutral live tracking facts and preserves missing fields", async () => {
    const calls = [];
    const provider = new Ship24ReadOnlyProvider({
      apiKey: "server-only-test-key",
      now: () => "2026-09-04T12:00:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(ship24Payload());
      },
    });

    const result = await provider.lookup({ trackingNumber: "GLS-TEST-1051", carrierHint: "GLS", provenance });

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({
      trackingNumber: "GLS-TEST-1051",
      carrier: "GLS",
      status: "in_transit",
      subStatus: "in_transit",
      estimatedDelivery: "2026-09-05T22:00:00.000Z",
      exception: null,
      observedAt: "2026-09-04T12:00:00.000Z",
      provider: "ship24",
      source: "ship24_api",
    });
    expect(result.data.latestEvent).toMatchObject({ description: "Arrived at depot", timestamp: "2026-09-04T08:30:00.000Z", location: "Aarhus" });
    expect(result.data.checkpoints).toHaveLength(2);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ trackingNumber: "GLS-TEST-1051" });
  });

  it("returns distinct safe failure statuses", async () => {
    const missingKey = new Ship24ReadOnlyProvider({ now: () => "2026-09-04T12:00:00.000Z" });
    await expect(missingKey.lookup({ trackingNumber: "GLS-TEST", provenance })).resolves.toMatchObject({ status: "unavailable" });

    const unauthorized = new Ship24ReadOnlyProvider({
      apiKey: "server-only-test-key",
      fetchImpl: async () => response({}, 401),
      now: () => "2026-09-04T12:00:00.000Z",
    });
    await expect(unauthorized.lookup({ trackingNumber: "GLS-TEST", provenance })).resolves.toMatchObject({ status: "unauthorized" });

    const unavailable = new Ship24ReadOnlyProvider({
      apiKey: "server-only-test-key",
      fetchImpl: async () => response({}, 503),
      now: () => "2026-09-04T12:00:00.000Z",
    });
    await expect(unavailable.lookup({ trackingNumber: "GLS-TEST", provenance })).resolves.toMatchObject({ status: "unavailable" });

    const notFound = new Ship24ReadOnlyProvider({
      apiKey: "server-only-test-key",
      fetchImpl: async () => response({ data: { trackings: [] } }),
      now: () => "2026-09-04T12:00:00.000Z",
    });
    await expect(notFound.lookup({ trackingNumber: "GLS-TEST", provenance })).resolves.toMatchObject({ status: "not_found" });
  });

  it("preserves canonical provider event timestamps and codes", async () => {
    const provider = new Ship24ReadOnlyProvider({
      requestImpl: async () => ({
        detail: {
          lookupSource: "ship24_api",
          lookupDetail: "ok",
          trackingNumber: "BRING-TEST-1063",
          carrier: "Bring",
          snapshot: {
            statusCode: "delivered",
            lastEvent: { code: "delivery_delivered", description: "The parcel has been delivered.", occurredAt: "2026-09-03T12:00:00+02:00", location: "Copenhagen" },
            events: [{ code: "delivery_delivered", description: "The parcel has been delivered.", occurredAt: "2026-09-03T12:00:00+02:00", location: "Copenhagen" }],
          },
        },
      }),
      now: () => "2026-09-04T12:00:00.000Z",
    });

    const result = await provider.lookup({ trackingNumber: "BRING-TEST-1063", provenance });
    expect(result).toMatchObject({ status: "ok", data: { status: "delivered", carrier: "Bring" } });
    expect(result.data.latestEvent).toMatchObject({ subStatus: "delivery_delivered", timestamp: "2026-09-03T10:00:00.000Z", location: "Copenhagen" });
    expect(result.data.checkpoints).toHaveLength(1);
  });

  it("fails closed without trusted provenance or for malformed identifiers", async () => {
    let calls = 0;
    const provider = new Ship24ReadOnlyProvider({
      apiKey: "server-only-test-key",
      fetchImpl: async () => {
        calls += 1;
        return response(ship24Payload());
      },
    });

    await expect(provider.lookup({ trackingNumber: "GLS-TEST", provenance: { source: "shopify_order_fulfillment", workspaceId: "" } })).resolves.toMatchObject({ status: "unauthorized" });
    await expect(provider.lookup({ trackingNumber: "***", provenance })).resolves.toMatchObject({ status: "invalid_request" });
    expect(calls).toBe(0);
  });
});
