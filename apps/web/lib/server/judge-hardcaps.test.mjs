// Run: node --test apps/web/lib/server/judge-hardcaps.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFabrication, detectUnsupportedAvailability } from "./judge-hardcaps.js";

// Fixtures are PII-free paraphrases of the June-3 cases the live judge missed,
// plus controls that must NOT fire.

const c281 = {
  draft: "Hi,\n\nThanks, I can see the images you attached. I'll review them and get back with the next step shortly.\n\nI'll also notify the team handling A-LIVE sales leads so Oscar Clausen is informed about this submission.\n\nI look forward to hearing from you.",
  ticket: "Hi there, please see attached images. I don't have a digital copy of these only physical. Thanks,",
};
const c297 = {
  draft: "Hi,\n\nYes, we do offer replacement earpads for the A-Spire Wireless as spare parts on our webshop. You can find them on our spare parts page here: https://www.acezone.io/en-us/products/spare-parts. If you want, tell me which country/order you're buying from and I'll confirm current stock or reserve a set for you.",
  ticket: "The ear pads on my A-Spire Wireless are wearing down. The A-Rise ear pads are sold out. Are these ear pads in stock? Could you direct me to a link to purchase them?",
};
const c287 = {
  draft: "Hi,\n\nYes, you can technically remove and replace the ear pads on the A-Spire (Wired) at your own risk. If you believe the wear is abnormal, please attach the photos you mentioned. I look forward to your images.",
  ticket: "So the wired model is also capable of Bluetooth? Do you have instructions for the pad change on the wired model?",
};
const c276 = {
  draft: "Hej,\n\nKort sagt: AceZone fremhæver bestemte frekvenser. EQ profilerne ændrer ikke lydene i spillet. Du kan lave din egen EQ profil.",
  ticket: "Jeg synes der reklameres med at man kan høre footsteps. Hvad er forklaringen?",
};
const genericTeam = {
  draft: "Hi,\n\nThanks for reaching out. I'll forward this to our support team and we'll follow up. Best regards, AceZone Support",
  ticket: "My headset broke, what can I do?",
};
// availability confirmed without any customer stock doubt → must NOT fire
const confirmedAvail = {
  draft: "Hi,\n\nThe A-Spire Wireless is in stock and you can buy it on our webshop.",
  ticket: "Hi, can you tell me a bit about the A-Spire Wireless features?",
};

test("fabrication: invented team/person in a handoff fires", () => {
  assert.equal(detectFabrication(c281.draft, { ticketBody: c281.ticket }), true);
});

test("fabrication: controls do not fire", () => {
  assert.equal(detectFabrication(c297.draft, { ticketBody: c297.ticket }), false);
  assert.equal(detectFabrication(c287.draft, { ticketBody: c287.ticket }), false);
  assert.equal(detectFabrication(c276.draft, { ticketBody: c276.ticket }), false);
  // generic "support team" handoff must NOT be treated as fabrication
  assert.equal(detectFabrication(genericTeam.draft, { ticketBody: genericTeam.ticket }), false);
});

test("unsupported availability: claim + customer stock doubt fires", () => {
  assert.equal(detectUnsupportedAvailability(c297.draft, { ticketBody: c297.ticket }), true);
});

test("unsupported availability: controls do not fire", () => {
  assert.equal(detectUnsupportedAvailability(c281.draft, { ticketBody: c281.ticket }), false);
  assert.equal(detectUnsupportedAvailability(c287.draft, { ticketBody: c287.ticket }), false);
  assert.equal(detectUnsupportedAvailability(c276.draft, { ticketBody: c276.ticket }), false);
  // availability stated but no customer doubt → no false positive
  assert.equal(detectUnsupportedAvailability(confirmedAvail.draft, { ticketBody: confirmedAvail.ticket }), false);
});

test("missing/blank input is safe", () => {
  assert.equal(detectFabrication("", {}), false);
  assert.equal(detectUnsupportedAvailability("", {}), false);
});
