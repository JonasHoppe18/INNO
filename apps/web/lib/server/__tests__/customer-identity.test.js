import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExternalCustomerEmail,
  normalizeCustomerEmail,
  resolveWorkspaceCustomer,
} from "../customer-identity.js";

function createFakeClient() {
  const rows = [];
  const findRow = (filters) => rows.find((row) =>
    Object.entries(filters).every(([key, value]) => row[key] === value)
  ) || null;

  return {
    rows,
    from(table) {
      if (table !== "workspace_customers") throw new Error(`Unexpected table ${table}`);
      return {
        upsert: async (payload) => {
          if (!findRow({ workspace_id: payload.workspace_id, normalized_email: payload.normalized_email })) {
            rows.push({
              id: `customer-${rows.length + 1}`,
              ...payload,
              name: payload.name || null,
              phone: payload.phone || null,
            });
          }
          return { error: null };
        },
        select: () => {
          const filters = {};
          const builder = {
            eq: (key, value) => {
              filters[key] = value;
              return builder;
            },
            maybeSingle: async () => ({ data: findRow(filters), error: null }),
          };
          return builder;
        },
        update: (updates) => {
          const filters = {};
          const builder = {
            eq: (key, value) => {
              filters[key] = value;
              return builder;
            },
            select: () => builder,
            maybeSingle: async () => {
              const row = findRow(filters);
              if (row) Object.assign(row, updates);
              return { data: row, error: null };
            },
          };
          return builder;
        },
      };
    },
  };
}

describe("workspace customer identity", () => {
  it("normalizes by trimming and lowercasing without provider-specific rewriting", () => {
    expect(normalizeCustomerEmail("  Customer+tag@Example.com ")).toBe("customer+tag@example.com");
    expect(normalizeCustomerEmail("Customer.Name@example.com")).toBe("customer.name@example.com");
    expect(normalizeCustomerEmail("invalid")).toBe("");
  });

  it("excludes known internal and system senders", () => {
    expect(isExternalCustomerEmail("support@example.com", { internalEmails: ["support@example.com"] })).toBe(false);
    expect(isExternalCustomerEmail("no-reply@example.com")).toBe(false);
    expect(isExternalCustomerEmail("customer@example.com")).toBe(true);
  });

  it("reuses one customer for the same normalized email in one workspace", async () => {
    const client = createFakeClient();
    const first = await resolveWorkspaceCustomer(client, { workspaceId: "workspace-a", email: "Customer@Example.com" });
    const second = await resolveWorkspaceCustomer(client, { workspaceId: "workspace-a", email: " customer@example.com " });
    expect(second.id).toBe(first.id);
    expect(client.rows).toHaveLength(1);
  });

  it("does not share a customer across workspaces", async () => {
    const client = createFakeClient();
    const first = await resolveWorkspaceCustomer(client, { workspaceId: "workspace-a", email: "customer@example.com" });
    const second = await resolveWorkspaceCustomer(client, { workspaceId: "workspace-b", email: "customer@example.com" });
    expect(second.id).not.toBe(first.id);
    expect(client.rows).toHaveLength(2);
  });

  it("is idempotent under concurrent resolution", async () => {
    const client = createFakeClient();
    const customers = await Promise.all(Array.from({ length: 8 }, () =>
      resolveWorkspaceCustomer(client, { workspaceId: "workspace-a", email: "CUSTOMER@example.com" })
    ));
    expect(new Set(customers.map((customer) => customer.id)).size).toBe(1);
    expect(client.rows).toHaveLength(1);
  });

  it("enriches missing fields without replacing the identity", async () => {
    const client = createFakeClient();
    const first = await resolveWorkspaceCustomer(client, { workspaceId: "workspace-a", email: "customer@example.com" });
    const enriched = await resolveWorkspaceCustomer(client, {
      workspaceId: "workspace-a",
      email: "customer@example.com",
      name: "Ada Customer",
      phone: "+45 12345678",
    });
    expect(enriched).toMatchObject({
      id: first.id,
      normalized_email: "customer@example.com",
      name: "Ada Customer",
      phone: "+45 12345678",
    });
  });

  it("defines a tenant-safe thread relationship in the migration", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const migration = readFileSync(
      resolve(testDir, "../../../../../supabase/migrations/20260910160421_create_workspace_customers.sql"),
      "utf8",
    );
    expect(migration).toContain("unique (workspace_id, normalized_email)");
    expect(migration).toContain("foreign key (workspace_id, customer_id)");
    expect(migration).toContain("references public.workspace_customers (workspace_id, id)");
    expect(migration).toContain("check (customer_id is null or workspace_id is not null)");
  });
});
