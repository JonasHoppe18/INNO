// Run: node --test apps/web/lib/server/eval-live-fact.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLiveFactDependency } from "./eval-live-fact.js";

// PII-free paraphrases of the pilot cases. The gate must flag ONLY the
// unresolvable live-data cases and leave everything else comparable.

const flag = (c) => classifyLiveFactDependency(c).live_fact_dependent;

// --- should be flagged: live topic + human used live data + redacted id + unresolvable ---
const g036 = {
  intent: "tracking",
  body: "Hello, could I get an update on the shipping status of this order? Order number: [order number]",
  humanReply: "Hi there, we have received your order and forwarded it to our warehouse partner. We expect it will ship today or tomorrow.",
};
const g041 = {
  intent: "tracking",
  body: "Hej Acezone, Ville høre om mit headset når at blive sendt i dag. Mit ordre nummer er [order number]",
  humanReply: "Hej igen, jeg har lige været inde og tjekke din forsendelse. Den er blevet oprettet i dag, og vores lager venter på at DAO kommer og henter den.",
};

test("flags unresolvable live-fact cases (g-036, g-041)", () => {
  assert.equal(flag(g036), true);
  assert.equal(flag(g041), true);
});

// --- should stay comparable ---
const g037 = { // real order number → resolvable
  intent: "tracking",
  body: "When will my order #100423 ship? I need it this week.",
  humanReply: "I just checked your order and it has shipped with DAO.",
};
const g040 = { // checkout-country question, human did no live lookup
  intent: "tracking",
  body: "I am trying to order to my country but it is not an option at checkout under Country.",
  humanReply: "Hi there, thanks for reaching out — could you tell me which country you are in so we can look into the checkout options?",
};
const g027 = { // refund but human gives policy, no live lookup, redacted id
  intent: "refund",
  body: "Previous Ticket ID: [order number]. I am reaching out again due to the headset's issue and would like a refund.",
  humanReply: "Our refund policy allows returns within 30 days of receipt. Please send the headset back and we will process it.",
};
const g012 = { // exchange / physical damage — not a live-fact topic
  intent: "exchange",
  body: "Hej, halvdelen af mit headset er sprækket uden slag. Er der mulighed for ombytning?",
  humanReply: "Vi vil gerne hjælpe dig med en ombytning. Send os venligst et foto af skaden samt dit ordrenummer.",
};
const g024 = { // technical troubleshooting — not a live-fact topic
  intent: "product_question",
  body: "hello my a-spire wireless dont want to power on even when i have a cable connected.",
  humanReply: "Let's try a few troubleshooting steps. 1. Ensure the cable is connected. 2. Factory reset: hold power 15 seconds.",
};

test("keeps resolvable and non-live cases comparable", () => {
  assert.equal(flag(g037), false, "real order number is resolvable");
  assert.equal(flag(g040), false, "checkout-country, no live lookup");
  assert.equal(flag(g027), false, "refund policy answer, no live lookup");
  assert.equal(flag(g012), false, "physical-damage exchange is not a live-fact topic");
  assert.equal(flag(g024), false, "technical troubleshooting is not a live-fact topic");
});

test("blank input is comparable", () => {
  assert.equal(flag({}), false);
  assert.equal(classifyLiveFactDependency().live_fact_dependent, false);
});
