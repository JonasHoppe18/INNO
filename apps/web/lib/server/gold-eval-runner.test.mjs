import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeGoldChunkIdsFromRows,
  persistableGenerationId,
} from "./gold-eval-runner.js";

test("persists real generation UUIDs", () => {
  assert.equal(
    persistableGenerationId("698ad3e3-098d-4740-97e4-5112d094734d"),
    "698ad3e3-098d-4740-97e4-5112d094734d",
  );
});

test("does not write eval-only dry-run ids into a UUID foreign key", () => {
  assert.equal(
    persistableGenerationId("dry-run:698ad3e3-098d-4740-97e4-5112d094734d"),
    null,
  );
  assert.equal(persistableGenerationId(null), null);
});

test("gold retrieval grading excludes archived and AI-disabled chunks", () => {
  assert.deepEqual(
    activeGoldChunkIdsFromRows(["10", "11", "12", "13"], [
      { id: 10, metadata: { active_for_ai: true, archived: false } },
      { id: 11, metadata: { active_for_ai: false } },
      { id: 12, metadata: { archived: true } },
      // Missing id 13 is also not a valid current retrieval target.
    ]),
    ["10"],
  );
});
