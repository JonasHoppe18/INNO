require("sucrase/register/ts-legacy-module-interop");

const assert = require("node:assert/strict");
const test = require("node:test");

const { processImportJobBatch } = require("../apps/web/lib/server/knowledge-import.ts");

// Mimics the subset of the supabase-js query builder chain that the HIST-0 guard
// (an .update().eq().select().maybeSingle() call on knowledge_import_jobs) exercises,
// while recording every table any code path touches so we can assert agent_knowledge
// is never reached.
function makeServiceClient(job) {
  const fromCalls = [];
  const jobs = { ...job };

  class Query {
    constructor(table) {
      this.table = table;
      this._filters = [];
    }
    update(patch) {
      this._patch = patch;
      return this;
    }
    insert(rows) {
      this._inserted = rows;
      return this;
    }
    eq(key, value) {
      this._filters.push({ key, value });
      return this;
    }
    select() {
      return this;
    }
    maybeSingle() {
      if (this.table === "knowledge_import_jobs" && this._patch) {
        Object.assign(jobs, this._patch);
        return Promise.resolve({ data: { ...jobs }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
    then(resolve, reject) {
      return this.maybeSingle().then(resolve, reject);
    }
  }

  return {
    fromCalls,
    jobs,
    from(table) {
      fromCalls.push(table);
      return new Query(table);
    },
  };
}

function makeJob(provider) {
  return {
    id: `job-${provider}`,
    provider,
    shop_id: "00000000-0000-0000-0000-000000000000",
    workspace_id: null,
    user_id: null,
    status: "running",
    cursor: {},
    max_tickets: 100,
    batch_size: 50,
    imported_count: 0,
    skipped_count: 0,
  };
}

test("HIST-0: processImportJobBatch never touches provider APIs or agent_knowledge for zendesk/gorgias/freshdesk", async () => {
  for (const provider of ["zendesk", "gorgias", "freshdesk"]) {
    const job = makeJob(provider);
    const serviceClient = makeServiceClient(job);

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
      fetchCalls.push(args);
      throw new Error("fetch should never be called while HIST-0 gate is active");
    };

    let result;
    try {
      result = await processImportJobBatch(serviceClient, job);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(fetchCalls.length, 0, `expected no provider/embedding fetch for provider=${provider}`);
    assert.deepEqual(
      serviceClient.fromCalls,
      ["knowledge_import_jobs"],
      `expected only knowledge_import_jobs to be touched for provider=${provider}`,
    );
    assert.ok(
      !serviceClient.fromCalls.includes("agent_knowledge"),
      `expected agent_knowledge.insert never called for provider=${provider}`,
    );

    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.completed, true);
    assert.equal(result.job.status, "failed");
    assert.match(
      result.job.last_error,
      /temporarily disabled pending redaction\/review onboarding flow/,
    );
  }
});
