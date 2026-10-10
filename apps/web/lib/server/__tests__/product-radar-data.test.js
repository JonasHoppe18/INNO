import { describe, expect, it } from "vitest";
import { loadProductRadar } from "../product-radar-data.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;

// Minimal stand-in for the supabase-js query builder: records filters and
// serves rows in the order and page the query asks for.
function fakeClient(tables) {
  const calls = [];
  function from(table) {
    const state = { table, filters: [], range: null };
    const builder = {
      select() { return builder; },
      gte(column, value) { state.filters.push((row) => row[column] >= value); return builder; },
      lt(column, value) { state.filters.push((row) => row[column] < value); return builder; },
      eq(column, value) { state.eq = { column, value }; state.filters.push((row) => row[column] === value); return builder; },
      in(column, values) { state.filters.push((row) => values.includes(String(row[column]))); return builder; },
      order() { return builder; },
      range(start, end) { state.range = [start, end]; return builder; },
      then(resolve) {
        calls.push(state);
        let rows = (tables[table] || []).filter((row) => state.filters.every((test) => test(row)));
        if (table === "mail_threads") rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  }
  return { from, calls };
}

function thread(i, overrides = {}) {
  return {
    id: `t-${String(i).padStart(5, "0")}`,
    workspace_id: "ws-1",
    ticket_number: i,
    subject: `Subject ${i}`,
    status: "open",
    classification_key: "support",
    tags: [],
    detected_product_id: 7,
    issue_summary: `Summary ${i}`,
    created_at: new Date(NOW.getTime() - (i + 1) * HOUR).toISOString(),
    ...overrides,
  };
}

describe("loadProductRadar", () => {
  it("pages past the 1000-row cap and stays inside the workspace", async () => {
    const threads = Array.from({ length: 1500 }, (_, i) => thread(i % 1500, { created_at: new Date(NOW.getTime() - (i + 1) * 0.5 * HOUR).toISOString() }));
    const foreign = Array.from({ length: 20 }, (_, i) => thread(9000 + i, { workspace_id: "ws-2" }));
    const client = fakeClient({
      mail_threads: [...threads, ...foreign],
      shop_products: [{ id: 7, title: "A-Rise" }],
    });

    const radar = await loadProductRadar(client, { workspaceId: "ws-1" }, { now: NOW });

    const threadCalls = client.calls.filter((call) => call.table === "mail_threads");
    expect(threadCalls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(threadCalls.every((call) => call.eq?.column === "workspace_id" && call.eq.value === "ws-1")).toBe(true);
    expect(radar.coverage.supportTickets).toBe(1500);
    expect(radar.products).toHaveLength(1);
    expect(radar.products[0].name).toBe("A-Rise");
  });

  it("returns a product's support tickets, newest first, when asked", async () => {
    const client = fakeClient({
      mail_threads: [
        thread(1),
        thread(2, { classification_key: "notification" }),
        thread(3, { detected_product_id: 8 }),
        thread(4),
      ],
      shop_products: [{ id: 7, title: "A-Rise" }, { id: 8, title: "A-Blaze" }],
    });

    const radar = await loadProductRadar(client, { workspaceId: "ws-1" }, { now: NOW, productId: "7" });

    expect(radar.product.name).toBe("A-Rise");
    expect(radar.tickets.map((ticket) => ticket.ticketNumber)).toEqual([1, 4]);
    expect(radar.tickets[0]).toMatchObject({ issueSummary: "Summary 1", url: "/inbox?thread=t-00001" });
  });

  it("returns no tickets for a product outside the workspace's radar", async () => {
    const client = fakeClient({ mail_threads: [thread(1)], shop_products: [{ id: 7, title: "A-Rise" }] });
    const radar = await loadProductRadar(client, { workspaceId: "ws-1" }, { now: NOW, productId: "999" });
    expect(radar.product).toBeNull();
    expect(radar.tickets).toEqual([]);
  });
});
