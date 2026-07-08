import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createReturnTrackingShipment,
  detectReturnTrackingCandidates,
  friendlyReturnTrackingDbError,
  listReturnTrackingShipments,
  markExistingReturnTrackingSuggestions,
} from "./return-tracking.js";

function message(overrides = {}) {
  return {
    id: "msg_1",
    from_me: false,
    clean_body_text: "",
    body_text: "",
    snippet: "",
    from_email: "customer@example.com",
    from_name: "Customer",
    ...overrides,
  };
}

Deno.test("return tracking detection finds tracking number in inbound return message", () => {
  const candidates = detectReturnTrackingCandidates({
    thread: { customer_email: "customer@example.com", customer_name: "Ada" },
    messages: [
      message({
        clean_body_text:
          "Hej, jeg har sendt varen retur med GLS. Trackingnummeret er 123456789. Ordre #4521.",
      }),
    ],
  });

  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].normalized_tracking_number, "123456789");
  assertEquals(candidates[0].carrier, "GLS");
  assertEquals(candidates[0].customer_email, "customer@example.com");
  assertEquals(candidates[0].order_number, "#4521");
});

Deno.test("return tracking detection ignores outbound/from_me messages", () => {
  const candidates = detectReturnTrackingCandidates({
    thread: { subject: "Return request" },
    messages: [
      message({
        from_me: true,
        clean_body_text: "Retur trackingnummer: 123456789012 sendt med GLS.",
      }),
    ],
  });

  assertEquals(candidates, []);
});

Deno.test("return tracking detection ignores outbound order tracking questions", () => {
  const candidates = detectReturnTrackingCandidates({
    thread: { subject: "Where is my order?" },
    messages: [
      message({
        clean_body_text:
          "Where is my order? My tracking number is 123456789012 and it has not arrived.",
      }),
    ],
  });

  assertEquals(candidates, []);
});

Deno.test("return tracking detection requires return intent plus tracking number", () => {
  assertEquals(
    detectReturnTrackingCandidates({
      thread: {},
      messages: [message({ clean_body_text: "Jeg har sendt varen retur i dag." })],
    }),
    [],
  );
  assertEquals(
    detectReturnTrackingCandidates({
      thread: {},
      messages: [message({ clean_body_text: "Her er trackingnummer: 123456789012." })],
    }),
    [],
  );
});

Deno.test("return tracking detection ignores tracking number only in quoted_body_text", () => {
  const candidates = detectReturnTrackingCandidates({
    thread: { subject: "Return request" },
    messages: [
      message({
        clean_body_text: "Tak for hjælpen.",
        quoted_body_text: "Jeg har sendt varen retur. Trackingnummeret er 123456789.",
      }),
    ],
  });

  assertEquals(candidates, []);
});

Deno.test("return tracking detection stores short context without old support reply", () => {
  const candidates = detectReturnTrackingCandidates({
    thread: { customer_email: "customer@example.com" },
    messages: [
      message({
        clean_body_text: [
          "Hej, jeg har sendt ordren retur med Bring. Trackingnummeret er: 370438109757988982",
          "",
          "Den 30. jun. skrev AceZone Support:",
          "Vi sender ikke en gammel support-reply med i context.",
        ].join("\n"),
      }),
    ],
  });

  assertEquals(candidates.length, 1);
  assert(candidates[0].detected_context.includes("Trackingnummeret er: 370438109757988982"));
  assert(!candidates[0].detected_context.includes("AceZone Support"));
  assert(!candidates[0].detected_context.includes("gammel support-reply"));
});

Deno.test("return tracking database setup errors are user friendly", () => {
  const message = friendlyReturnTrackingDbError({
    message: "Could not find the table 'public.return_tracking_shipments' in the schema cache",
  });

  assertEquals(
    message,
    "Return tracking is not set up yet. Run the migration before creating return rows.",
  );
});

Deno.test("return tracking suggestions are marked already_added when row exists", async () => {
  const filters = [];
  const client = {
    from(table) {
      assertEquals(table, "return_tracking_shipments");
      return {
        select() { return this; },
        eq(column, value) {
          filters.push([column, value]);
          return this;
        },
        in(column, values) {
          filters.push([column, values]);
          return Promise.resolve({
            data: [{ id: "return_tracking_1", normalized_tracking_number: "123456789012" }],
            error: null,
          });
        },
      };
    },
  };

  const suggestions = await markExistingReturnTrackingSuggestions(
    client,
    "workspace_1",
    [{
      tracking_number: "123456789012",
      normalized_tracking_number: "123456789012",
      already_added: false,
    }],
  );

  assert(filters.some(([column, value]) => column === "workspace_id" && value === "workspace_1"));
  assert(filters.some(([column, value]) => column === "normalized_tracking_number" && value.includes("123456789012")));
  assertEquals(suggestions[0].already_added, true);
  assertEquals(suggestions[0].existing_return_tracking_id, "return_tracking_1");
});

function queryResult(result) {
  const query = {
    select() { return this; },
    eq() { return this; },
    limit() { return this; },
    order() { return this; },
    insert(row) {
      this.inserted = row;
      return this;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(resolve) {
      return Promise.resolve(result).then(resolve);
    },
  };
  return query;
}

function fakeClientForCreate({ existing = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      if (table === "mail_threads") {
        return queryResult({
          data: {
            id: "thread_1",
            mailbox_id: "mailbox_1",
            workspace_id: "workspace_1",
            customer_email: "thread@example.com",
            customer_name: "Thread Customer",
          },
          error: null,
        });
      }
      if (table === "mail_accounts") {
        return queryResult({ data: { id: "mailbox_1", shop_id: "shop_1" }, error: null });
      }
      if (table === "mail_messages") {
        return queryResult({ data: [], error: null });
      }
      if (table === "return_tracking_shipments") {
        if (existing) return queryResult({ data: existing, error: null });
        return queryResult({
          data: { id: "new_row", normalized_tracking_number: "123456789012" },
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

Deno.test("createReturnTrackingShipment returns existing row on duplicate", async () => {
  const existing = { id: "existing_row", normalized_tracking_number: "123456789012" };
  const client = fakeClientForCreate({ existing });

  const result = await createReturnTrackingShipment(
    client,
    { workspaceId: "workspace_1" },
    { thread_id: "thread_1", tracking_number: "123456789012" },
  );

  assertEquals(result.duplicate, true);
  assertEquals(result.row, existing);
});

Deno.test("createReturnTrackingShipment requires tracking_number", async () => {
  await assertRejects(
    () => createReturnTrackingShipment(fakeClientForCreate(), { workspaceId: "workspace_1" }, { thread_id: "thread_1" }),
    Error,
    "tracking_number is required",
  );
});

Deno.test("listReturnTrackingShipments returns workspace scoped rows", async () => {
  const filters = [];
  const rows = [{ id: "row_1", workspace_id: "workspace_1" }];
  const client = {
    from(table) {
      assertEquals(table, "return_tracking_shipments");
      return {
        select() { return this; },
        order() { return this; },
        eq(column, value) {
          filters.push([column, value]);
          return this;
        },
        then(resolve) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
    },
  };

  const result = await listReturnTrackingShipments(client, { workspaceId: "workspace_1" });

  assertEquals(result, rows);
  assert(filters.some(([column, value]) => column === "workspace_id" && value === "workspace_1"));
});
