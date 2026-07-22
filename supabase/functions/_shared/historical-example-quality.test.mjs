import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessHistoricalExampleQuality,
  historicalExampleSubstance,
} from "./historical-example-quality.js";

test("removes greetings and signatures before assessing substance", () => {
  assert.equal(
    historicalExampleSubstance("Hi Jonas,\n\nPlease send your order number.\n\nKind regards,\nSupport"),
    "Please send your order number.",
  );
});
test("rejects acknowledgement-only and signature-only examples", () => {
  for (const agentReply of [
    "Thanks!",
    "Hej,\n\nMange tak.\n\nMed venlig hilsen\nSupport",
    "Best regards,\nSupport",
  ]) {
    assert.equal(assessHistoricalExampleQuality({ agentReply }).usable, false);
  }
});

test("keeps concise answers and actionable questions", () => {
  for (const agentReply of [
    "No, that model is not compatible.",
    "Please send your order number.",
    "Try pairing the dongle again, then restart the app.",
  ]) {
    assert.equal(assessHistoricalExampleQuality({ agentReply }).usable, true);
  }
});
